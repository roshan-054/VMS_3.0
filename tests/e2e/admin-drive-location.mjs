// E2E: Admin changes the video Drive folder from the UI; a bad folder is refused; uploads from a
// station then go into the new folder even though the station's browser still has the old ID.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { fakeDrive } = require('../../backend/tests/fake-drive.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const drive = fakeDrive({ readOnly: ['READONLY_abcdefghij'] });
backend.rt.sandbox.DriveApp = drive;
drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
drive.add('NEWFOLDER_abcdefghij', 'Videos 2027');
drive.add('READONLY_abcdefghij', 'Someone Elses Folder');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Admin & Users/ }).first().click();
await page.locator('#admin-tab-settings-btn').click();
const box = page.locator('#drive-location-setting input');
await box.waitFor();
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 100) });

await box.fill('https://drive.google.com/drive/folders/READONLY_abcdefghij?usp=sharing');
await page.getByRole('button', { name: /Check & use this folder/ }).click();
const bad = page.locator('#drive-location-setting [role="status"]');
await bad.waitFor();
check('read-only folder refused with a reason', /not changed/i.test(await bad.innerText()) && /Editor/.test(await bad.innerText()), await bad.innerText());
check('central folder unchanged', backend.rt.sandbox.videoRootFolderId_() === '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', backend.rt.sandbox.videoRootFolderId_());

await box.fill('https://drive.google.com/drive/folders/NEWFOLDER_abcdefghij');
await page.getByRole('button', { name: /Check & use this folder/ }).click();
await page.waitForSelector('text=/Active: "Videos 2027"/');
check('good folder accepted, name shown', true, await page.locator('#drive-location-setting [role="status"]').innerText());
check('central folder switched', backend.rt.sandbox.videoRootFolderId_() === 'NEWFOLDER_abcdefghij', backend.rt.sandbox.videoRootFolderId_());
const row = backend.rt.sheets.get('Branding').rows.find((r) => r[0] === 'VideoDriveFolderId');
check('saved in Branding sheet', row && row[1] === 'NEWFOLDER_abcdefghij', row);

// A different station whose browser still has the old folder id stored.
const station = await browser.newPage();
await station.addInitScript(() => localStorage.setItem('ops_drive_folder_id', '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA'));
await attach(station, backend);
await login(station, BASE, backend);
const up = await station.evaluate(async () => {
  const { requestApi } = await import('/src/lib/api.ts');
  return requestApi('startUpload', { orderId: 'ORD-9', platform: 'Amazon', recordingType: 'Forward', fileName: 'ORD-9_Amazon_Forward.mp4', fileSize: 1000, uploadId: 'up9', recordingDate: '2026-11-24', totalChunks: 1, driveFolderId: '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA' });
});
const df = [...drive.folders.values()].find((f) => f.name === '2026-11-24');
check('station upload goes into the new folder', df && drive.pathOf(df) === 'Videos 2027/Amazon/Forward/Nov-2026/2026-11-24', df ? drive.pathOf(df) : JSON.stringify(up));

await page.screenshot({ path: process.env.SHOT || '/tmp/admin-drive.png' });
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
