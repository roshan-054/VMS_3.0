// E2E: every page shows dates as DD-MMM-YY (time after it). Flags ISO, slash dates and other month styles.
// Also covers year-2124 rows from old sheets and the Upload Logs detail panel.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend({ manifests: 20 });
const ul = backend.rt.sheets.get('UploadLog');
for (let i = 0; i < 4; i++) ul.appendRow([new Date(Date.now() - i * 3600e3), `DA-${i}`, 'Amazon', 'admin@test.local', `DA-${i}.mp4`, '2 MB', `up-${i}`, 'Uploaded to Google Drive', 100, `FILE_DA_${i}_abcdefghijk`, 'Completed', '', 'Forward', 'UploadLog', `job-da-${i}`]);
ul.appendRow(['2124-04-10T21:45:09.744Z', 'DA-OLD', 'Amazon', 'admin@test.local', 'DA-OLD.mp4', '2 MB', 'up-old', 'Uploaded to Google Drive', 100, 'FILE_DA_OLD_abcdefghijk', 'Completed', '', 'Forward', 'UploadLog', 'job-old']);

const BAD = [
  [/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/, 'ISO date'],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, 'slash date'],
  [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/, 'Mon D, YYYY'],
  [/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/, 'D Mon YYYY'],
  [/GMT|UTC[+-]/, 'raw Date string'],
];
const TABS = ['record', 'processing', 'queue', 'logs', 'search', 'reports', 'analytics', 'health', 'admin', 'settings'];
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 160) });
const scan = (where, text) => {
  // Placeholder hints inside inputs aren't page text; Drive folder names keep yyyy-MM-dd on purpose.
  const clean = text.replace(/VMS_Packing_Videos[^\n]*/g, '').replace(/[^\n]*\(Date\)/g, '');
  const hits = BAD.map(([re, label]) => { const m = clean.match(re); return m ? `${label}: "${m[0]}"` : null; }).filter(Boolean);
  check(`${where}: dates are DD-MMM-YY`, hits.length === 0, hits.join('; '));
};

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await attach(page, backend);
await login(page, BASE, backend);
for (const t of TABS) {
  const nav = page.locator(`#nav-item-${t}`);
  if (!(await nav.count())) { check(`${t}: tab visible`, false, 'missing'); continue; }
  await nav.click();
  await page.waitForTimeout(1500);
  scan(t, await page.locator('main').innerText());
  if (t === 'logs') {
    const first = await page.locator('tbody tr td:first-child').first().innerText();
    check('Upload Logs timestamp formatted', /^\d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(first.trim()), first);
    const all = await page.locator('tbody tr td:first-child').allInnerTexts();
    check('newest row first (not the 2124 row)', !/Apr/.test(all[0]), all[0]);
    await page.locator('tbody tr').first().locator('button[title*="etail" i], button:has-text("Details")').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    scan('logs details', await page.locator('body').innerText());
    await page.keyboard.press('Escape');
  }
  if (t === 'admin') {
    for (const sub of ['branding', 'settings']) {
      const b = page.locator(`#admin-tab-${sub}-btn`);
      if (await b.count()) { await b.click(); await page.waitForTimeout(800); scan(`admin/${sub}`, await page.locator('main').innerText()); }
    }
  }
}
await browser.close();
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
