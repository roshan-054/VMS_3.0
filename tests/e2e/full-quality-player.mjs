// E2E: Search Videos -> Play opens the in-panel player, which downloads the ORIGINAL file from
// Drive through the backend (in chunks) and plays it at its full recorded resolution.
// Needs the dev server on :5179 and ORIG_MP4 (a 1080p test mp4; default made with ffmpeg).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const ORIG = process.env.ORIG_MP4 || '/tmp/vms-orig1080.mp4';
if (!existsSync(ORIG)) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30,noise=alls=20:allf=t', '-t', '8', '-c:v', 'libx264', '-b:v', '9M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ORIG]);
}
const VIDEO = readFileSync(ORIG);
const FID = 'VIDEOFILE_fullquality_123';

const backend = createMockBackend();
const rt = backend.rt;
rt.sheets.get('OrderLog').appendRow([new Date(), 'ORD-HQ-1', 'Amazon', 'admin@test.local', FID, `https://drive.google.com/file/d/${FID}/preview`, 'ORD-HQ-1_Amazon_Forward.mp4', 'Forward']);
const ranges = [];
rt.sandbox.DriveApp = new Proxy({}, { get: (_t, k) => k === 'getFileById'
  ? (id) => { if (id !== FID) throw new Error('No item with the given ID could be found'); return { getSize: () => VIDEO.length, getMimeType: () => 'video/mp4', getName: () => 'ORD-HQ-1_Amazon_Forward.mp4', getParents: () => ({ hasNext: () => false }), isTrashed: () => false }; }
  : () => ({ hasNext: () => false }) });
rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
rt.sandbox.UrlFetchApp = {
  fetch: (_url, opts) => {
    ranges.push(opts.headers.Range);
    const [a, b0] = opts.headers.Range.replace('bytes=', '').split('-').map(Number);
    const b = Math.min(b0, VIDEO.length - 1);
    const part = VIDEO.subarray(a, b + 1);
    return {
      getResponseCode: () => 206,
      getHeaders: () => ({ 'Content-Range': `bytes ${a}-${b}/${VIDEO.length}`, 'Content-Type': 'video/mp4' }),
      getContent: () => Array.from(part, (x) => (x > 127 ? x - 256 : x)),
    };
  },
};

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 110) });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// Service workers blocked: this covers the last fallback, the whole-file download through the
// backend (tests/e2e/fast-playback.mjs covers the two streaming ways).
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
await attach(page, backend);
// This test covers the download-through-the-backend path: direct streaming from Drive is blocked.
await page.route(/drive\.usercontent\.google\.com/, (route) => route.abort());
await login(page, BASE, backend);
await page.getByRole('button', { name: /Search Videos/ }).first().click();
await page.getByPlaceholder(/402-19283-91/).fill('ORD-HQ-1');
await page.locator('#search-orders-submit-btn').click();
await page.getByRole('button', { name: /Play & View Details/ }).first().click({ timeout: 20000 });

const loading = await page.locator('#hq-player-loading').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
check('shows download progress while loading', loading, loading);
const previewMeanwhile = await page.locator('#hq-player-preview-while-loading iframe[src*="/preview"]').count();
check('Drive preview plays while the full file downloads', previewMeanwhile === 1, previewMeanwhile);
await page.locator('#hq-player-play-full').click({ timeout: 60000 });
await page.waitForFunction(() => {
  const v = document.querySelector('#hq-player-video');
  return v && v.readyState >= 2 && v.videoWidth > 0;
}, null, { timeout: 60000 });
const info = await page.evaluate(async () => {
  const v = document.querySelector('#hq-player-video');
  const blob = await fetch(v.src).then((r) => r.blob());
  await v.play();
  await new Promise((r) => setTimeout(r, 1200));
  return { w: v.videoWidth, h: v.videoHeight, size: blob.size, t: v.currentTime, src: v.src.slice(0, 5) };
});
check('plays the original at 1920x1080', info.w === 1920 && info.h === 1080, `${info.w}x${info.h}`);
check('whole original file downloaded byte-exact size', info.size === VIDEO.length, `${info.size} / ${VIDEO.length}`);
check('fetched in 8 MB ranges', ranges.length === Math.ceil(VIDEO.length / (8 * 1024 * 1024)) && ranges[0] === 'bytes=0-8388607', ranges.join(' '));
check('video actually plays', info.t > 0.5, info.t);
const label = await page.locator('text=/Original file · 1920×1080/').first().isVisible();
check('quality badge shows Original file 1920×1080', label, label);
await page.waitForTimeout(300);
await page.screenshot({ path: process.env.SHOT || '/tmp/hq-player.png' });

await page.locator('#player-mode-drive').click();
const iframe = await page.locator('iframe[src*="/preview"]').count();
check('Drive preview still available as a choice', iframe === 1, iframe);
await page.locator('#player-mode-original').click();
await page.waitForFunction(() => document.querySelector('#hq-player-video')?.videoWidth === 1920, null, { timeout: 10000 });
check('switching back is instant (cached, no new download)', ranges.length === Math.ceil(VIDEO.length / (8 * 1024 * 1024)), ranges.length);

console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
