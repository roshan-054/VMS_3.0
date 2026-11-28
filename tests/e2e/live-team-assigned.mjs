// E2E: Live Team shows an "Assigned" tile on each packer card and in the summary row, counting the
// orders assigned to that packer in the page's date range (Today, This Month, ...).
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOT || ''; // prefix, e.g. /tmp/live-team-assigned
const backend = createMockBackend({ manifests: 0 });
const { rt } = backend;
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
rt.sheets.get('Users').appendRow([new Date(), 'Vineet', 'vineet@test.local', sha('x'), 'User', 'Approved']);
rt.sheets.get('Users').appendRow([new Date(), 'Ravi', 'ravi@test.local', sha('x'), 'User', 'Approved']);
const sh = rt.sheets.get('OrderManifest');
const items = JSON.stringify([{ id: 'i1', productName: 'P', shortName: 'P', sku: 'S1', gtin: '8900000000001', quantity: 1 }]);
const now = new Date();
const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();
// Earlier this month but not today (falls back to today on the 1st, which only changes the month check).
const earlier = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 2), 10).toISOString();
const add = (at, id, name, email, status) => sh.appendRow([at, id, 'D2C', name, email, 'Test Admin', 'admin@test.local', 1, items, status, '', '', '', '']);
add(minsAgo(5), '#OD-20001', 'Vineet', 'vineet@test.local', 'Pending');
add(minsAgo(15), '#OD-20002', 'Vineet', 'vineet@test.local', 'Pending');
add(minsAgo(25), '#OD-20003', 'Vineet', 'vineet@test.local', 'Packed');
add(minsAgo(35), '#OD-20004', 'Vineet', 'vineet@test.local', 'Cancelled');
add(minsAgo(10), '#OD-20005', 'Ravi', 'ravi@test.local', 'Pending');
add(earlier, '#OD-20006', 'Vineet', 'vineet@test.local', 'Packed');
add(earlier, '#OD-20007', 'Ravi', 'ravi@test.local', 'Packed');
const sameMonthEarlier = now.getDate() > 2;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
await login(page, BASE, backend);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 140) });

await page.locator('#nav-item-team').click();
const card = (e) => page.locator(`[data-user="${e}"]`);
await card('vineet@test.local').locator('[data-assigned]').waitFor({ timeout: 15000 });
await page.waitForFunction(() => document.querySelector('[data-user="vineet@test.local"] [data-assigned]')?.getAttribute('data-assigned') !== '', null, { timeout: 15000 });
const assigned = async (e) => card(e).locator('[data-assigned]').getAttribute('data-assigned');
check('Vineet assigned today = 3 (cancelled left out)', (await assigned('vineet@test.local')) === '3', await assigned('vineet@test.local'));
check('Ravi assigned today = 1', (await assigned('ravi@test.local')) === '1', await assigned('ravi@test.local'));
check('card tile reads "Assigned today"', /Assigned today/.test(await card('vineet@test.local').innerText()));
check('summary tile shows 4 assigned today', (await page.locator('#team-assigned').innerText()).trim() === '4', await page.locator('#team-assigned').innerText());
const cardText = await card('vineet@test.local').innerText();
check('other tiles still there', ['Recorded today', 'Uploaded today', 'Packed today', 'Failed today'].every((w) => cardText.includes(w)));
if (SHOT) await page.screenshot({ path: `${SHOT}-today.png` });

await page.getByRole('button', { name: 'This Month', exact: true }).click();
await page.waitForFunction(() => /this month/.test(document.querySelector('[data-user="vineet@test.local"]')?.textContent || '') , null, { timeout: 15000 });
await page.waitForTimeout(2500);
const want = sameMonthEarlier ? '4' : '3';
check(`Vineet assigned this month = ${want}`, (await assigned('vineet@test.local')) === want, await assigned('vineet@test.local'));
check('tile label follows the filter', /Assigned this month/.test(await card('vineet@test.local').innerText()));
check('summary tile follows the filter', (await page.locator('#team-assigned').innerText()).trim() === (sameMonthEarlier ? '6' : '4'), await page.locator('#team-assigned').innerText());
if (SHOT) await page.screenshot({ path: `${SHOT}-month.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
