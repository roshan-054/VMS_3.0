/**
 * Live station status through Supabase: each station writes its upload queue report in about
 * 50 ms, and the admin view checks for changes every second, so admins see what each packer sees
 * almost at once. Only the vms_station_* functions are used: they check the VMS sign-in, store a
 * report under the caller's own email, and only administrators can read them. When Supabase is
 * not set up, not reachable or the database script is older, everything goes through Apps
 * Script as before.
 */
import { getSupabaseConfig, isSupabaseOffHere, sbRpc, SupabaseError } from './client';

let pauseUntil = 0;
const sessionFixed = new Set<string>();

export function stationSupabaseUsable(): boolean {
  return !!getSupabaseConfig() && !isSupabaseOffHere() && Date.now() >= pauseUntil;
}

type GasCall = (action: string, payload: Record<string, any>) => Promise<any>;

/** One Supabase call; fixes a sign-in that Supabase does not know yet, once per token. */
async function call<T>(fn: string, args: Record<string, unknown>, token: string, gas: GasCall): Promise<T> {
  try {
    return await sbRpc<T>(fn, { p_token: token, ...args }, { timeoutMs: 8000 });
  } catch (e) {
    if (e instanceof SupabaseError && e.kind === 'auth' && !sessionFixed.has(token)) {
      sessionFixed.add(token);
      const r = await gas('supabaseSession', {}).catch(() => null);
      if (r && r.success) return sbRpc<T>(fn, { p_token: token, ...args }, { timeoutMs: 8000 });
    }
    throw e;
  }
}

function backOff(e: unknown) {
  // A missing function (database script not re-run yet) or an outage: use Apps Script for a while.
  const ms = e instanceof SupabaseError && e.kind === 'network' ? 30000 : 120000;
  pauseUntil = Date.now() + ms;
}

/** Station side. Returns true when the report reached Supabase. */
export async function reportStationToSupabase(report: Record<string, unknown>, token: string, gas: GasCall): Promise<boolean> {
  if (!token || !stationSupabaseUsable()) return false;
  try {
    await call('vms_station_report', { p_report: report }, token, gas);
    return true;
  } catch (e) {
    backOff(e);
    return false;
  }
}

export interface StationListResult {
  version: number;
  changed: boolean;
  serverTime: number;
  stations?: any[];
}

/** Admin side. Returns null when Supabase cannot be used right now. */
export async function listStationsFromSupabase(since: number, token: string, gas: GasCall): Promise<StationListResult | null> {
  if (!token || !stationSupabaseUsable()) return null;
  try {
    return await call<StationListResult>('vms_station_list', { p_since: since }, token, gas);
  } catch (e) {
    if (e instanceof SupabaseError && e.kind === 'forbidden') throw e;
    backOff(e);
    return null;
  }
}

/** Live = reported within the last 45 s (same rule as Apps Script). */
export function withAge<T extends { reportedAt?: number }>(st: T, serverTime: number): T & { ageMs: number; live: boolean } {
  const ageMs = Math.max(0, serverTime - Number(st.reportedAt || 0));
  return { ...st, ageMs, live: ageMs < 45000 };
}

/** Keep the newest report per station when both Supabase and Apps Script have one. */
export function mergeStationReports<T extends { email: string; reportedAt?: number }>(a: T[], b: T[]): T[] {
  const by = new Map<string, T>();
  for (const st of [...a, ...b]) {
    const k = String(st.email || '').toLowerCase();
    const cur = by.get(k);
    if (!cur || Number(st.reportedAt || 0) > Number(cur.reportedAt || 0)) by.set(k, st);
  }
  return Array.from(by.values()).sort((x, y) => String(x.email).localeCompare(String(y.email)));
}
