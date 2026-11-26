// E2E: Admin panel shows Google Drive storage (account quota + VMS video space) and Refresh updates it.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { fakeDrive } = require('../../backend/tests/fake-drive.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const GB = 1073741824;
const backend = createMockBackend();
const drive = fakeDrive();
drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'VMS Videos');
let used = 12 * GB;
drive.getStorageUsed = () => used;
drive.getStorageLimit = () => 15 * GB;
backend.rt.sandbox.DriveApp = drive;
const log = backend.rt.sheets.get('OrderLog');
const now = new Date();
log.appendRow([now, '#S1', 'Amazon', 'admin@test.local', 'f1', '', '2.00 GB', 'Completed', 'Forward', 'q1', 'video/mp4', 'READY']);
log.appendRow([now, '#S2', 'Flipkart', 'admin@test.local', 'f2', '', '500.00 MB', 'Completed', 'Forward', 'q2', 'video/mp4', 'READY']);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });
const browser = await chromium.launch();
for (const dark of [false, true]) {
  const page = await browser.newPage({ viewport: { width: dark ? 390 : 1280, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').evaluate((el) => el.click());
  await page.locator('#settings-section-app').click();
  const card = page.locator('#drive-storage-card');
  await card.locator('#drive-storage-used').waitFor();
  if (!dark) {
    check('used and limit shown', /12\.0 GB.*15\.0 GB/.test(await card.locator('#drive-storage-used').innerText()), await card.locator('#drive-storage-used').innerText());
    check('percent shown', (await card.locator('#drive-storage-percent').innerText()) === '80%', await card.locator('#drive-storage-percent').innerText());
    check('VMS video space shown', /2\.49 GB/.test(await card.locator('#drive-storage-videos').innerText()), await card.locator('#drive-storage-videos').innerText());
    check('platform split shown', /Amazon: 2\.00 GB/.test(await card.innerText()), '');
    used = 14 * GB;
    await page.locator('#drive-storage-refresh').click();
    await page.waitForFunction(() => document.querySelector('#drive-storage-percent')?.textContent === '93.3%');
    check('refresh re-reads quota, shows almost-full warning', /almost full/.test(await card.innerText()), await card.locator('#drive-storage-percent').innerText());
    check('visible on Users tab too', await card.isVisible(), '');
  } else {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check('phone width: no horizontal scroll', sw <= 390, sw);
  }
  await card.screenshot({ path: `/tmp/claude-0/-home-user/308beb12-2ead-5463-b9ca-4e608d018ec7/scratchpad/drive-storage-${dark ? 'dark' : 'light'}.png` });
  await page.close();
}
await browser.close();
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
