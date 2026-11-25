// E2E: the in-panel player starts the ORIGINAL video almost at once by streaming it straight from
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

async function run(streamWorks, { workers = 'allow', hardReload = false } = {}) {
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
  let hardReloadedUncontrolled = null;
  if (hardReload) {
    // Ctrl+Shift+R: the page loads without the stream worker controlling it.
    const cdp = await context.newCDPSession(page);
    await Promise.all([page.waitForNavigation(), cdp.send('Page.reload', { ignoreCache: true })]);
    const loggedIn = await page.waitForSelector('text=Scan & Record', { timeout: 8000 }).then(() => true).catch(() => false);
    if (!loggedIn) {
      // Sign in on the hard-reloaded page itself (a fresh page.goto would be a normal load).
      await page.getByPlaceholder(/email/i).first().fill(backend.ADMIN.email);
      await page.locator('input[type="password"]').first().fill(backend.ADMIN.password);
      await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
      await page.waitForSelector('text=Scan & Record', { timeout: 20000 });
    }
    hardReloadedUncontrolled = await page.evaluate(() => !navigator.serviceWorker.controller);
  }
  await page.getByRole('button', { name: /Search Videos/ }).first().click();
  await page.getByPlaceholder(/402-19283-91/).fill('ORD-FAST-1');
  await page.locator('#search-orders-submit-btn').click();
  const t0 = Date.now();
  await page.getByRole('button', { name: /Play & View Details/ }).first().click({ timeout: 20000 });
  let previewShownMs = -1;
  page.waitForSelector('#hq-player-preview-while-loading iframe', { timeout: 120000 }).then(() => { previewShownMs = Date.now() - t0; }).catch(() => {});
  // When the whole file had to be downloaded, the viewer presses "play full quality" when it is ready.
  page.locator('#hq-player-play-full').click({ timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => { const v = document.querySelector('#hq-player-video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 120000 });
  const firstFrameMs = Date.now() - t0;
  const info = await page.evaluate(async () => {
    const v = document.querySelector('#hq-player-video');
    await v.play();
    await new Promise((r) => setTimeout(r, 1000));
    v.currentTime = 30; // seek near the end
    await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 8000); });
    return { w: v.videoWidth, h: v.videoHeight, source: v.dataset.source, t: v.currentTime, playing: !v.paused };
  });
  const chunkCalls = backend.calls.filter((c) => c.action === 'getVideoChunk').length;
  await browser.close();
  return { firstFrameMs, previewShownMs, hardReloadedUncontrolled, ...info, chunkCalls, streamMB: Math.round(streamBytes / 1048576) };
}

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });
const s = await run(true);
check('streams from Drive and shows the first frame within 5 s', s.source === 'drive-stream' && s.firstFrameMs < 5000, `${s.firstFrameMs} ms via ${s.source}`);
check('stream is the original 1920x1080', s.w === 1920 && s.h === 1080, `${s.w}x${s.h}`);
check('seeking to 0:30 works without downloading everything first', s.t >= 29.5, `t=${s.t}`);
check('no Apps Script chunk calls needed', s.chunkCalls === 0, s.chunkCalls);
const f = await run(false);
check('when Drive streaming is blocked, streams through the backend instead', f.source === 'backend-stream' && f.w === 1920, `${f.firstFrameMs} ms via ${f.source}, ${f.chunkCalls} chunk calls`);
check('backend stream shows the first frame within 15 s (3 s per backend call)', f.firstFrameMs < 15000, `${f.firstFrameMs} ms`);
check('backend stream seeks to 0:30', f.t >= 29.5, `t=${f.t}`);
const h = await run(false, { hardReload: true });
check('after a hard reload (Ctrl+Shift+R) it still streams through the backend', h.hardReloadedUncontrolled === true && h.source === 'backend-stream' && h.firstFrameMs < 15000, `uncontrolled after reload: ${h.hardReloadedUncontrolled}; ${h.firstFrameMs} ms via ${h.source}`);
const d = await run(false, { workers: 'block' });
check('without a stream worker, falls back to the full backend download', d.source === 'blob' && d.w === 1920, `${d.firstFrameMs} ms via ${d.source}, ${d.chunkCalls} chunk calls`);
check('during that download the Drive preview plays at once', d.previewShownMs < 5000, `${d.previewShownMs} ms`);
check('backend stream starts faster than the full download', f.firstFrameMs < d.firstFrameMs, `${f.firstFrameMs} vs ${d.firstFrameMs} ms`);
check('direct stream is fastest', s.firstFrameMs < f.firstFrameMs, `${s.firstFrameMs} vs ${f.firstFrameMs} ms`);
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
