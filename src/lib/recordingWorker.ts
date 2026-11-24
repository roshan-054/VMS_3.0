/// <reference lib="webworker" />
/**
 * Off-main-thread recording worker.
 *
 * mode 'encode' (preferred): camera VideoFrames -> OffscreenCanvas (CCTV timestamp burned in)
 *   -> WebCodecs VideoEncoder -> MP4 (H.264) or WebM (VP9/VP8) muxer, entirely inside this worker.
 *   Every encoded frame keeps the camera's own capture timestamp, so a busy page (React renders,
 *   Sheets sync, uploads) can delay frames but can never drop them or squeeze them together:
 *   the file plays back at the exact camera cadence with no stutter and no time gaps.
 *
 * mode 'composite' (fallback): same compositing, but frames are handed to a
 *   MediaStreamTrackGenerator that feeds a regular MediaRecorder on the page.
 */
import { createOsdCache, drawOsd } from './videoOsd';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

type Post = (msg: any, transfer?: Transferable[]) => void;
const post: Post = (msg, transfer) => (self as unknown as Worker).postMessage(msg, transfer || []);

let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let stopRequested = false;

const CODECS: Array<{ codec: string; container: 'mp4' | 'webm'; muxCodec: string }> = [
  { codec: 'avc1.640028', container: 'mp4', muxCodec: 'avc' }, // H.264 High L4.0 (1080p30)
  { codec: 'avc1.4d0028', container: 'mp4', muxCodec: 'avc' }, // H.264 Main
  { codec: 'avc1.42e028', container: 'mp4', muxCodec: 'avc' }, // H.264 Baseline
  { codec: 'vp09.00.40.08', container: 'webm', muxCodec: 'V_VP9' },
  { codec: 'vp8', container: 'webm', muxCodec: 'V_VP8' },
];

export async function pickEncoderConfig(width: number, height: number, bitrate: number, preferWebm = false) {
  const list = preferWebm ? [...CODECS.filter((c) => c.container === 'webm'), ...CODECS.filter((c) => c.container === 'mp4')] : CODECS;
  for (const c of list) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      const config: VideoEncoderConfig = {
        codec: c.codec,
        width,
        height,
        bitrate,
        framerate: 30,
        hardwareAcceleration: hw,
        latencyMode: 'quality',
        bitrateMode: 'variable',
        ...(c.container === 'mp4' ? { avc: { format: 'avc' } } : {}),
      } as VideoEncoderConfig;
      try {
        const res = await VideoEncoder.isConfigSupported(config);
        if (res.supported) return { config: res.config || config, ...c };
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function runEncode(msg: any) {
  const { width, height, bitrate, keyFrameEverySec = 2, preferWebm = false } = msg;
  const picked = await pickEncoderConfig(width, height, bitrate, preferWebm);
  if (!picked) {
    post({ type: 'unsupported' });
    return;
  }

  const muxer: any =
    picked.container === 'mp4'
      ? new Mp4Muxer({
          target: new Mp4Target(),
          video: { codec: 'avc', width, height, frameRate: 30 },
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        })
      : new WebmMuxer({
          target: new WebmTarget(),
          video: { codec: picked.muxCodec as any, width, height, frameRate: 30 },
          firstTimestampBehavior: 'offset',
        });

  let bytes = 0;
  let encodeError: string | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      bytes += chunk.byteLength;
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      encodeError = String(e?.message || e);
    },
  });
  encoder.configure(picked.config);
  post({ type: 'started', mode: 'encode', codec: picked.codec, container: picked.container });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
  const cache = createOsdCache();
  reader = (msg.readable as ReadableStream<VideoFrame>).getReader();

  let frames = 0;
  let firstTs = -1;
  let wallAtFirst = -1;
  let warmup = 2;
  let lastKeyTs = -Infinity;
  let lastTs = -1;
  let lastProgress = 0;

  while (!stopRequested) {
    let r: ReadableStreamReadResult<VideoFrame>;
    try {
      r = await reader.read();
    } catch {
      break;
    }
    if (r.done || !r.value) break;
    const frame = r.value;
    if (warmup === 2) post({ type: 'first-frame' });
    if (warmup > 0) {
      // The first frames arrive while the camera clone and encoder spin up; starting the
      // timeline after them avoids a visible hitch at second 0.
      warmup--;
      frame.close();
      continue;
    }
    const ts = frame.timestamp; // camera capture time (µs)
    if (ts <= lastTs) {
      frame.close();
      continue; // never feed non-increasing timestamps to the muxer
    }
    lastTs = ts;
    if (firstTs < 0) firstTs = ts;

    // OSD clock follows the video timeline itself (wall time at the first frame + camera time since),
    // so the burned-in seconds advance exactly with playback: no skipped or repeated seconds.
    if (wallAtFirst < 0) wallAtFirst = Date.now();
    const captureWallMs = wallAtFirst + (ts - firstTs) / 1000;
    try {
      ctx.drawImage(frame, 0, 0, width, height);
    } finally {
      frame.close();
    }
    drawOsd(ctx, width, height, captureWallMs, true, cache);

    const out = new VideoFrame(canvas, { timestamp: ts - firstTs, duration: 33333 });
    const keyFrame = ts - lastKeyTs >= keyFrameEverySec * 1_000_000;
    if (keyFrame) lastKeyTs = ts;
    encoder.encode(out, { keyFrame });
    out.close();
    frames++;

    if (encodeError) break;
    const now = Date.now();
    if (now - lastProgress > 1000) {
      lastProgress = now;
      post({ type: 'progress', bytes, frames, queue: encoder.encodeQueueSize });
    }
  }

  try {
    await encoder.flush();
  } catch (e) {
    encodeError = encodeError || String((e as Error)?.message || e);
  }
  encoder.close();
  if (frames === 0 || bytes === 0) {
    post({ type: 'fatal', message: 'No video frames were received from the camera.' });
    return;
  }
  muxer.finalize();
  const buffer: ArrayBuffer = muxer.target.buffer;
  post(
    {
      type: 'done',
      buffer,
      mimeType: picked.container === 'mp4' ? 'video/mp4' : 'video/webm',
      frames,
      error: encodeError,
    },
    [buffer]
  );
}

async function runComposite(msg: any) {
  const { width, height } = msg;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
  const cache = createOsdCache();
  reader = (msg.readable as ReadableStream<VideoFrame>).getReader();
  const writer = (msg.writable as WritableStream<VideoFrame>).getWriter();
  post({ type: 'started', mode: 'composite' });
  while (!stopRequested) {
    let r: ReadableStreamReadResult<VideoFrame>;
    try {
      r = await reader.read();
    } catch {
      break;
    }
    if (r.done || !r.value) break;
    const frame = r.value;
    try {
      ctx.drawImage(frame, 0, 0, width, height);
      drawOsd(ctx, width, height, Date.now(), true, cache);
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp });
      writer.write(out).catch(() => out.close());
    } finally {
      frame.close();
    }
  }
  writer.close().catch(() => {});
  post({ type: 'done' });
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg?.type === 'encode' || msg?.type === 'composite') {
    stopRequested = false;
    const run = msg.type === 'encode' ? runEncode : runComposite;
    run(msg).catch((err) => post({ type: 'fatal', message: String(err?.message || err) }));
  } else if (msg?.type === 'stop') {
    stopRequested = true;
    reader?.cancel().catch(() => {});
  } else if (msg?.type === 'probe') {
    pickEncoderConfig(msg.width, msg.height, msg.bitrate).then((p) => post({ type: 'probe', codec: p?.codec || null }));
  }
};
