// E2E: #OD-10088 was in Drive twice (959.1 KB + 81.94 MB). A small video was uploaded, the full
// recording of the same order waited in the queue blocked as a duplicate, and was later uploaded
// with the duplicate check skipped (Upload Logs "Resume" skipped it without asking).
// Now: Upload Logs shows no Resume on an uploaded row, and "Upload & Keep Bigger" leaves ONE video
// (the bigger one) and one row per log. Dev server on :5179, then node tests/e2e/no-duplicate-uploads.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { fakeDrive } = require('../../backend/tests/fake-drive.cjs');
const { fakeDriveUpload } = require('../../backend/tests/fake-drive-upload.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const drive = fakeDrive();
drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
const trashed = [];
backend.rt.sandbox.DriveApp = new Proxy(drive, {
  get: (t, k) => (k === 'getFileById'
    ? (id) => ({ setTrashed: (v) => v && trashed.push(id), setSharing() {}, getParents: () => ({ hasNext: () => false }), getSize: () => 0 })
    : (k in t ? t[k] : () => ({ hasNext: () => false }))),
});
backend.rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
const up = fakeDriveUpload();
backend.rt.sandbox.UrlFetchApp = up.UrlFetchApp;
const ORDER = '#OD-10088';
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });

const origHandle = backend.handle;
backend.handle = async (route) => { const b = JSON.parse(route.request().postData() || '{}'); if (process.env.DBG && ['uploadChunk','startUpload','finishUpload'].includes(b.action)) { const r = backend.rt.sandbox.doPost({ postData: { contents: JSON.stringify(b) }, parameter: {} }); console.log('DBG', b.action, String(r.text).slice(0, 300)); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.text }); } return origHandle(route); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (process.env.DBG) page.on('console', (m) => { if (/warn|error/.test(m.type())) console.log('CONSOLE', m.text().slice(0, 300)); });
await attach(page, backend);
await login(page, BASE, backend);

const queue = (id, size) => page.evaluate(async ({ id, size, order }) => {
  const { dbPutQueue } = await import('/src/lib/storage.ts');
  const { triggerUploadWorker } = await import('/src/lib/uploadWorker.ts');
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(size, i + 65536)));
  await dbPutQueue({
    id, createdAt: Date.now(), orderId: order, platform: 'D2C', recordingType: 'Forward',
    fileName: 'OD-10088_D2C_Forward.mp4', fileSize: size, mimeType: 'video/mp4', source: 'Automatic Recording',
    blob: new Blob([bytes], { type: 'video/mp4' }), status: 'pending', progress: 0, recordingDate: '2026-11-26',
  });
  triggerUploadWorker();
}, { id, size, order: ORDER });
const itemState = (id) => page.evaluate(async (id) => {
  const { dbGetQueueItem } = await import('/src/lib/storage.ts');
  const it = await dbGetQueueItem(id);
  return it ? { status: it.status, dup: !!it.isDuplicate, stage: it.stage, error: it.error } : { status: 'missing' };
}, id);
const waitFor = async (id, ok) => {
  let s;
  for (let i = 0; i < 60; i++) { s = await itemState(id); if (ok(s)) return s; await page.waitForTimeout(1000); }
  return s;
};
const orderRows = (tab) => backend.rt.sheets.get(tab).rows.filter((r) => r[1] === ORDER);

// 1. The short (small) video uploads first.
await queue('job-small', 980 * 1024);
let s = await waitFor('job-small', (x) => x.status === 'completed');
check('small video uploaded', s.status === 'completed', JSON.stringify(s));
if (process.env.DBG) console.log('STEP1', JSON.stringify(s));
const smallFid = orderRows('OrderLog')[0]?.[4];

if (process.env.DBG) console.log("AFTER1", JSON.stringify(backend.rt.sheets.get("UploadLog").rows), JSON.stringify(backend.calls.map(c=>c.action)));
// 2. The full recording of the same order is blocked as a duplicate.
await queue('job-full', 3 * 1024 * 1024);
s = await waitFor('job-full', (x) => x.status === 'failed' || x.dup || x.status === 'completed');
check('full recording is blocked as duplicate', s.status !== 'completed' && (s.dup || /duplicate/i.test(`${s.stage} ${s.error}`)), JSON.stringify(s));

// 3. Upload Logs: the uploaded row must not offer "Resume" (that skipped the duplicate check).
await page.getByRole('button', { name: /^Upload Logs/ }).first().click();
await page.waitForTimeout(2500);
const row = page.locator('tr', { hasText: ORDER }).first();
await row.waitFor({ timeout: 15000 }).catch(() => {});
const resumeCount = await row.getByRole('button', { name: /Resume/ }).count();
check('Upload Logs: no Resume button on the uploaded row', resumeCount === 0, `resume buttons=${resumeCount}`);
await page.screenshot({ path: process.env.SHOT_LOGS || '/tmp/no-dup-logs.png' });

// 4. Upload Queue: "Upload & Keep Bigger" keeps one video, the bigger one.
await page.getByRole('button', { name: /^Upload Queue/ }).first().click();
await page.waitForTimeout(1500);
const keepBtn = page.getByRole('button', { name: /Upload & Keep Bigger/ }).last();
check('queue offers "Upload & Keep Bigger"', await keepBtn.count() > 0, await keepBtn.count());
await page.screenshot({ path: process.env.SHOT_QUEUE || '/tmp/no-dup-queue.png' });
await keepBtn.click();
s = await waitFor('job-full', (x) => x.status === 'completed' || (x.status === 'failed' && !x.dup));
check('full recording uploads', s.status === 'completed', JSON.stringify(s));
await page.waitForTimeout(1000);
const ol = orderRows('OrderLog');
const ul = orderRows('UploadLog');
check('OrderLog has ONE row for the order', ol.length === 1, ol.map((r) => `${r[4]} ${r[6]}`).join(' | '));
check('kept row is the bigger video', ol[0] && /3(\.0+)? MB/.test(String(ol[0][6])) && ol[0][4] !== smallFid, ol[0] && `${ol[0][4]} ${ol[0][6]}`);
check('UploadLog has ONE row for the order', ul.length === 1, ul.map((r) => `${r[9]} ${r[5]} ${r[7]}`).join(' | '));
check('small video moved to Drive trash', trashed.includes(smallFid), `${trashed} vs ${smallFid}`);

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
