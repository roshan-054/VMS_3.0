// End-to-end: records a packing video in the real app (fake camera) against the real Code.gs
// backend, while measuring main-thread long tasks, then checks the saved file's frame timing.
// Usage: dev server on :5179 (npx vite --port 5179 --strictPort), then node tests/e2e/app-recording.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SECONDS = Number(process.env.SECONDS || 10);
const dir = mkdtempSync(join(tmpdir(), 'app-rec-'));

const backend = createMockBackend({ manifests: Number(process.env.MANIFESTS || 2800) });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
if (process.env.CPU_THROTTLE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE) });
}
await page.addInitScript(() => {
  window.__longTasks = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push({ start: e.startTime, dur: e.duration }))).observe({ type: 'longtask', buffered: true });
});
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });

const orderId = 'E2E-ORDER-0001';
await page.fill('#orderIdInput', orderId);
await page.waitForTimeout(500); if (!(await page.locator('#platformSelect').inputValue())) await page.selectOption('#platformSelect', 'Amazon'); // no default platform any more
const startBtn = page.getByRole('button', { name: /Start Recording/i }).first();
await startBtn.click();
await page.waitForSelector('text=/Recording \\(/', { timeout: 10000 });
const t0 = await page.evaluate(() => performance.now());
await page.waitForTimeout(SECONDS * 1000);
const t1 = await page.evaluate(() => performance.now());
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('button', { name: /Stop/i }).first().click();
const download = await downloadPromise;
const file = join(dir, download.suggestedFilename());
await download.saveAs(file);

const longTasks = await page.evaluate(([a, b]) => window.__longTasks.filter((t) => t.start >= a && t.start <= b), [t0, t1]);
const engine = await page.evaluate(() => window.__vmsRecorderMode || null);
const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file])
  .toString().split('\n').map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
const d = pts.slice(1).map((t, i) => t - pts[i]);
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=format_name,duration', '-of', 'json', file]).toString();
const result = {
  file: download.suggestedFilename(),
  engine,
  frames: pts.length,
  fps: +(pts.length / (pts.at(-1) - pts[0])).toFixed(1),
  gapsOver70ms: d.filter((x) => x > 0.07).length,
  maxGapMs: Math.round(Math.max(...d) * 1000),
  droppedFrameEvents: d.filter((x) => x > 0.05).length,
  longTasksDuringRecording: longTasks.length,
  longestTaskMs: Math.round(Math.max(0, ...longTasks.map((t) => t.dur))),
  probe: JSON.parse(probe),
  pageErrors: errors,
  backendCalls: backend.calls.reduce((m, c) => ((m[c.action] = (m[c.action] || 0) + 1), m), {}),
};
console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: join(dir, 'after-recording.png') });
console.log('artifacts in', dir);
await browser.close();
