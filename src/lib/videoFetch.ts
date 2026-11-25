/**
 * Full-quality playback: downloads the ORIGINAL uploaded recording from Google Drive (through the
 * Apps Script backend, in byte ranges) so the panel can play it at its recorded resolution.
 * Drive's own /preview player re-encodes videos to a lower resolution and often shows
 * "still processing" right after an upload.
 */
import { requestApi } from './api';

export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024; // the backend's maximum per call
const PARALLEL = 6;
const RETRIES = 2;

export interface ChunkResponse {
  size: number;
  start: number;
  length: number;
  mimeType?: string;
  name?: string;
  data: string;
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function fetchChunk(fileId: string, start: number, signal?: AbortSignal, length = VIDEO_CHUNK_BYTES): Promise<ChunkResponse> {
  let lastErr: any;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = (await requestApi('getVideoChunk', { fileId, start, length })) as unknown as ChunkResponse & { success: boolean; error?: string };
      if (!res.success) throw new Error(res.error || 'Could not read the video.');
      return res;
    } catch (err: any) {
      lastErr = err;
      // "Not a packing video" or a sign-in problem will not get better by retrying.
      if (err?.code === 'NOT_A_VMS_VIDEO' || err?.code === 'AUTH_REQUIRED') break;
    }
  }
  throw lastErr;
}

/** Downloads the whole original file. onProgress gets (loadedBytes, totalBytes). */
export async function fetchOriginalVideo(
  fileId: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; size: number; mimeType: string }> {
  const first = await fetchChunk(fileId, 0, signal);
  const total = first.size;
  const mimeType = first.mimeType || 'video/mp4';
  const parts: Uint8Array[] = [decodeBase64(first.data)];
  let loaded = parts[0].length;
  onProgress?.(loaded, total);

  const starts: number[] = [];
  for (let s = first.length; s < total; s += VIDEO_CHUNK_BYTES) starts.push(s);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const idx = next++;
      const r = await fetchChunk(fileId, starts[idx], signal);
      const bytes = decodeBase64(r.data);
      parts[idx + 1] = bytes;
      loaded += bytes.length;
      onProgress?.(loaded, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, starts.length) }, worker));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const blob = new Blob(parts as BlobPart[], { type: mimeType });
  if (blob.size !== total) throw new Error(`Video download incomplete (${blob.size} of ${total} bytes).`);
  return { blob, size: total, mimeType };
}

// Keep the last few full-quality videos in memory so reopening one is instant.
type Progress = (loaded: number, total: number) => void;
interface Entry {
  url: Promise<string>;
  listeners: Set<Progress>;
  last: [number, number];
}
const cache = new Map<string, Entry>();
const MAX_CACHED = 3;

/**
 * Object URL of the original file, downloaded once per session per file. Returns an unsubscribe
 * function for the progress listener alongside the URL promise.
 */
export function getOriginalVideoUrl(fileId: string, onProgress?: Progress): { url: Promise<string>; unsubscribe: () => void } {
  let e = cache.get(fileId);
  if (e) {
    cache.delete(fileId);
    cache.set(fileId, e); // most recently used
  } else {
    const entry: Entry = { url: Promise.resolve(''), listeners: new Set(), last: [0, 0] };
    entry.url = fetchOriginalVideo(fileId, (l, t) => {
      entry.last = [l, t];
      entry.listeners.forEach((fn) => fn(l, t));
    }).then(({ blob }) => URL.createObjectURL(blob));
    entry.url.catch(() => cache.delete(fileId));
    cache.set(fileId, entry);
    e = entry;
    while (cache.size > MAX_CACHED) {
      const [oldId, old] = cache.entries().next().value as [string, Entry];
      cache.delete(oldId);
      old.url.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    }
  }
  const entry = e;
  if (onProgress) {
    entry.listeners.add(onProgress);
    if (entry.last[1]) onProgress(entry.last[0], entry.last[1]);
  }
  return { url: entry.url, unsubscribe: () => onProgress && entry.listeners.delete(onProgress) };
}

/**
 * Direct stream of the original file from Google Drive. Packing videos are shared "anyone with the
 * link can view", so the browser's own video player can read the file in ranges straight from
 * Drive: it starts in a second or two at full quality and seeks without downloading everything.
 * confirm=t skips Drive's "too large to scan for viruses" page for files over 100 MB.
 */
export function getDriveStreamUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

// When the direct Drive stream fails on this computer (blocked network, Drive refusing anonymous
// reads), remember it for a week so later videos skip straight to the backend stream instead of
// waiting for the direct stream to time out every time.
const STREAM_BROKEN_KEY = 'vms_drive_stream_broken_until';
const STREAM_BROKEN_MS = 7 * 24 * 3600 * 1000;
let streamFailures = 0;
function readBrokenUntil(): number {
  try {
    return Number(localStorage.getItem(STREAM_BROKEN_KEY)) || 0;
  } catch (_) {
    return 0;
  }
}
export function isDriveStreamUsable(): boolean {
  return streamFailures < 1 && readBrokenUntil() < Date.now();
}
export function reportDriveStreamResult(ok: boolean): void {
  streamFailures = ok ? 0 : streamFailures + 1;
  try {
    if (ok) localStorage.removeItem(STREAM_BROKEN_KEY);
    else localStorage.setItem(STREAM_BROKEN_KEY, String(Date.now() + STREAM_BROKEN_MS));
  } catch (_) {}
}
