/// <reference lib="webworker" />
/**
 * Off-main-thread recording worker.
 *
 * 'attach' (once per camera): the camera's raw VideoFrames (MediaStreamTrackProcessor) are pumped
 *   through this worker for as long as the camera is on. Between recordings frames are simply
 *   released, so there is one long-lived camera feed instead of a new one per order (Chrome can stop
 *   delivering frames to newly created processors after a couple of recordings).
 * 'encode' / 'stop': while a recording is active, each frame is drawn onto an OffscreenCanvas with
 *   the CCTV timestamp and encoded with WebCodecs into MP4 (H.264) or WebM (VP9/VP8), entirely in
 *   this worker. Every encoded frame keeps the camera's own capture timestamp, so a busy page can
 *   delay frames but never drop or bunch them: no stutter and no time gaps.
 * 'composite' (fallback, used with the microphone on): same drawing, frames go to a
 *   MediaStreamTrackGenerator that feeds a regular MediaRecorder on the page.
 */
import { createOsdCache, drawOsd } from './videoOsd';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

const post = (msg: any, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(msg, transfer || []);

const CODECS: Array<{ codec: string; container: 'mp4' | 'webm'; muxCodec: string }> = [
  { codec: 'avc1.640028', container: 'mp4', muxCodec: 'avc' }, // H.264 High L4.0 (1080p30)
  { codec: 'avc1.4d0028', container: 'mp4', muxCodec: 'avc' }, // H.264 Main
  { codec: 'avc1.42e028', container: 'mp4', muxCodec: 'avc' }, // H.264 Baseline
  { codec: 'vp09.00.40.08', container: 'webm', muxCodec: 'V_VP9' },
  { codec: 'vp8', container: 'webm', muxCodec: 'V_VP8' },
];

/** Above 1080p the codec level must be raised (H.264 L5.1, VP9 L5.1) or the encoder refuses the size. */
function codecForSize(codec: string, width: number, height: number): string {
  if (width * height <= 1920 * 1088) return codec;
  if (codec.startsWith('avc1.')) return codec.slice(0, -2) + '33';
  if (codec.startsWith('vp09.')) return codec.replace('vp09.00.40.08', 'vp09.00.51.08');
  return codec;
}

async function pickEncoderConfig(width: number, height: number, bitrate: number, preferWebm = false) {
  const list = (preferWebm ? [...CODECS.filter((c) => c.container === 'webm'), ...CODECS.filter((c) => c.container === 'mp4')] : CODECS).map((c) => ({
    ...c,
    codec: codecForSize(c.codec, width, height),
  }));
  for (const c of list) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      const config = {
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

interface Session {
  width: number;
  height: number;
  keyFrameUs: number;
  container: 'mp4' | 'webm';
  encoder: VideoEncoder;
  muxer: any;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  cache: ReturnType<typeof createOsdCache>;
  bytes: number;
  frames: number;
  seen: number;
  firstTs: number;
  wallAtFirst: number;
  lastKeyTs: number;
  lastTs: number;
  lastProgress: number;
  error: string | null;
}

let session: Session | null = null;
let feedReader: ReadableStreamDefaultReader<VideoFrame> | null = null;

function encodeFrame(s: Session, frame: VideoFrame) {
  s.seen++;
  if (s.seen === 1) post({ type: 'first-frame' });
  // Start the timeline after the first two frames, which can arrive while the encoder spins up.
  if (s.seen <= 2) return;
  const ts = frame.timestamp; // camera capture time (µs)
  if (ts <= s.lastTs) return; // never feed non-increasing timestamps to the muxer
  s.lastTs = ts;
  if (s.firstTs < 0) {
    s.firstTs = ts;
    s.wallAtFirst = Date.now();
  }
  // OSD clock follows the video timeline itself (wall time at the first frame + camera time since),
  // so the burned-in seconds advance exactly with playback: no skipped or repeated seconds.
  const wall = s.wallAtFirst + (ts - s.firstTs) / 1000;
  s.ctx.drawImage(frame, 0, 0, s.width, s.height);
  drawOsd(s.ctx, s.width, s.height, wall, true, s.cache);
  const out = new VideoFrame(s.canvas, { timestamp: ts - s.firstTs, duration: 33333 });
  const keyFrame = ts - s.lastKeyTs >= s.keyFrameUs;
  if (keyFrame) s.lastKeyTs = ts;
  s.encoder.encode(out, { keyFrame });
  out.close();
  s.frames++;
  const now = Date.now();
  if (now - s.lastProgress > 1000) {
    s.lastProgress = now;
    post({ type: 'progress', bytes: s.bytes, frames: s.frames, queue: s.encoder.encodeQueueSize });
  }
}

async function pumpFeed(readable: ReadableStream<VideoFrame>) {
  feedReader?.cancel().catch(() => {});
  const reader = readable.getReader();
  feedReader = reader;
  for (;;) {
    let r: ReadableStreamReadResult<VideoFrame>;
    try {
      r = await reader.read();
    } catch {
      break;
    }
    if (r.done || !r.value) break;
    const frame = r.value;
    try {
      if (session && !session.error) encodeFrame(session, frame);
    } catch (err) {
      if (session) session.error = String((err as Error)?.message || err);
    } finally {
      frame.close();
    }
  }
  if (feedReader === reader) feedReader = null;
  post({ type: 'feed-ended' });
}

async function startSession(msg: any) {
  const { width, height, bitrate, keyFrameEverySec = 2, preferWebm = false } = msg;
  if (session) await finishSession(); // never two at once
  const picked = await pickEncoderConfig(width, height, bitrate, preferWebm);
  if (!picked) {
    post({ type: 'unsupported' });
    return;
  }
  const muxer =
    picked.container === 'mp4'
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width, height, frameRate: 30 }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
      : new WebmMuxer({ target: new WebmTarget(), video: { codec: picked.muxCodec as any, width, height, frameRate: 30 }, firstTimestampBehavior: 'offset' });
  const canvas = new OffscreenCanvas(width, height);
  const s: Session = {
    width,
    height,
    keyFrameUs: keyFrameEverySec * 1_000_000,
    container: picked.container,
    muxer,
    canvas,
    ctx: canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D,
    cache: createOsdCache(),
    bytes: 0,
    frames: 0,
    seen: 0,
    firstTs: -1,
    wallAtFirst: -1,
    lastKeyTs: -Infinity,
    lastTs: -1,
    lastProgress: 0,
    error: null,
    encoder: null as unknown as VideoEncoder,
  };
  s.encoder = new VideoEncoder({
    output: (chunk, meta) => {
      s.bytes += chunk.byteLength;
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      s.error = String(e?.message || e);
    },
  });
  s.encoder.configure(picked.config);
  session = s;
  post({ type: 'started', codec: picked.codec, container: picked.container });
}

async function finishSession() {
  const s = session;
  session = null;
  if (!s) {
    post({ type: 'fatal', message: 'No recording in progress.' });
    return;
  }
  try {
    await s.encoder.flush();
  } catch (e) {
    s.error = s.error || String((e as Error)?.message || e);
  }
  try {
    s.encoder.close();
  } catch {
    /* already closed */
  }
  if (s.frames === 0 || s.bytes === 0) {
    post({ type: 'fatal', message: s.error || 'No video frames were received from the camera.' });
    return;
  }
  s.muxer.finalize();
  const buffer: ArrayBuffer = s.muxer.target.buffer;
  post({ type: 'done', buffer, mimeType: s.container === 'mp4' ? 'video/mp4' : 'video/webm', frames: s.frames, error: s.error }, [buffer]);
}

async function runComposite(msg: any) {
  const { width, height } = msg;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
  const cache = createOsdCache();
  const reader = (msg.readable as ReadableStream<VideoFrame>).getReader();
  feedReader = reader;
  const writer = (msg.writable as WritableStream<VideoFrame>).getWriter();
  post({ type: 'started', mode: 'composite' });
  for (;;) {
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
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data || {};
  const fail = (err: any) => post({ type: 'fatal', message: String(err?.message || err) });
  if (msg.type === 'attach') pumpFeed(msg.readable).catch(fail);
  else if (msg.type === 'encode') startSession(msg).catch(fail);
  else if (msg.type === 'stop') finishSession().catch(fail);
  else if (msg.type === 'detach') feedReader?.cancel().catch(() => {});
  else if (msg.type === 'composite') runComposite(msg).catch(fail);
};
