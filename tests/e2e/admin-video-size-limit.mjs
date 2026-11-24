// E2E: Admin sets the max video size centrally; another station picks it up; the server enforces it.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { fakeDrive } = require('../../backend/tests/fake-drive.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const drive = fakeDrive();
backend.rt.sandbox.DriveApp = drive;
drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
const MB = 1024 * 1024;
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 100) });
const row = () => (backend.rt.sheets.get('Branding')?.rows || []).find((r) => r[0] === 'MaxVideoSizeMb');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Admin & Users/ }).first().click();
await page.locator('#admin-tab-settings-btn').click();
const current = page.locator('#video-size-limit-current');
await current.waitFor();
check('default shown as 1 GB', (await current.innerText()) === '1 GB', await current.innerText());

await page.locator('#video-size-limit-setting button[data-size-mb="2048"]').click();
await page.waitForFunction(() => document.querySelector('#video-size-limit-current')?.textContent === '2 GB');
check('2 GB saved centrally', row() && Number(row()[1]) === 2048, row());

const station = await browser.newPage();
await attach(station, backend);
await login(station, BASE, backend);
await station.waitForFunction(() => localStorage.getItem('ops_max_video_size_mb') === '2048', null, { timeout: 10000 }).catch(() => {});
check('other station picks up 2 GB', (await station.evaluate(() => localStorage.getItem('ops_max_video_size_mb'))) === '2048', await station.evaluate(() => localStorage.getItem('ops_max_video_size_mb')));

const tryUpload = (size, n) => station.evaluate(async ([size, n]) => {
  const { requestApi } = await import('/src/lib/api.ts');
  try {
    const r = await requestApi('startUpload', { orderId: 'ORD-' + n, platform: 'Amazon', recordingType: 'Forward', fileName: `ORD-${n}_Amazon_Forward.webm`, fileSize: size, uploadId: 'u' + n, recordingDate: '2026-11-24', totalChunks: 1 });
    return { ok: true, code: r.code };
  } catch (e) { return { ok: false, code: e.code, msg: e.message }; }
}, [size, n]);
const big = await tryUpload(3000 * MB, 1);
check('3 GB refused by server at 2 GB limit', !big.ok && big.code === 'VIDEO_TOO_LARGE', JSON.stringify(big));

await page.locator('#video-size-limit-setting button[data-size-mb="0"]').click();
await page.waitForFunction(() => document.querySelector('#video-size-limit-current')?.textContent === 'No limit');
check('No limit saved', row() && Number(row()[1]) === 0, row());
const big2 = await tryUpload(3000 * MB, 2);
check('3 GB accepted with no limit', big2.code !== 'VIDEO_TOO_LARGE', JSON.stringify(big2));

await page.locator('#video-size-limit-custom').fill('10');
await page.locator('#video-size-limit-save').click();
await page.waitForTimeout(500);
check('10 MB refused (min 50)', Number(row()[1]) === 0, row());
await page.locator('#video-size-limit-custom').fill('750');
await page.locator('#video-size-limit-save').click();
await page.waitForFunction(() => document.querySelector('#video-size-limit-current')?.textContent === '750 MB');
check('custom 750 MB saved', Number(row()[1]) === 750, row());

await page.locator('#video-size-limit-setting').screenshot({ path: process.env.SHOT || '/tmp/admin-size.png' });
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
