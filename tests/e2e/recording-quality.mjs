// Records the (fake) 1080p camera with the old default (2.2 Mbps) and with the new "Highest quality"
// default (bitrate chosen from the size), then reads the files with ffprobe: resolution, real bitrate,
// and smoothness (no frame gaps). Usage: dev server on :5179, then node tests/e2e/recording-quality.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BENCH_URL || 'http://localhost:5179/tests/e2e/recording-bench.html';
const dir = mkdtempSync(join(tmpdir(), 'rec-quality-'));
const seconds = 6;
const probe = (file) => {
  const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,profile', '-show_entries', 'format=size,duration', '-of', 'json', file]).toString());
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]).toString()
    .split('\n').map(Number).filter((n) => !Number.isNaN(n) && n >= 0).sort((a, b) => a - b);
  const d = pts.slice(1).map((t, i) => t - pts[i]);
  const dur = pts.at(-1) - pts[0];
  return {
    size: `${s.streams[0].width}x${s.streams[0].height}`,
    codec: `${s.streams[0].codec_name} ${s.streams[0].profile || ''}`.trim(),
    mbps: +((Number(s.format.size) * 8) / dur / 1e6).toFixed(2),
    fps: +(pts.length / dur).toFixed(1),
    gapsOver70ms: d.filter((x) => x > 0.07).length,
  };
};

const browser = await chromium.launch({
  // CAM_FILE: an .mjpeg clip with real detail (noise), so the encoder actually needs the bits.
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required',
    ...(process.env.CAM_FILE ? [`--use-file-for-fake-video-capture=${process.env.CAM_FILE}`] : [])],
});
const cases = [
  { name: 'old default (Balanced 2.2 Mbps)', q: 'bitrate=2200000' },
  { name: 'new default (Highest quality)', q: 'bitrate=0&max=1' },
];
const rows = [];
for (const c of cases) {
  const page = await browser.newPage();
  await page.goto(`${BASE}?mode=webcodecs&seconds=${seconds}&w=1920&h=1080&${c.q}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
  const r = await page.evaluate(() => window.__result);
  await page.close();
  if (r.error) { rows.push({ case: c.name, error: r.error }); continue; }
  const file = join(dir, `${rows.length}.${(r.type || '').includes('mp4') ? 'mp4' : 'webm'}`);
  writeFileSync(file, Buffer.from(r.b64, 'base64'));
  rows.push({ case: c.name, engine: r.mode, ...probe(file) });
}
await browser.close();
console.table(rows);
const [oldR, newR] = rows;
const ok = newR && !newR.error && newR.size === '1920x1080' && newR.mbps >= 6.5 && newR.mbps > oldR.mbps * 1.5 && newR.gapsOver70ms === 0;
console.log(ok ? 'PASS: full 1080p at a much higher bitrate, no frame gaps' : 'FAIL', 'files in', dir);
process.exit(ok ? 0 : 1);
