// E2E: the player's back/forward buttons and arrow keys jump 5 seconds.
// (Setup copied from fast-playback.mjs:) the in-panel player starts the ORIGINAL video almost at once by streaming it straight from
// Google Drive (byte ranges), instead of first downloading the whole file through Apps Script.
// Drive is faked with Playwright routing; Apps Script chunk calls are made slow (3 s each) as in
// real life. Dev server on :5179, then node tests/e2e/fast-playback.mjs
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const ORIG = '/tmp/vms-orig1080-long.mp4';
if (!existsSync(ORIG)) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30,noise=alls=20:allf=t', '-t', '40', '-c:v', 'libx264', '-b:v', '9M', '-pix_fmt', 'yuv420p', ORIG]);
}
const VIDEO = readFileSync(ORIG); // ~45 MB, moov at the end like a recorder's file
const FID = 'VIDEOFILE_streamtest_456';

async function run(streamWorks, { workers = 'allow' } = {}) {
  const backend = createMockBackend({ latencyByAction: { getVideoChunk: 3000 } });
  const rt = backend.rt;
  rt.sheets.get('OrderLog').appendRow([new Date(), 'ORD-FAST-1', 'Amazon', 'admin@test.local', FID, `https://drive.google.com/file/d/${FID}/preview`, '45 MB', 'Completed', 'Forward', 'job-fast']);
  rt.sandbox.DriveApp = new Proxy({}, { get: (_t, k) => k === 'getFileById' ? () => ({ getSize: () => VIDEO.length, getMimeType: () => 'video/mp4', getName: () => 'x.mp4', getParents: () => ({ hasNext: () => false }) }) : () => ({ hasNext: () => false }) });
  rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
  rt.sandbox.UrlFetchApp = { fetch: (_u, o) => {
    const [a, b0] = o.headers.Range.replace('bytes=', '').split('-').map(Number); const b = Math.min(b0, VIDEO.length - 1);
    const part = VIDEO.subarray(a, b + 1);
    return { getResponseCode: () => 206, getHeaders: () => ({ 'Content-Range': `bytes ${a}-${b}/${VIDEO.length}`, 'Content-Type': 'video/mp4' }), getContent: () => Array.from(part, (x) => (x > 127 ? x - 256 : x)) };
  } };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: workers });
  const page = await context.newPage();
  await attach(page, backend);
  let streamBytes = 0;
  await page.route(/drive\.usercontent\.google\.com/, async (route) => {
    if (!streamWorks) return route.abort();
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') !== FID) return route.fulfill({ status: 404 });
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const a = m ? Number(m[1]) : 0;
    const b = m && m[2] ? Math.min(Number(m[2]), VIDEO.length - 1) : Math.min(VIDEO.length - 1, a + 4 * 1024 * 1024 - 1);
    streamBytes += b - a + 1;
    await new Promise((r) => setTimeout(r, 150)); // network latency
    return route.fulfill({ status: 206, headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${VIDEO.length}`, 'content-length': String(b - a + 1) }, body: VIDEO.subarray(a, b + 1) });
  });
  await login(page, BASE, backend);
  if (workers === 'allow') await page.waitForFunction(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 10000 }).catch(() => {});
  await page.getByRole('button', { name: /Search Videos/ }).first().click();
  await page.getByPlaceholder(/402-19283-91/).fill('ORD-FAST-1');
  await page.locator('#search-orders-submit-btn').click();
  await page.getByRole('button', { name: /Play & View Details/ }).first().click({ timeout: 20000 });
  await page.waitForFunction(() => { const v = document.querySelector('#hq-player-video'); return v && v.readyState >= 2; }, null, { timeout: 60000 });
  const t = () => page.evaluate(() => document.querySelector('#hq-player-video').currentTime);
  const settle = () => page.waitForTimeout(400);
  const out = {};
  await page.evaluate(() => { const v = document.querySelector('#hq-player-video'); v.pause(); v.currentTime = 10; });
  await settle();
  out.fwdLabel = (await page.locator('#player-skip-forward').innerText()).trim();
  out.backLabel = (await page.locator('#player-skip-back').innerText()).trim();
  await page.locator('#player-skip-forward').click(); await settle(); out.afterFwd = await t();
  await page.locator('#player-skip-back').click(); await page.locator('#player-skip-back').click(); await settle(); out.afterBack = await t();
  await page.locator('#hq-player-video').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => { const v = document.querySelector('#hq-player-video'); v.pause(); document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await settle(); out.afterKeys = await t();
  await page.keyboard.press('ArrowLeft'); await settle(); out.afterKeyBack = await t();
  await page.evaluate(() => { document.querySelector('#hq-player-video').currentTime = 1; }); await settle();
  await page.locator('#player-skip-back').click(); await settle(); out.clampStart = await t();
  await page.screenshot({ path: process.env.SHOT || '/tmp/skip-5s.png', clip: { x: 0, y: 450, width: 1366, height: 450 } });
  await browser.close();
  return out;
}

const r = await run(true);
const results = [];
const near = (a, b) => Math.abs(a - b) < 0.3;
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail) });
check('buttons are labelled 5s', r.backLabel === '5s' && r.fwdLabel === '5s', `${r.backLabel} / ${r.fwdLabel}`);
check('forward button jumps +5 s', near(r.afterFwd, 15), r.afterFwd);
check('back button twice jumps -10 s', near(r.afterBack, 5), r.afterBack);
check('Right arrow twice jumps +10 s', near(r.afterKeys, 15), r.afterKeys);
check('Left arrow jumps -5 s', near(r.afterKeyBack, 10), r.afterKeyBack);
check('back near the start stops at 0:00', r.clampStart === 0, r.clampStart);
console.table(results);
const failed = results.filter((x) => !x.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
