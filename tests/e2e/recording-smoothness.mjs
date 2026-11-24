// Measures recorded-video smoothness for each pipeline under main-thread load.
// Usage: start `npx vite --port 5179 --strictPort` in the repo, then `node tests/e2e/recording-smoothness.mjs`.
// Needs ffprobe on PATH. Reports frame-interval statistics from the encoded file.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BENCH_URL || 'http://localhost:5179/tests/e2e/recording-bench.html';
const modes = (process.env.MODES || 'old,webcodecs').split(',');
const loads = (process.env.LOADS || '0,150').split(',').map(Number);
const every = Number(process.env.EVERY || 400);
const trials = Number(process.env.TRIALS || 1);
const seconds = Number(process.env.SECONDS || 8);
const dir = mkdtempSync(join(tmpdir(), 'rec-bench-'));

function analyse(file, wall) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file]).toString();
  const pts = out.split('\n').map(Number).filter((n) => !Number.isNaN(n) && n >= 0).sort((a, b) => a - b);
  const d = pts.slice(1).map((t, i) => t - pts[i]);
  const sorted = [...d].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const gaps = d.filter((x) => x > 0.07).length; // a missing frame or more at 30 fps
  const maxGap = Math.max(0, ...d);
  const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const jitter = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length || 1));
  return {
    frames: pts.length,
    fps: +(pts.length / (pts.at(-1) - pts[0] || 1)).toFixed(1),
    medianMs: +(median * 1000).toFixed(1),
    jitterMs: +(jitter * 1000).toFixed(1),
    gapsOver70ms: gaps,
    maxGapMs: +(maxGap * 1000).toFixed(0),
    videoSec: +(pts.at(-1) - pts[0]).toFixed(2),
    wallSec: +wall.toFixed(2),
  };
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'],
});
const rows = [];
for (const load of loads) {
  for (const mode of modes) for (let t = 0; t < trials; t++) {
    const page = await browser.newPage();
    await page.goto(`${BASE}?mode=${mode}&seconds=${seconds}&block=${load}&every=${every}`);
    await page.waitForFunction(() => window.__result, null, { timeout: (seconds + 30) * 1000 });
    const r = await page.evaluate(() => window.__result);
    await page.close();
    if (r.error) { rows.push({ mode, load, error: r.error }); continue; }
    const file = join(dir, `${mode}-${load}-${t}.${(r.type || '').includes('mp4') ? 'mp4' : 'webm'}`);
    writeFileSync(file, Buffer.from(r.b64, 'base64'));
    rows.push({ requested: mode, used: r.mode, codec: (r.codec || '').slice(0, 12), stallMs: load, ...analyse(file, r.wall) });
  }
}
await browser.close();
console.table(rows);
console.log('files in', dir);
if (process.env.ASSERT) {
  const bad = rows.filter((r) => r.used === 'webcodecs' && (r.gapsOver70ms > 0 || r.error));
  if (bad.length) { console.error('Worker pipeline produced gaps:', bad); process.exit(1); }
}
