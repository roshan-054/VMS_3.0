// E2E: a packing video uploads completely when each Apps Script chunk call takes longer than
// 12 seconds (slow warehouse internet / slow Apps Script), instead of being cut off and left
// as "Session Created 0%" / "Interrupted". Dev server on :5179, then node tests/e2e/slow-upload.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { fakeDrive } = require('../../backend/tests/fake-drive.cjs');
const { fakeDriveUpload } = require('../../backend/tests/fake-drive-upload.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const CHUNK_DELAY = Number(process.env.CHUNK_DELAY || 14000);
const backend = createMockBackend({ latencyByAction: { uploadChunk: CHUNK_DELAY } });
const drive = fakeDrive();
drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
backend.rt.sandbox.DriveApp = new Proxy(drive, { get: (t, k) => (k in t ? t[k] : () => ({ hasNext: () => false })) });
backend.rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
const up = fakeDriveUpload();
backend.rt.sandbox.UrlFetchApp = up.UrlFetchApp;

const SIZE = 9 * 1024 * 1024; // 3 chunks of 4 MB
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });
const browser = await chromium.launch();
const page = await browser.newPage();
await attach(page, backend);
await login(page, BASE, backend);
const t0 = Date.now();
await page.evaluate(async (size) => {
  const { dbPutQueue } = await import('/src/lib/storage.ts');
  const { triggerUploadWorker } = await import('/src/lib/uploadWorker.ts');
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(size, i + 65536)));
  await dbPutQueue({
    id: 'job-slow-1', createdAt: Date.now(), orderId: 'SLOW-0001', platform: 'Amazon', recordingType: 'Return',
    fileName: 'SLOW-0001_Amazon_Return.mp4', fileSize: size, mimeType: 'video/mp4', source: 'Automatic Recording',
    blob: new Blob([bytes], { type: 'video/mp4' }), status: 'pending', progress: 0, recordingDate: '2026-11-24',
  });
  triggerUploadWorker();
}, SIZE);

let final = { status: 'timeout' };
for (let i = 0; i < 120; i++) {
  final = await page.evaluate(async () => {
    const { dbGetQueueItem } = await import('/src/lib/storage.ts');
    const it = await dbGetQueueItem('job-slow-1');
    return it ? { status: it.status, error: it.error, stage: it.stage } : { status: 'missing' };
  });
  if (final.status === 'completed' || final.status === 'failed') break;
  await new Promise((r) => setTimeout(r, 2000));
}
const secs = Math.round((Date.now() - t0) / 1000);
check(`upload completes with ${CHUNK_DELAY / 1000}s per chunk call`, final.status === 'completed', JSON.stringify(final) + ` after ${secs}s`);
const stored = [...up.files.values()][0];
check('whole file reached Drive', stored && stored.length === SIZE, stored ? stored.length : 'none');
const ret = backend.rt.sheets.get('ReturnLog').rows.find((r) => r[1] === 'SLOW-0001');
check('logged in ReturnLog with the Drive file', ret && String(ret[4]).startsWith('FILE_'), ret ? ret[4] : 'no row');
const urow = backend.rt.sheets.get('UploadLog').rows.find((r) => r[1] === 'SLOW-0001');
check('UploadLog row is Completed, not Session Created', urow && /complete/i.test(String(urow[10])), urow ? `${urow[7]} | ${urow[10]}` : 'no row');
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
