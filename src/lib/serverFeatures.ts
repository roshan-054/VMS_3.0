/**
 * Detects whether the optional VMS station server (server.ts) is serving this page.
 *
 * GitHub Pages only hosts the static app, so /api/* and /ws-scanner do not exist there.
 * Features that need the server (WebSocket phone relay, fast Drive upload proxy, Sheet CSV
 * proxy) check this first instead of failing on every request.
 */

export interface StationServerInfo {
  available: boolean;
}

const RECHECK_MS = 5 * 60 * 1000;
let cached: { info: StationServerInfo; at: number } | null = null;
let inflight: Promise<StationServerInfo> | null = null;

async function probe(): Promise<StationServerInfo> {
  const none: StationServerInfo = { available: false };
  if (typeof fetch === 'undefined') return none;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return none;
    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'ok' || !data.realtimeScannerWs) return none;
    return { available: true };
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

export function getStationServerInfo(force = false): Promise<StationServerInfo> {
  if (!force && cached && Date.now() - cached.at < RECHECK_MS) return Promise.resolve(cached.info);
  if (inflight) return inflight;
  inflight = probe().then((info) => {
    cached = { info, at: Date.now() };
    inflight = null;
    return info;
  });
  return inflight;
}

export async function hasStationServer(): Promise<boolean> {
  return (await getStationServerInfo()).available;
}

/** Test hook. */
export function _resetStationServerCache() {
  cached = null;
  inflight = null;
}
