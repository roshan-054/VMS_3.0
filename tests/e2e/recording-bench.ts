// Bench page for tests/e2e/recording-smoothness.mjs. Records the fake camera with either the
// legacy pipeline ("old": 30 Hz timer painting a canvas on the main thread + captureStream(30) +
// MediaRecorder, as ScanRecord did before) or one of the new engine modes, while the main thread
// is periodically blocked to mimic a busy page.
import { startRecordingSession, lockedRecordingSize, type RecordingMode } from '../../src/lib/recordingPipeline';
import { createOsdCache, drawOsd } from '../../src/lib/videoOsd';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'webcodecs';
const seconds = Number(params.get('seconds') || 8);
const blockMs = Number(params.get('block') || 0);
const blockEvery = Number(params.get('every') || 400);

function legacy(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const { width, height } = lockedRecordingSize(video.videoWidth, video.videoHeight);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const cache = createOsdCache();
  const paint = () => {
    ctx.drawImage(video, 0, 0, width, height);
    drawOsd(ctx, width, height, Date.now(), true, cache);
  };
  const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = paint;
  paint();
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  return {
    mode: 'old',
    stop: () =>
      new Promise<{ blob: Blob }>((res) => {
        rec.onstop = () => {
          w.terminate();
          stream.getTracks().forEach((t) => t.stop());
          res({ blob: new Blob(chunks, { type: 'video/webm' }) });
        };
        rec.stop();
      }),
  };
}

function directRecorder(cam: MediaStream) {
  // Reference: camera recorded with no overlay at all (fully native, no page involvement).
  const rec = new MediaRecorder(cam, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  return { mode: 'direct', stop: () => new Promise<{ blob: Blob }>((res) => { rec.onstop = () => res({ blob: new Blob(chunks, { type: 'video/webm' }) }); rec.stop(); }) };
}

async function main() {
  const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: false });
  const video = document.getElementById('v') as HTMLVideoElement;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  video.srcObject = cam;
  await video.play();
  while (video.videoWidth === 0) await new Promise((r) => setTimeout(r, 20));

  const t0 = performance.now();
  const session: any =
    mode === 'direct'
      ? directRecorder(cam)
      : mode === 'old'
      ? legacy(video, canvas)
      : await startRecordingSession({
          cameraTrack: cam.getVideoTracks()[0],
          video,
          canvas,
          videoBitsPerSecond: 2_500_000,
          forceMode: mode as RecordingMode,
          preferWebm: params.get('webm') === '1',
        });

  let blocker: number | null = null;
  if (blockMs > 0) {
    blocker = window.setInterval(() => {
      const end = performance.now() + blockMs;
      while (performance.now() < end) {
        /* simulate a heavy render / JSON parse */
      }
    }, blockEvery);
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));
  if (blocker) clearInterval(blocker);
  const { blob } = await session.stop();
  const wall = (performance.now() - t0) / 1000;
  cam.getTracks().forEach((t) => t.stop());

  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  (window as any).__result = { mode: session.mode, codec: session.codec, wall, size: blob.size, type: blob.type, b64: btoa(bin) };
}

main().catch((e) => ((window as any).__result = { error: String(e?.message || e) }));
