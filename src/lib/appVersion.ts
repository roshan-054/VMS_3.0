// Which build of the app this tab is running, and a light check for a newer published build.
import { fmtDateTime } from './dateFormat';

export const APP_BUILD: { id: string; time: string } =
  typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { id: 'dev', time: new Date().toISOString() };

export const appBuildLabel = () => `${fmtDateTime(APP_BUILD.time)} · ${APP_BUILD.id}`;

/** Fetch the published version.json (never from cache). Null when it can't be read (dev server, offline). */
export async function fetchPublishedBuild(): Promise<{ id: string; time: string } | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j.id === 'string' ? j : null;
  } catch {
    return null;
  }
}

/** Calls onNewer once when a different build is published. Checks every 5 minutes and when the tab is shown again. */
export function watchForNewBuild(onNewer: (b: { id: string; time: string }) => void, everyMs = 5 * 60 * 1000): () => void {
  let done = false;
  const check = async () => {
    if (done) return;
    const b = await fetchPublishedBuild();
    if (b && b.id !== APP_BUILD.id && !done) {
      done = true;
      onNewer(b);
    }
  };
  const onVis = () => { if (document.visibilityState === 'visible') check(); };
  const timer = window.setInterval(check, everyMs);
  document.addEventListener('visibilitychange', onVis);
  const first = window.setTimeout(check, 15000);
  return () => { done = true; clearInterval(timer); clearTimeout(first); document.removeEventListener('visibilitychange', onVis); };
}
