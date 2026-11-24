// E2E: Upload Logs shows one button per task, says how many rows the sheet really has, and
// loads older days from the sheet when dates are picked (not only the newest 500 rows).
// Dev server on :5179, then node tests/e2e/upload-logs-cleanup.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const ul = backend.rt.sheets.get('UploadLog');
const row = (ts, oid, fid, status, err = '') => [ts, oid, 'Amazon', 'admin@test.local', `${oid}.mp4`, '2 MB', `up-${oid}`, fid ? 'Uploaded to Google Drive' : 'Upload failed', fid ? 100 : 20, fid, status, err, 'Forward', 'UploadLog', `job-${oid}`];
for (let i = 0; i < 40; i++) ul.appendRow(row(new Date(`2026-11-21T10:${String(i % 60).padStart(2, '0')}:00`), `OLD-${String(i).padStart(4, '0')}`, `FILE_OLD_${i}`, 'Completed'));
for (let i = 0; i < 650; i++) ul.appendRow(row(new Date(Date.parse('2026-11-24T06:00:00') + i * 30000), `NEW-${String(i).padStart(4, '0')}`, `FILE_NEW_${i}`, 'Completed'));
ul.appendRow(row(new Date('2026-11-24T12:00:00'), 'FAIL-0001', '', 'Failed', 'Network lost'));

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 120) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Upload Logs/ }).first().click();
await page.waitForSelector('#failed-uploads-banner', { timeout: 20000 });
await page.waitForTimeout(1500);

const count = (re) => page.evaluate((src) => [...document.querySelectorAll('#upload-logs-container button')].filter((b) => new RegExp(src, 'i').test(b.textContent || '')).length, re.source);
check('no "Fix Stuck Uploads" / "Fix Stuck Sessions"', (await count(/Fix Stuck/)) === 0, await count(/Fix Stuck/));
check('one recover button', (await count(/Recover/)) === 1, await count(/Recover/));
check('one "remove interrupted" button', (await count(/Purge|Remove interrupted/)) === 1, await count(/Purge|Remove interrupted/));
check('no "View Interrupted Only"', (await count(/View Interrupted/)) === 0, '');
const failRow = page.locator('tr', { hasText: 'FAIL-0001' }).first();
const removeCtl = await failRow.locator('button[title*="Remove"]').count();
check('failed row has one remove control', removeCtl === 1, removeCtl);
const note = await page.locator('#logs-window-note').textContent().catch(() => '');
check('total says how many rows the sheet has', /691/.test(note || ''), note);
let txt = await page.locator('#upload-logs-container').innerText();
check('older day not in the default newest-500 view', !/OLD-0005/.test(txt), '');

const dates = page.locator('#upload-logs-container input[type="date"]');
await dates.nth(0).fill('2026-11-21');
await dates.nth(1).fill('2026-11-21');
let found = false;
for (let i = 0; i < 20 && !found; i++) {
  await page.waitForTimeout(500);
  txt = await page.locator('#upload-logs-container').innerText();
  found = /Showing 40 matching/.test(txt);
}
check('picking 21 Nov loads all 40 rows of that day from the sheet', found, (txt.match(/Showing \d+ matching/) || [''])[0]);
const call = backend.calls.filter((c) => c.action === 'getUploadLogs').length;
check('dates were sent to the sheet', call >= 2, call);
await page.screenshot({ path: process.env.SHOT || '/tmp/claude-0/upload-logs-cleanup.png' });
await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
