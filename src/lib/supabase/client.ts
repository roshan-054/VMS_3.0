/**
 * Supabase connection settings and the one call the app makes: POST /rest/v1/rpc/<fn>.
 * Only the public anon / publishable key is ever used here. The settings come from Apps Script
 * (getBranding), so every station picks them up automatically once an admin saves them.
 */

const CFG_KEY = 'vms_supabase_cfg';
const OFF_KEY = 'vms_supabase_off';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && typeof c.url === 'string' && /^https?:\/\//.test(c.url) && typeof c.anonKey === 'string' && c.anonKey) return { url: c.url.replace(/\/+$/, ''), anonKey: c.anonKey };
  } catch (_) {}
  return null;
}

export function setSupabaseConfig(cfg: SupabaseConfig | null): void {
  try {
    if (!cfg) localStorage.removeItem(CFG_KEY);
    else localStorage.setItem(CFG_KEY, JSON.stringify({ url: cfg.url.replace(/\/+$/, ''), anonKey: cfg.anonKey }));
  } catch (_) {}
}

/** Called with every getBranding answer from Apps Script. */
export function applySupabaseConfigFromBranding(res: any): void {
  if (!res || typeof res !== 'object' || !('supabaseEnabled' in res)) return; // older backend: leave as is
  if (res.supabaseEnabled && res.supabaseUrl && res.supabaseAnonKey) {
    setSupabaseConfig({ url: String(res.supabaseUrl), anonKey: String(res.supabaseAnonKey) });
  } else {
    setSupabaseConfig(null);
  }
}

/** Per-station switch (Settings): use Apps Script only on this computer. */
export function isSupabaseOffHere(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1'; } catch (_) { return false; }
}
export function setSupabaseOffHere(off: boolean): void {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (_) {}
}

export type SupabaseErrorKind = 'auth' | 'conflict' | 'forbidden' | 'network' | 'server' | 'bad-request';

export class SupabaseError extends Error {
  kind: SupabaseErrorKind;
  status: number;
  constructor(kind: SupabaseErrorKind, message: string, status = 0) {
    super(message);
    this.name = 'SupabaseError';
    this.kind = kind;
    this.status = status;
  }
}

function authHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key };
  // New-style keys (sb_publishable_...) are not JWTs and must not go in the Authorization header.
  if (!/^sb_/.test(key)) h.Authorization = 'Bearer ' + key;
  return h;
}

export async function sbRpc<T = any>(fn: string, args: Record<string, unknown>, opts: { timeoutMs?: number; config?: SupabaseConfig } = {}): Promise<T> {
  const cfg = opts.config || getSupabaseConfig();
  if (!cfg) throw new SupabaseError('server', 'Supabase is not set up.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20000);
  let res: Response;
  try {
    res = await fetch(cfg.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { ...authHeaders(cfg.anonKey), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new SupabaseError('network', e?.name === 'AbortError' ? 'Supabase did not answer in time.' : 'Supabase could not be reached.');
  }
  let text = '';
  try { text = await res.text(); } catch (_) {} finally { clearTimeout(timer); }
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!res.ok) {
    const msg = String((body && (body.message || body.error || body.hint)) || text || 'HTTP ' + res.status);
    if (/VMS_AUTH/.test(msg)) throw new SupabaseError('auth', msg, res.status);
    if (/VMS_CONFLICT/.test(msg)) throw new SupabaseError('conflict', msg, res.status);
    if (/VMS_FORBIDDEN/.test(msg)) throw new SupabaseError('forbidden', msg.replace(/^VMS_FORBIDDEN:\s*/, ''), res.status);
    if (/VMS_BAD_REQUEST/.test(msg)) throw new SupabaseError('bad-request', msg, res.status);
    if (res.status >= 500 || res.status === 0 || res.status === 429) throw new SupabaseError('network', msg, res.status);
    throw new SupabaseError('server', msg, res.status);
  }
  return body as T;
}

/** Same rules as sbNormalizeUrl_ in Code.gs: accepts the Project URL in the forms people paste. */
export function normalizeSupabaseUrl(raw: string): string {
  let s = String(raw ?? '').replace(/[\s"'<>]/g, '');
  if (!s) return '';
  const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})/i);
  if (dash) return 'https://' + dash[1].toLowerCase() + '.supabase.co';
  if (/^[a-z0-9]{10,40}$/i.test(s) && !/\./.test(s)) return 'https://' + s.toLowerCase() + '.supabase.co';
  s = s.replace(/^[a-z]+:\/\//i, '');
  const host = s.split(/[/?#]/)[0].replace(/:443$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  return 'https://' + host;
}
