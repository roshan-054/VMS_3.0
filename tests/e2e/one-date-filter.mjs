// E2E: Order Processing has ONE date filter (top bar) that drives both the summary cards and the
// Manifest Order Queue, and it opens on "Today".
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOT || '';
const backend = createMockBackend({ manifests: 5 });
// Two older orders (10 days ago) that "Today" must hide and "All Time" must show.
const sh = backend.rt.sheets.get('OrderManifest');
const old = new Date(Date.now() - 10 * 86400000).toISOString();
const items = JSON.stringify([{ id: 'i1', productName: 'Old Product', shortName: 'Old', sku: 'SKU-OLD', gtin: '8900000009999', quantity: 1 }]);
for (const id of ['#OD-90001', '#OD-90002']) sh.appendRow([old, id, 'D2C', 'Test Admin', 'admin@test.local', 'Test Admin', 'admin@test.local', '', items, 'Pending', '', '', '', '']);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
await login(page, BASE, backend);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });

await page.getByRole('button', { name: /Order Processing/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Manifest Orders/ }).first().click();
await page.waitForTimeout(600);

const main = page.locator('main');
const text = async () => main.innerText();
const count = (t, re) => (t.match(re) || []).length;
let t = await text();
check('only one "Date Range Filter" on the page', count(t, /Date Range Filter/g) === 1, count(t, /Date Range Filter/g));
check('only one "All Time" button', (await page.getByRole('button', { name: 'All Time', exact: true }).count()) === 1);
const todayBtn = page.getByRole('button', { name: 'Today', exact: true });
check('Today is selected on load', /bg-indigo-600/.test((await todayBtn.getAttribute('class')) || ''));
check('queue hides older orders on Today', !/OD-9000[12]/.test(t));
check('total card shows 5 on Today', /TOTAL MANIFEST ORDERS\s*5\b/i.test(t), t.match(/TOTAL MANIFEST ORDERS\s*\d+/i)?.[0]);
if (SHOT) await page.screenshot({ path: SHOT, fullPage: false });

await page.getByRole('button', { name: 'All Time', exact: true }).click();
await page.waitForTimeout(400);
t = await text();
check('All Time: queue shows older orders', /OD-9000[12]/.test(t));
check('All Time: total card shows 7', /TOTAL MANIFEST ORDERS\s*7\b/i.test(t), t.match(/TOTAL MANIFEST ORDERS\s*\d+/i)?.[0]);
check('Reset to Today button appears', (await page.getByRole('button', { name: 'Reset to Today' }).count()) === 1);
await page.getByRole('button', { name: 'Reset to Today' }).click();
await page.waitForTimeout(400);
t = await text();
check('Reset goes back to Today', !/OD-9000[12]/.test(t) && /bg-indigo-600/.test((await todayBtn.getAttribute('class')) || ''));
const raw = await main.evaluate((el) => el.textContent || '');
check('other queue filters still there', ['Packer:', 'Platform:', 'Sort:', 'Pending Packing', 'Packed & Verified'].every((w) => raw.includes(w)), ['Packer:', 'Platform:', 'Sort:', 'Pending Packing', 'Packed & Verified'].filter((w) => !raw.includes(w)).join(','));
check('no page errors', errors.length === 0, errors.join(' | '));
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
