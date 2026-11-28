/**
 * Sends the everyday data requests to Supabase instead of Apps Script.
 *
 * For each request it refreshes this station's copy of the rows (usually nothing new), runs the
 * same Code.gs function in the browser (gasEngine) and, for saves, sends the changed rows to
 * Supabase in one call. Apps Script then copies them into the Google Sheet in the background.
 *
 * Whenever anything is not right (Supabase not set up or not reachable, a sign-in it does not
 * know yet, a feature that needs Google Drive) it returns null and the request goes to Apps
 * Script exactly as before, so nothing stops working.
 */
import { getSupabaseConfig, isSupabaseOffHere, sbRpc, SupabaseError } from './client';
import { EngineUnsupported, loadCodeGsFactory, runEngine, type RowOp } from './gasEngine';
import { replica } from './replica';
import type { ReplicaRow } from './cells';

export type GasCall = (action: string, payload: Record<string, any>, timeoutMs?: number) => Promise<any>;

type Route = {
  kind: 'read' | 'write';
  run: (G: (name: string) => any, p: any) => any;
  when?: (p: any) => boolean;
  manifest?: boolean;
};

const R = (name: string) => (G: (n: string) => any, p: any) => G(name)(p);

const ROUTES: Record<string, Route> = {
  advancedSearch: { kind: 'read', run: R('advancedSearch_') },
  searchOrders: { kind: 'read', run: R('advancedSearch_') },
  uploadLogs: { kind: 'read', run: R('uploadLogs_') },
  getUploadLogs: { kind: 'read', run: R('uploadLogs_') },
  getReportData: { kind: 'read', run: R('getReportData_') },
  getOrderRecordingReport: { kind: 'read', run: R('getReportData_') },
  getAnalyticsData: { kind: 'read', run: (G, p) => G('getAnalyticsDataUncached_')(p, G('session_')(p.token)) },
  getOrderManifests: { kind: 'read', run: R('getOrderManifests_') },
  getPackVerificationLogs: { kind: 'read', run: R('getPackVerificationLogs_') },
  getGtinCatalog: {
    kind: 'read', run: R('getGtinCatalog_'),
    // Another tab of the Sheet (for example "UE") is not copied to Supabase.
    when: (p) => !p.tabName || String(p.tabName).trim().toLowerCase() === 'gtincatalog',
  },
  checkDuplicateOrder: { kind: 'read', run: R('checkDuplicateOrder_') },
  getTeamActivity: { kind: 'read', run: R('getTeamActivity_') },
  getBoxSettings: { kind: 'read', run: R('getBoxSettings_') },
  getReturnSettings: { kind: 'read', run: R('getReturnSettings_') },
  saveOrderManifest: { kind: 'write', run: R('saveOrderManifest_'), manifest: true },
  saveOrderManifestsBatch: { kind: 'write', run: R('saveOrderManifestsBatch_'), manifest: true },
  updateManifestStatus: { kind: 'write', run: R('updateManifestStatus_'), manifest: true },
  deleteOrderManifest: { kind: 'write', run: R('deleteOrderManifest_'), manifest: true },
  logPackVerification: { kind: 'write', run: R('logPackVerification_') },
  downloadLog: { kind: 'write', run: R('downloadLog_') },
  saveGtinProduct: { kind: 'write', run: R('saveGtinProduct_') },
  deleteGtinProduct: { kind: 'write', run: R('deleteGtinProduct_') },
  deleteGtinProductsBatch: { kind: 'write', run: R('deleteGtinProductsBatch_') },
  saveGtinCatalogBatch: { kind: 'write', run: R('saveGtinCatalogBatch_') },
};

export function isSupabaseAction(action: string): boolean {
  return !!ROUTES[action];
}

// After a failure, use Apps Script for a while before trying Supabase again.
let pauseUntil = 0;
let pauseReason = '';
const sessionFixed = new Set<string>();
const FRESH_MS = 1500;
const FIRST_LOAD_WAIT_MS = 5000;

export interface SupabaseRouteStatus {
  configured: boolean;
  offHere: boolean;
  paused: boolean;
  pauseReason: string;
  ready: boolean;
  rows: number;
  lastPull: number;
}

export function supabaseRouteStatus(): SupabaseRouteStatus {
  return {
    configured: !!getSupabaseConfig(),
    offHere: isSupabaseOffHere(),
    paused: Date.now() < pauseUntil,
    pauseReason,
    ready: replica.ready,
    rows: replica.count(),
    lastPull: replica.lastPull,
  };
}

function pause(ms: number, why: string) {
  pauseUntil = Date.now() + ms;
  pauseReason = why;
  if (typeof console !== 'undefined') console.warn('[VMS] Using Apps Script for ' + Math.round(ms / 1000) + 's: ' + why);
}

let syncTimer: any = null;
function pingSheetSync(gas: GasCall) {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    gas('syncSheetNow', {}, 60000).catch(() => undefined); // the 1-minute trigger catches anything missed
  }, 3000);
}

/** Make sure this station's copy is current. Returns false when Supabase should not be used now. */
async function ensureFresh(token: string, gas: GasCall): Promise<boolean> {
  const cfg = getSupabaseConfig()!;
  await replica.loadSaved(cfg.url);
  if (replica.ready && Date.now() - replica.lastPull < FRESH_MS) return true;
  const attempt = async () => {
    if (replica.ready) {
      await replica.pull(cfg.url, token);
      return true;
    }
    // First download on this station: wait a little, otherwise answer from Apps Script and let
    // the download finish in the background.
    const p = replica.pull(cfg.url, token);
    const done = await Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), FIRST_LOAD_WAIT_MS))]);
    if (!done) p.catch(() => undefined);
    return done;
  };
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof SupabaseError && e.kind === 'auth' && !sessionFixed.has(token)) {
      // Signed in before Supabase was set up (or the copy expired): ask Apps Script to copy it.
      sessionFixed.add(token);
      const r = await gas('supabaseSession', {}, 20000).catch(() => null);
      if (r && r.success) return attempt();
    }
    throw e;
  }
}

async function commit(ops: RowOp[], token: string): Promise<ReplicaRow[]> {
  const res = await sbRpc<{ rows: ReplicaRow[] }>('vms_apply', {
    p_token: token,
    p_ops: ops.map((o) => {
      const x: any = { op: o.op, tab: o.tab };
      if (o.id) x.id = o.id;
      if (o.key) x.key = o.key;
      if (o.vals) x.vals = o.vals;
      if (o.version !== undefined) x.version = o.version;
      if (o.headers) x.headers = o.headers;
      return x;
    }),
  }, { timeoutMs: 30000 });
  return res.rows || [];
}

/**
 * Answer a request from Supabase. Returns null when Apps Script should handle it instead.
 */
export async function trySupabase(action: string, payload: Record<string, any>, token: string, gas: GasCall): Promise<any | null> {
  const route = ROUTES[action];
  if (!route || !token) return null;
  if (!getSupabaseConfig() || isSupabaseOffHere()) return null;
  if (Date.now() < pauseUntil) return null;
  if (route.when && !route.when(payload)) return null;

  try {
    if (!(await ensureFresh(token, gas))) return null;
    const factory = await loadCodeGsFactory();
    const user = replica.user!;
    const p = { ...payload, action, token };
    const ctx = {
      user,
      tabs: (n: string) => replica.snapshot(n),
      tabVersion: (n: string) => replica.version(n),
    };

    if (route.kind === 'read') {
      const { result } = runEngine(factory, ctx, (G) => route.run(G, p));
      if (action === 'checkDuplicateOrder' && result && result.success && !result.isDuplicate) {
        // Recordings in progress on another station are only known to Apps Script.
        const live = await gas('checkDuplicateOrder', payload, 2500).catch(() => null);
        if (live && live.success) return live;
      }
      return result;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const { result, ops } = runEngine(factory, ctx, (G) => route.run(G, p));
      if (ops.length) {
        try {
          const rows = await commit(ops, token);
          for (const o of ops) if (o.op === 'tab' && o.headers) replica.setHeaders(o.tab, o.headers);
          replica.applyRows(rows);
        } catch (e) {
          if (e instanceof SupabaseError && e.kind === 'conflict' && attempt === 0) {
            // Another station changed the same rows: refresh and do it again on the new data.
            await replica.pull(getSupabaseConfig()!.url, token);
            continue;
          }
          throw e;
        }
        pingSheetSync(gas);
      }
      if (route.manifest && result && typeof result === 'object' && result.success !== false) {
        result.version = replica.version('OrderManifest');
      }
      return result;
    }
    return null;
  } catch (e) {
    if (e instanceof EngineUnsupported) return null; // needs Apps Script (Drive etc.)
    if (e instanceof SupabaseError) {
      if (e.kind === 'network') pause(30000, e.message);
      else if (e.kind === 'auth') pause(60000, 'sign-in not known to Supabase yet');
      else if (e.kind === 'forbidden') return { success: false, error: e.message };
      else pause(15000, e.message);
      return null;
    }
    console.warn('[VMS] Supabase path failed, using Apps Script:', e);
    return null;
  }
}

/** Forget this station's copy (sign out / other database). */
export async function resetSupabaseCopy(): Promise<void> {
  await replica.clearSaved();
  sessionFixed.clear();
  pauseUntil = 0;
}
