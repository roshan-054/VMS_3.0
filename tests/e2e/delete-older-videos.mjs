// E2E: "Delete 90 Days Older Videos" really moves old videos to Drive Trash (fake Drive REST),
// works through 200 videos in several server rounds with progress, keeps recent ones, and
// shows order IDs without a doubled "#".
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const OHDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const UHDR = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
const fid = (n) => 'FILE' + String(n).padStart(4, '0') + '_abcdefghijklmnop';
const OLD = 200, RECENT = 4;

const backend = createMockBackend();
const rt = backend.rt;
const old = new Date(Date.now() - 120 * 86400000);
const recent = new Date(Date.now() - 2 * 86400000);
const orders = [OHDR], uploads = [UHDR];
for (let i = 0; i < OLD + RECENT; i++) {
  const ts = i < OLD ? old : recent;
  orders.push([ts, '#OD-' + i, 'D2C', 'admin@test.local', fid(i), '', '10.00 MB', 'Completed', 'Forward', 'q' + i, 'video/mp4', 'READY']);
  uploads.push([ts, '#OD-' + i, 'D2C', 'admin@test.local', '#OD-' + i + '_D2C_Forward.mp4', '10.00 MB', 'u' + i, 'done', 100, fid(i), 'Completed', '', 'Forward', 'Station', 'q' + i]);
}
rt.addSheet('OrderLog', orders);
rt.addSheet('UploadLog', uploads);
rt.addSheet('ReturnLog', [OHDR]);
const trashed = new Set();
rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
rt.sandbox.UrlFetchApp = {
  fetchAll(reqs) {
    const until = Date.now() + 30;
    while (Date.now() < until) { /* a Drive round trip */ }
    return reqs.map((r) => { trashed.add(decodeURIComponent(r.url.match(/files\/([^?]+)/)[1])); return { getResponseCode: () => 200, getContentText: () => '{}' }; });
  },
};
// Force small server rounds so the app has to keep calling until done.
const orig = rt.sandbox.deleteOlderVideos_;
let rounds = 0;
rt.sandbox.deleteOlderVideos_ = (p) => { rounds++; return orig({ ...p, budgetMs: 1 }); };

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.locator('#nav-item-admin').click();
await page.locator('#admin-tab-settings-btn').click();
await page.getByRole('button', { name: /Delete 90 Days Older Videos/ }).click();
await page.waitForSelector('text=/Scanned Items Older Than 90 Days \\(400\\)/');
const modalText = await page.locator('text=/Older Video Files/').locator('..').innerText();
check('scan: 400 rows, 200 unique videos', /200/.test(modalText), modalText.replace(/\s+/g, ' '));
const body = await page.locator('body').innerText();
check('no doubled ## in order IDs', !/##OD/.test(body) && /#OD-199/.test(body), (body.match(/#+OD-\d+/) || [''])[0]);

await page.getByRole('button', { name: /Move Videos Older Than 90 Days to Trash/ }).click();
await page.getByRole('button', { name: /Yes, Delete Older Videos Now/ }).click();
await page.locator('#delete-older-progress').waitFor();
await page.locator('#delete-older-result').waitFor({ timeout: 60000 });
const res = await page.locator('#delete-older-result').innerText();
check('all 200 old videos moved to Drive Trash', trashed.size === OLD, trashed.size);
check('needed several rounds', rounds >= 3, rounds);
check('result says 200 videos moved, rows kept', /200 video\(s\) moved/.test(res) && /rows kept/.test(res), res.replace(/\s+/g, ' '));
check('no option to delete sheet rows', !(await page.locator('text=/Purge Log Entries/').count()) && (await page.locator('#delete-older-keeps-rows').count()) === 1, '');
check('recent videos untouched', [...Array(RECENT)].every((_, k) => !trashed.has(fid(OLD + k))), '');
check('every sheet row kept, old ones marked', rt.sheets.get('OrderLog').rows.length === 1 + OLD + RECENT && rt.sheets.get('UploadLog').rows.length === 1 + OLD + RECENT && /Drive Trash/.test(rt.sheets.get('OrderLog').rows[1][11]),
  rt.sheets.get('OrderLog').rows.length + '/' + rt.sheets.get('UploadLog').rows.length);
check('list re-scanned to empty', await page.locator('text=/Scanned Items Older Than 90 Days \\(0\\)/').count() > 0 || !(await page.locator('text=/#OD-1\\b/').count()), '');
await page.screenshot({ path: '/tmp/claude-0/-home-user/308beb12-2ead-5463-b9ca-4e608d018ec7/scratchpad/delete-older-done.png' });
await browser.close();
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
