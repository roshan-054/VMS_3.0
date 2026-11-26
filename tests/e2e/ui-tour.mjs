// Screenshots of every page (light + dark) for UI review. SHOTS=dir node tests/e2e/ui-tour.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/ui-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
const backend = createMockBackend({ manifests: 40 });
const ul = backend.rt.sheets.get('UploadLog');
for (let i = 0; i < 6; i++) ul.appendRow([new Date(), `DM-${i}`, 'Amazon', 'admin@test.local', `DM-${i}.mp4`, '2 MB', `up-${i}`, 'Uploaded to Google Drive', 100, `FILE_DM_${i}`, 'Completed', '', 'Forward', 'UploadLog', `job-dm-${i}`]);

const TABS = ['record', 'processing', 'queue', 'logs', 'search', 'reports', 'analytics', 'health', 'admin', 'settings'];
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const texts = {};
for (const mode of (process.env.MODES || 'light,dark').split(',')) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await attach(page, backend);
  await page.addInitScript((m) => localStorage.setItem('vms_night_mode', m === 'dark' ? 'true' : 'false'), mode);
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${mode}-login.png` });
  await login(page, BASE, backend);
  for (const t of TABS) {
    const nav = page.locator(`#nav-item-${t}`);
    if (!(await nav.count())) continue;
    await nav.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/${mode}-${t}.png`, fullPage: true });
    texts[t] = await page.locator('main').innerText().catch(() => '');
    if (t === 'admin') {
      for (const sub of ['branding', 'settings']) {
        const btn = page.locator(`#admin-tab-${sub}-btn`);
        if (!(await btn.count())) continue;
        await btn.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${SHOTS}/${mode}-admin-${sub}.png`, fullPage: true });
      }
    }
  }
  await page.close();
}
require('fs').writeFileSync(`${SHOTS}/texts.json`, JSON.stringify(texts, null, 1));
await browser.close();
console.log('done', SHOTS);
