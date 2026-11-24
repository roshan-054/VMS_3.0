// E2E: Order Processing no longer offers "Add Single Product" or "Multi-Product / Excel Paste",
// while sheet sync, CSV import and editing catalog products still work.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
await login(page, BASE, backend);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 100) });
const gone = /Add Single Product|Add Product\b|Multi-Product|Excel Paste|Quick-Paste/i;

await page.getByRole('button', { name: /Order Processing/ }).first().click();
await page.waitForTimeout(500);
let text = await page.locator('main').innerText();
check('order screen: no Add Single Product / Excel Paste', !gone.test(text), text.match(gone)?.[0]);

await page.getByRole('button', { name: /GTIN Barcode Catalog/ }).first().click();
await page.waitForTimeout(400);
text = await page.locator('main').innerText();
check('catalog tab: no Add Product / Excel Paste', !gone.test(text), text.match(gone)?.[0]);
check('catalog tab: sheet sync still there', (await page.getByRole('button', { name: /Change Sheet \/ Tab/ }).count()) > 0);
check('catalog tab: CSV import still there', (await page.locator('input[type="file"]').count()) > 0);

const tabs = await page.locator('button').allInnerTexts();
check('other Order Processing tabs still present', tabs.some((t) => /Manifest/i.test(t)), tabs.filter((t) => /Manifest|Entry|Audit/i.test(t)).join(' / '));
check('no page errors', errors.length === 0, errors.join(' | '));
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
