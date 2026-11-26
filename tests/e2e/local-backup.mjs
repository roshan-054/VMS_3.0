// E2E: a finished recording is saved into the station's backup folder using the Drive folder
// structure, and queued for Drive upload with the same platform/type/date.
// (The native folder picker can't be clicked in headless Chrome, so the test hands the app the
// browser's private file system (OPFS) as the chosen folder.)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (/error|warn|worker|Recorder|recording/i.test(m.text())) console.log('[console]', m.type(), m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await attach(page, backend);
if (process.env.NO_POI) await page.addInitScript(() => localStorage.setItem('vms_ai_focus_calibration', JSON.stringify({ autoHardwareFocus: false })));
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.waitForSelector('#orderIdInput');
await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });

const results = [];
const tmp = mkdtempSync(join(tmpdir(), 'local-backup-'));
const videoFrames = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim() || 0);
async function framesInOpfs(path) {
  const b64 = await page.evaluate(async (parts) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('StationBackup');
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    const buf = new Uint8Array(await (await (await d.getFileHandle(parts.at(-1))).getFile()).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, path.split('/').slice(1));
  const f = join(tmp, path.split('/').at(-1));
  writeFileSync(f, Buffer.from(b64, 'base64'));
  return videoFrames(f);
}
const modes = [];
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[recording] started')) modes.push(t.split(' ')[2]); });
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 110) });

// Hand the app OPFS as "the chosen backup folder"
await page.evaluate(async () => {
  const m = await import('/src/lib/localBackup.ts');
  await m.setBackupFolder(await (await navigator.storage.getDirectory()).getDirectoryHandle('StationBackup', { create: true }));
});
await page.waitForTimeout(300);
check('picker shows chosen folder', (await page.locator('#local-backup-folder').innerText()).includes('VMS_Packing_Videos'), await page.locator('#local-backup-folder').innerText());

async function recordOrder(orderId, seconds = 3) {
  await page.evaluate(() => (window.__vmsLastLocalSave = null));
  await page.fill('#orderIdInput', orderId);
  await page.waitForTimeout(500); if (!(await page.locator('#platformSelect').inputValue())) await page.selectOption('#platformSelect', 'Amazon'); // no default platform any more
  await page.getByRole('button', { name: /Start Recording/i }).first().click();
  await page.waitForSelector('text=/Recording \\(/', { timeout: 20000 });
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: /Stop/i }).first().click();
  await page.waitForFunction((id) => window.__vmsLastLocalSave && window.__vmsLastLocalSave.path.includes(id), orderId, { timeout: 30000 });
  return page.evaluate(() => window.__vmsLastLocalSave);
}

const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
const month = await page.evaluate(() => new Date().toLocaleString('en-US', { month: 'short' }) + '-' + new Date().getFullYear());
const first = await recordOrder('LOCAL-TEST-001');
const expected = `VMS_Packing_Videos/Amazon/Forward/${month}/${today}/LOCAL-TEST-001_Amazon_Forward.mp4`;
check('saved into Drive-style folders', first.method === 'folder' && first.path.endsWith(expected), first.path);

const size = await page.evaluate(async (parts) => {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('StationBackup');
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await (await d.getFileHandle(parts.at(-1))).getFile()).size;
}, expected.split('/'));
check('file really exists on disk with data', size > 10000, `${size} bytes`);

// Same order again (re-record) must not overwrite the first file
const second = await recordOrder('LOCAL-TEST-001', 2);
check('re-recording keeps both files', second.path.endsWith('LOCAL-TEST-001_Amazon_Forward_2.mp4'), second.path);
const f1 = await framesInOpfs(first.path), f2 = await framesInOpfs(second.path);
check('both saved files contain video', f1 > 50 && f2 > 30, `${f1} and ${f2} frames`);

// Queue item + backend upload start carry the same platform / type / date
const queue = await page.evaluate(
  () =>
    new Promise((res) => {
      const r = indexedDB.open('OrderPackingVideoSystemCleanDB');
      r.onsuccess = () => {
        const all = r.result.transaction('queue').objectStore('queue').getAll();
        all.onsuccess = () => res(all.result.map((q) => ({ orderId: q.orderId, platform: q.platform, recordingType: q.recordingType, recordingDate: q.recordingDate, size: q.fileSize })));
      };
    })
);
check('queued for Drive upload', queue.some((q) => q.orderId === 'LOCAL-TEST-001' && q.recordingDate === today && q.platform === 'Amazon'), JSON.stringify(queue));
const started = backend.calls.filter((c) => c.action === 'startUpload').length;
check('upload to Drive started automatically', started > 0, `${started} startUpload calls`);

// Without a folder it falls back to a normal download
await page.evaluate(async () => { window.__vmsLastLocalSave = null; await (await import('/src/lib/localBackup.ts')).setBackupFolder(null); });
const dl = page.waitForEvent('download', { timeout: 30000 });
await page.fill('#orderIdInput', 'LOCAL-TEST-002');
await page.waitForTimeout(500); if (!(await page.locator('#platformSelect').inputValue())) await page.selectOption('#platformSelect', 'Amazon'); // no default platform any more
await page.getByRole('button', { name: /Start Recording/i }).first().click();
await page.waitForSelector('text=/Recording \\(/', { timeout: 20000 });
await page.waitForTimeout(4000);
await page.getByRole('button', { name: /Stop/i }).first().click();
let dlName = '';
try { const d3 = await dl; dlName = d3.suggestedFilename(); const p3 = join(tmp, dlName); await d3.saveAs(p3); const n3 = videoFrames(p3); check('downloaded file contains video', n3 > 50, `${n3} frames`); } catch (e) { await page.screenshot({ path: '/tmp/claude-0/lb-fail.png' }); dlName = 'timeout: ' + (await page.evaluate(() => JSON.stringify(window.__vmsLastLocalSave))); }
check('no folder chosen -> browser download', dlName === 'LOCAL-TEST-002_Amazon_Forward.mp4', dlName);

console.table(results);
console.log('engines used:', modes.join(', '));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
