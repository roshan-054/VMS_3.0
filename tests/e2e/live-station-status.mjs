// E2E: an admin sees, in real time, what a packer's computer is uploading, waiting to upload and
// failed to upload (with the reason), on the Upload Logs page. Two separate browsers (packer, admin).
// Dev server on :5179, then node tests/e2e/live-station-status.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
// startUpload is slow so the packer's first video stays "uploading" while we look.
const backend = createMockBackend({ latencyByAction: { startUpload: 60000 } });
const PACKER = { email: 'packer1@test.local', password: 'PackerPass1', name: 'Packer One' };
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
backend.rt.sheets.get('Users').appendRow([new Date(), PACKER.name, PACKER.email, sha(PACKER.password), 'User', 'Approved']);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
async function signIn(page, who) {
  await page.goto(BASE);
  await page.getByPlaceholder(/email/i).first().fill(who.email);
  await page.locator('input[type="password"]').first().fill(who.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
  await page.waitForSelector('text=Scan & Record', { timeout: 20000 });
}

const browser = await chromium.launch();
const packerCtx = await browser.newContext();
const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const packer = await packerCtx.newPage();
const admin = await adminCtx.newPage();
await attach(packer, backend);
await attach(admin, backend);
await signIn(packer, PACKER);

await packer.evaluate(async () => {
  const { dbPutQueue } = await import('/src/lib/storage.ts');
  const { triggerUploadWorker } = await import('/src/lib/uploadWorker.ts');
  const blob = (n) => new Blob([new Uint8Array(n)], { type: 'video/mp4' });
  const base = { platform: 'Amazon', recordingType: 'Forward', mimeType: 'video/mp4', source: 'Automatic Recording', recordingDate: '2026-11-24' };
  await dbPutQueue({ ...base, id: 'job-live-fail', createdAt: Date.now() - 3000, orderId: 'LIVE-FAIL-1', fileName: 'LIVE-FAIL-1.mp4', fileSize: 1000, blob: blob(1000), status: 'failed', progress: 30, error: 'Drive refused the upload: storage quota exceeded' });
  await dbPutQueue({ ...base, id: 'job-live-up', createdAt: Date.now() - 2000, orderId: 'LIVE-UP-1', fileName: 'LIVE-UP-1.mp4', fileSize: 2000, blob: blob(2000), status: 'pending', progress: 0 });
  window.dispatchEvent(new Event('ops_queue_updated'));
  triggerUploadWorker();
});

await signIn(admin, backend.ADMIN);
await admin.getByRole('button', { name: /Upload Logs/ }).first().click();
await admin.waitForSelector('#live-station-queues', { timeout: 15000 });
const t0 = Date.now();
let seen = null;
for (let i = 0; i < 30; i++) {
  seen = await admin.evaluate((email) => {
    const card = document.querySelector(`[data-station="${email}"]`);
    if (!card) return null;
    const get = (o) => card.querySelector(`[data-order="${o}"]`);
    return {
      text: card.textContent,
      fail: get('LIVE-FAIL-1')?.getAttribute('data-status'),
      failText: get('LIVE-FAIL-1')?.textContent,
      up: get('LIVE-UP-1')?.getAttribute('data-status'),
      failedPill: document.querySelector('#live-count-failed')?.textContent,
    };
  }, PACKER.email);
  if (seen && seen.fail && seen.up === 'uploading') break;
  await new Promise((r) => setTimeout(r, 1000));
}
const secs = Math.round((Date.now() - t0) / 1000);
check('admin sees the packer station card', seen, seen ? `${secs}s` : 'no card');
check('station shows Online', seen && /Online/.test(seen.text), seen?.text);
check('failed video listed with its reason', seen && seen.fail === 'failed' && /storage quota exceeded/.test(seen.failText), seen?.failText);
check('uploading video listed as uploading', seen && seen.up === 'uploading', seen?.up);
check('failed counter counts it', seen && /^1 failed/.test(seen.failedPill || ''), seen?.failedPill);
check('shows up within 10 s', secs <= 10, `${secs}s`);

// The packer's videos also appear in the main log table with the packer's status.
const rowText = await admin.evaluate(() => document.querySelector('#upload-logs-container')?.innerText || '');
check('failed video in the log table', /LIVE-FAIL-1/.test(rowText), '');
await admin.screenshot({ path: process.env.SHOT || '/tmp/claude-0/live-station.png', fullPage: false });

// A packer cannot read other stations.
const denied = await packer.evaluate(async () => {
  const { requestApi } = await import('/src/lib/api.ts');
  try { await requestApi('getStationQueues', {}); return 'allowed'; } catch (e) { return e.message; }
});
check('packer cannot see other stations', denied !== 'allowed', denied);

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
