// E2E: Settings > "Remove duplicate and unusable rows": scan preview, confirm, rounds, archive.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOTS || '/tmp/claude-0/-home-user/308beb12-2ead-5463-b9ca-4e608d018ec7/scratchpad';
const OHDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const UHDR = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
const fid = (s) => 'FILE_' + s + '_abcdefghijklmnop';
const ORDERS = 60, COPIES = 5; // every order uploaded 1 good + 4 repeat rows

const backend = createMockBackend();
const rt = backend.rt;
const t = new Date(Date.now() - 30 * 86400000);
const orders = [OHDR], uploads = [UHDR];
for (let i = 0; i < ORDERS; i++) {
  orders.push([t, '#OD-' + i, 'D2C', 'admin@test.local', fid(i + '_0'), '', '44 MB', 'Completed', 'Forward', '', 'video/mp4', 'READY']);
  for (let c = 0; c < COPIES; c++) {
    uploads.push([t, '#OD-' + i, 'D2C', 'admin@test.local', 'OD-' + i + '_D2C_Forward.mp4', '44.28 MB', 'u' + i + c, 'Uploaded to Google Drive',
      c === 1 ? 0 : 100, fid(i + '_' + (c === 1 ? 0 : c)), 'Completed', '', 'Forward', 'Station', '']);
  }
}
uploads.push([t, '#OD-9999', 'D2C', 'admin@test.local', '', '', 'x', 'Started', 0, '', 'Failed', 'timeout', 'Forward', 'Station', '']);
const recent = new Date(Date.now() - 600000);
uploads.push([recent, '#OD-5000', 'D2C', 'admin@test.local', '', '', 'y', 'Started', 0, '', 'Started', '', 'Forward', 'Station', '']);
rt.addSheet('OrderLog', orders);
rt.addSheet('UploadLog', uploads);
rt.addSheet('ReturnLog', [OHDR]);
const trashed = new Set();
rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
rt.sandbox.UrlFetchApp = { fetchAll: (reqs) => reqs.map((r) => { trashed.add(decodeURIComponent(r.url.match(/files\/([^?]+)/)[1])); return { getResponseCode: () => 200, getContentText: () => '{}' }; }) };
const orig = rt.sandbox.runSheetCleanup_;
let rounds = 0;
rt.sandbox.runSheetCleanup_ = (p) => { rounds++; return orig({ ...p, budgetMs: 0 }); };

const EXPECT = ORDERS * (COPIES - 1) + 1; // repeats + failed upload
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 140) });
const browser = await chromium.launch();
for (const mode of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((m) => localStorage.setItem('vms_night_mode', m === 'dark' ? 'true' : 'false'), mode);
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').click();
  await page.locator('#sheet-cleanup-scan').click();
  await page.locator('#sheet-cleanup-preview').waitFor();
  if (mode === 'dark') {
    await page.screenshot({ path: SHOT + '/settings-cleanup-dark.png' });
    await page.close();
    break;
  }
  const preview = await page.locator('#sheet-cleanup-preview').innerText();
  check('preview counts rows to remove', preview.includes(String(EXPECT)), preview.replace(/\s+/g, ' '));
  check('nothing deleted by the scan', rt.sheets.get('UploadLog').rows.length === uploads.length, rt.sheets.get('UploadLog').rows.length);
  await page.locator('#sheet-cleanup-card summary').click();
  await page.locator('#sheet-cleanup-trash-videos').check();
  await page.screenshot({ path: SHOT + '/settings-cleanup-preview.png', fullPage: true });
  await page.locator('#sheet-cleanup-run').click();
  check('asks for confirmation first', await page.locator('#sheet-cleanup-confirm').isVisible() && rounds === 0, rounds);
  await page.locator('#sheet-cleanup-confirm-yes').click();
  await page.locator('#sheet-cleanup-result').waitFor({ timeout: 60000 });
  const res = await page.locator('#sheet-cleanup-result').innerText();
  check('result reports removed rows', res.includes(String(EXPECT)), res);
  check('needed several rounds', rounds >= 2, rounds);
  const left = rt.sheets.get('UploadLog').rows.slice(1);
  check('one row per order kept, plus the recent upload', left.length === ORDERS + 1, left.length);
  check('kept row is the OrderLog video at 100%', left.slice(0, ORDERS).every((r, i) => r[9] === fid(i + '_0') && r[8] === 100), left[0]);
  check('removed rows archived', rt.sheets.get('UploadLog Archive').rows.length === 1 + EXPECT, rt.sheets.get('UploadLog Archive').rows.length);
  check('extra copies moved to Drive Trash, kept videos untouched', trashed.size === ORDERS * 3 && ![...trashed].some((id) => /^FILE_\d+_0_/.test(id)), trashed.size);
  check('rescan shows nothing left', /Rows to remove\s*0/.test(await page.locator('#sheet-cleanup-preview').innerText()), '');
  await page.screenshot({ path: SHOT + '/settings-cleanup-done.png', fullPage: true });
  await page.close();
}
await browser.close();
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
