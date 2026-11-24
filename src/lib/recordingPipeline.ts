/**
 * Recording engine for the Scan & Record station.
 *
 * Produces the packing video (camera frames + burned-in CCTV timestamp) using the smoothest
 * strategy the browser supports:
 *
 *  1. 'webcodecs'      Chrome/Edge (desktop): camera frames are composited AND encoded inside a Web Worker
 *                      with WebCodecs, keeping each frame's camera capture timestamp. Main-thread work
 *                      (UI, Sheets sync, uploads) cannot drop frames or create time gaps. Output: MP4 (H.264),
 *                      or WebM (VP9/VP8) where H.264 encoding is unavailable.
 *  2. 'worker-recorder' Same worker compositing, recorded with MediaRecorder (used when audio is on).
 *  3. 'frame-callback' requestVideoFrameCallback + canvas.captureStream(0): one frame per camera frame.
 *  4. 'timer'          Legacy 30 Hz timer, only for very old browsers.
 */
import { createOsdCache, drawOsd } from './videoOsd';

export type RecordingMode = 'webcodecs' | 'worker-recorder' | 'frame-callback' | 'timer';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
}

export interface RecordingSession {
  mode: RecordingMode;
  codec: string;
  width: number;
  height: number;
  stop: () => Promise<RecordingResult>;
}

export interface StartRecordingOptions {
  cameraTrack: MediaStreamTrack;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  audioTracks?: MediaStreamTrack[];
  videoBitsPerSecond: number;
  onProgress?: (bytes: number) => void;
  onError?: (message: string) => void;
  forceMode?: RecordingMode;
  /** For tests: prefer the WebM encoder even when H.264 is available. */
  preferWebm?: boolean;
}

/** Even dimensions (required by H.264 4:2:0), capped at 1920x1080, aspect ratio preserved. */
export function lockedRecordingSize(vw: number, vh: number): { width: number; height: number } {
  const w = vw || 1280;
  const h = vh || 720;
  const s = Math.min(1, 1920 / w, 1080 / h);
  return { width: Math.max(2, Math.floor(w * s) & ~1), height: Math.max(2, Math.floor(h * s) & ~1) };
}

const g = globalThis as any;
const hasProcessor = () => typeof g.MediaStreamTrackProcessor === 'function' && typeof g.VideoFrame === 'function' && typeof g.OffscreenCanvas === 'function';
const hasGenerator = () => typeof g.MediaStreamTrackGenerator === 'function';
const hasEncoder = () => typeof g.VideoEncoder === 'function';

export function chooseRecorderMimeType(hasAudio: boolean): string {
  const candidates = hasAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E028,mp4a.40.2', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d4028', 'video/mp4;codecs=avc1.42E028', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm'];
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const t of candidates) if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function newWorker(): Worker {
  return new Worker(new URL('./recordingWorker.ts', import.meta.url), { type: 'module' });
}

function cleanMime(m: string): string {
  return (m || 'video/webm').split(';')[0];
}

async function startWebCodecs(o: StartRecordingOptions, width: number, height: number): Promise<RecordingSession | null> {
  // Read the live camera track itself (not a clone): a clone can stop receiving frames after the
  // auto-focus code changes camera constraints. Cancelling the reader at stop releases it without
  // stopping the preview. Buffer up to ~2 s so a stalled page delays frames instead of dropping them.
  const processor = new g.MediaStreamTrackProcessor({ track: o.cameraTrack, maxBufferSize: 60 });
  const worker = newWorker();

  let resolveDone: (r: RecordingResult) => void;
  let rejectDone: (e: Error) => void;
  const done = new Promise<RecordingResult>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  let codec = '';
  const started = new Promise<{ ok: boolean; codec?: string }>((resolve) => {
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'started') codec = m.codec;
      else if (m.type === 'first-frame') resolve({ ok: true, codec });
      else if (m.type === 'unsupported') resolve({ ok: false });
      else if (m.type === 'progress') o.onProgress?.(m.bytes);
      else if (m.type === 'done') {
        if (m.error) o.onError?.(m.error);
        resolveDone(cleanResult(new Blob([m.buffer], { type: m.mimeType }), m.mimeType));
      } else if (m.type === 'fatal') {
        resolve({ ok: false });
        o.onError?.(m.message);
        rejectDone(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      resolve({ ok: false });
      rejectDone(new Error(ev.message || 'recording worker failed'));
    };
  });

  worker.postMessage(
    { type: 'encode', readable: processor.readable, width, height, bitrate: o.videoBitsPerSecond, preferWebm: !!o.preferWebm },
    [processor.readable]
  );
  // Only commit to this engine once camera frames are actually flowing through it; otherwise the
  // caller falls back to another engine, so a recording is never lost.
  const st = await Promise.race([started, new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: false }), 3000))]);
  if (!st.ok) {
    worker.postMessage({ type: 'stop' });
    setTimeout(() => worker.terminate(), 200);
    return null;
  }

  return {
    mode: 'webcodecs',
    codec: (st as any).codec || '',
    width,
    height,
    stop: async () => {
      worker.postMessage({ type: 'stop' });
      try {
        return await done;
      } finally {
        worker.terminate();
      }
    },
  };
}

function cleanResult(blob: Blob, mimeType: string): RecordingResult {
  return { blob, mimeType: cleanMime(mimeType) };
}

function workerCompositeStream(o: StartRecordingOptions, width: number, height: number) {
  const processor = new g.MediaStreamTrackProcessor({ track: o.cameraTrack, maxBufferSize: 30 });
  const generator = new g.MediaStreamTrackGenerator({ kind: 'video' });
  const worker = newWorker();
  worker.postMessage({ type: 'composite', readable: processor.readable, writable: generator.writable, width, height }, [
    processor.readable,
    generator.writable,
  ]);
  return {
    stream: new MediaStream([generator]),
    stop: () => {
      worker.postMessage({ type: 'stop' });
      setTimeout(() => {
        worker.terminate();
        generator.stop();
      }, 300);
    },
  };
}

function canvasStream(video: HTMLVideoElement, canvas: HTMLCanvasElement, width: number, height: number, allowRvfc: boolean) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const cache = createOsdCache();
  let active = true;
  const paint = () => {
    if (video.readyState < 2) return false;
    ctx.imageSmoothingEnabled = video.videoWidth !== width || video.videoHeight !== height;
    ctx.drawImage(video, 0, 0, width, height);
    drawOsd(ctx, width, height, Date.now(), true, cache);
    return true;
  };

  if (allowRvfc && typeof (video as any).requestVideoFrameCallback === 'function') {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    if (typeof track.requestFrame === 'function') {
      const onFrame = () => {
        if (!active) return;
        if (paint()) track.requestFrame!();
        (video as any).requestVideoFrameCallback(onFrame);
      };
      if (paint()) track.requestFrame();
      (video as any).requestVideoFrameCallback(onFrame);
      return { stream, mode: 'frame-callback' as const, stop: () => { active = false; stream.getTracks().forEach((t) => t.stop()); } };
    }
    stream.getTracks().forEach((t) => t.stop());
  }

  const stream = canvas.captureStream(30);
  let worker: Worker | null = null;
  let interval: number | null = null;
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => active && paint();
  } catch {
    interval = window.setInterval(() => active && paint(), 33);
  }
  paint();
  return {
    stream,
    mode: 'timer' as const,
    stop: () => {
      active = false;
      worker?.terminate();
      if (interval) clearInterval(interval);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

function startMediaRecorder(
  o: StartRecordingOptions,
  built: { stream: MediaStream; stop: () => void },
  mode: RecordingMode,
  width: number,
  height: number
): RecordingSession {
  const audio = o.audioTracks || [];
  audio.forEach((t) => built.stream.addTrack(t));
  const mimeType = chooseRecorderMimeType(audio.length > 0);
  const opts: MediaRecorderOptions = {
    videoBitsPerSecond: o.videoBitsPerSecond,
    ...(audio.length ? { audioBitsPerSecond: 128000 } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(built.stream, opts);
  } catch {
    rec = new MediaRecorder(built.stream);
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      bytes += e.data.size;
      o.onProgress?.(bytes);
    }
  };
  rec.onerror = (ev: any) => o.onError?.(String(ev?.error?.message || ev?.error || 'MediaRecorder error'));
  rec.start(1000);
  return {
    mode,
    codec: rec.mimeType || mimeType,
    width,
    height,
    stop: () =>
      new Promise<RecordingResult>((resolve) => {
        const finish = () => {
          built.stop();
          const type = rec.mimeType || mimeType || 'video/webm';
          resolve(cleanResult(new Blob(chunks, { type: cleanMime(type) }), type));
        };
        if (rec.state === 'inactive') return finish();
        rec.onstop = finish;
        try {
          rec.requestData();
        } catch {
          /* optional */
        }
        rec.stop();
      }),
  };
}

export async function startRecordingSession(o: StartRecordingOptions): Promise<RecordingSession> {
  const settings = o.cameraTrack.getSettings?.() || {};
  const { width, height } = lockedRecordingSize(o.video.videoWidth || settings.width || 1280, o.video.videoHeight || settings.height || 720);
  const want = o.forceMode;
  const hasAudio = (o.audioTracks || []).length > 0;

  if ((!want || want === 'webcodecs') && !hasAudio && hasProcessor() && hasEncoder()) {
    try {
      const s = await startWebCodecs(o, width, height);
      if (s) return s;
    } catch (err) {
      console.warn('WebCodecs recorder unavailable, falling back:', err);
    }
  }
  if ((!want || want === 'worker-recorder') && hasProcessor() && hasGenerator()) {
    try {
      return startMediaRecorder(o, workerCompositeStream(o, width, height), 'worker-recorder', width, height);
    } catch (err) {
      console.warn('Worker compositor unavailable, falling back:', err);
    }
  }
  const c = canvasStream(o.video, o.canvas, width, height, want !== 'timer');
  return startMediaRecorder(o, c, c.mode, width, height);
}
