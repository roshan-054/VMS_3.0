/**
 * Streamed full-quality playback through the backend.
 *
 * The page registers public/video-sw.js. The video player then plays /video-stream/<fileId>,
 * and the worker asks this tab for byte ranges. This tab reads the original file from Drive
 * through the Apps Script backend in 4 MB pieces, a few pieces ahead of the playhead, so
 * playback starts after the first piece instead of after the whole file is downloaded.
 */
import { fetchChunk, decodeBase64 } from './videoFetch';

export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;
const READ_AHEAD = 3; // pieces fetched in parallel ahead of the one being played
const MAX_CACHED_PIECES = 32; // ~128 MB across all videos

interface FileInfo {
  size: number;
  mimeType: string;
}
const info = new Map<string, FileInfo>();
const pieces = new Map<string, Promise<Uint8Array>>(); // key fileId:index, insertion order = LRU

function piece(fileId: string, index: number): Promise<Uint8Array> {
  const key = `${fileId}:${index}`;
  const hit = pieces.get(key);
  if (hit) {
    pieces.delete(key);
    pieces.set(key, hit);
    return hit;
  }
  const p = fetchChunk(fileId, index * STREAM_CHUNK_BYTES, undefined, STREAM_CHUNK_BYTES).then((r) => {
    info.set(fileId, { size: r.size, mimeType: r.mimeType || 'video/mp4' });
    return decodeBase64(r.data);
  });
  p.catch(() => pieces.delete(key));
  pieces.set(key, p);
  while (pieces.size > MAX_CACHED_PIECES) pieces.delete(pieces.keys().next().value as string);
  return p;
}

/** Bytes from `start` to the end of the 4 MB piece that holds it (or `end`, if sooner). */
export async function readVideoRange(
  fileId: string,
  start: number,
  end = Infinity
): Promise<{ size: number; mimeType: string; bytes: Uint8Array }> {
  const index = Math.floor(start / STREAM_CHUNK_BYTES);
  const data = await piece(fileId, index);
  const meta = info.get(fileId) || { size: start + data.length, mimeType: 'video/mp4' };
  // Keep the next pieces on their way so playback does not wait on the backend.
  const lastIndex = Math.ceil(meta.size / STREAM_CHUNK_BYTES) - 1;
  for (let i = index + 1; i <= Math.min(lastIndex, index + READ_AHEAD); i++) piece(fileId, i).catch(() => {});
  const from = start - index * STREAM_CHUNK_BYTES;
  const to = Math.min(data.length, end === Infinity ? data.length : end - index * STREAM_CHUNK_BYTES + 1);
  return { size: meta.size, mimeType: meta.mimeType, bytes: data.slice(Math.max(0, from), Math.max(from, to)) };
}

let ready: Promise<boolean> | null = null;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data || {};
    if (d.type !== 'vms-video-range' || !ev.ports[0]) return;
    const port = ev.ports[0];
    readVideoRange(String(d.fileId), Number(d.start) || 0, d.end == null ? Infinity : Number(d.end))
      .then((r) => {
        const buf = r.bytes.buffer as ArrayBuffer;
        port.postMessage({ ok: true, size: r.size, mimeType: r.mimeType, bytes: buf }, [buf]);
      })
      .catch((err: any) => port.postMessage({ ok: false, error: err?.message || String(err) }));
  });
}

/**
 * Registers the stream worker and resolves true once it controls this tab. Resolves false when
 * the browser cannot do it (no service worker support, private mode, http), so callers fall back.
 */
export function ensureVideoStreamWorker(timeoutMs = 4000): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return false;
    try {
      listen();
      const base = new URL('./', document.baseURI);
      const reg = await navigator.serviceWorker.register(new URL('video-sw.js', base).href, { scope: base.href });
      if (navigator.serviceWorker.controller) return true;
      const controlled = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), timeoutMs);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(t);
          resolve(true);
        }, { once: true });
      });
      // After a hard reload (Ctrl+Shift+R) the worker is already active but does not control this
      // tab, and no controllerchange comes on its own: ask it to take control.
      // (A worker that is still installing claims the tab itself when it activates.)
      reg.active?.postMessage({ type: 'vms-claim' });
      return await controlled;
    } catch (err) {
      console.warn('Video stream worker unavailable:', err);
      return false;
    }
  })();
  ready.then((ok) => {
    if (!ok) ready = null; // allow another try later
  });
  return ready;
}

export function getBackendStreamUrl(fileId: string): string {
  return new URL(`video-stream/${encodeURIComponent(fileId)}`, new URL('./', document.baseURI)).href;
}
