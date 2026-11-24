// E2E: Order Processing > Change Sheet / Tab > sync tab "UE" by tag. Checks that the catalog
// holds exactly the products with that tag, switching tags drops the old ones, and a wrong
// tab or tag typo is reported instead of silently syncing something else.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
backend.rt.addSheet('UE', [
  ['S.No', 'Product Name', 'Seller SKU', 'EAN', 'Product Image', 'Tag', 'Category', 'MRP'],
  [1, 'Steel Bottle 1L', 'BTL-1L', '8901000000011', '', 'Active-online', 'Kitchen', 499],
  [2, 'Steel Bottle 500ml', 'BTL-500', '8901000000028', '', 'Inactive-online', 'Kitchen', 399],
  [3, 'Lunch Box', 'LB-3', '8901000000035', '', 'active online', 'Kitchen', 299],
  [4, 'Flask', 'FL-4', '8901000000042', '', 'Offline', 'Kitchen', 899],
  [5, 'Tiffin Set', 'TF-5', '8901000000059', '', 'Active-online, Offline', 'Kitchen', 999],
  [6, 'Untagged Jar', 'JR-6', '8901000000066', '', '', 'Kitchen', 199],
]);
// Deepak's real Master_UE layout: the tag column is headed "Active-online".
backend.rt.addSheet('Master_UE', [
  ['Product SKU', 'GTIN Number', 'Product Name', 'Quantity', 'COGS', 'Active-online', 'Image'],
  ['UP-KUM-01', 8906191690025, 'Kumkum Powder', 1, 11.31, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/kumkum.jpg'],
  ['UP-GO-CH-01', 8906191691732, 'Gopi Chandan', 1, 11.31, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/gopi.jpg'],
  ['SHR-AK-02', 8906191690896, 'Akshat pk of 2', 2, 18.42, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/Akshat.png'],
  ['OFF-01', 8906191698888, 'Offline Item', 1, 9.5, 'Offline', ''],
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Order Processing/ }).first().click();
await page.getByRole('button', { name: /GTIN Barcode Catalog/ }).first().click();

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 110) });
const catalogSkus = () => page.evaluate(() => JSON.parse(localStorage.getItem('vms_gtin_catalog_v1') || '[]').map((p) => p.sku).sort().join(','));

async function syncWith(tab, tags, url = '') {
  await page.getByRole('button', { name: /Change Sheet \/ Tab/ }).first().click();
  await page.getByPlaceholder(/Leave blank for Master Sheet/).fill(url);
  await page.getByPlaceholder(/e\.g\. UE, Master UE/).fill(tab);
  await page.getByPlaceholder(/e\.g\. Active-online/).fill(tags);
  await page.getByRole('button', { name: /Sync & Fetch to GTIN Catalog/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Fetching Products...'));
  await page.waitForTimeout(300);
  const box = page.locator('.fixed.inset-0 .rounded-xl.text-xs.font-medium').first();
  const msg = (await box.count()) ? await box.innerText() : '';
  await page.waitForTimeout(1500); // success closes the dialog after 1.2 s
  if (await page.getByRole('button', { name: /Sync & Fetch to GTIN Catalog/ }).count()) {
    await page.getByRole('button', { name: 'Cancel' }).last().click();
  }
  return msg;
}

let msg = await syncWith('UE', 'Offline');
check('tag Offline -> Flask + Tiffin only', (await catalogSkus()) === 'FL-4,TF-5', `${await catalogSkus()} | ${msg}`);

msg = await syncWith('UE', 'Active-online');
check('tag Active-online -> exact matches, no "Inactive-online", no untagged, old tag dropped', (await catalogSkus()) === 'BTL-1L,LB-3,TF-5', `${await catalogSkus()} | ${msg}`);
check('result says how many of the tab matched', /Synced 3 of 6 products/.test(msg), msg);
check('screen count matches', (await page.getByText('GTIN Barcode Catalog (3)').count()) > 0, await page.getByRole('button', { name: /GTIN Barcode Catalog/ }).first().innerText());

msg = await syncWith('UE', 'Actve-online');
check('typo in tag is reported with the real tags, catalog kept', /Tags in this tab: .*Active-online/.test(msg) && (await catalogSkus()) === 'BTL-1L,LB-3,TF-5', msg);

msg = await syncWith('Master UE', 'Active-online');
check('wrong tab is reported with the real tab names, catalog kept', /"Master UE" was not found.*UE/.test(msg) && (await catalogSkus()) === 'BTL-1L,LB-3,TF-5', msg);

const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('vms_gtin_sheet_config_v1') || '{}'));
check('settings remember tab and tag', cfg.tabName === 'Master UE' && cfg.tagsFilter === 'Active-online', JSON.stringify(cfg));

// Sync Now (uses saved settings) after fixing the tab via Save Settings
await page.getByRole('button', { name: /Change Sheet \/ Tab/ }).first().click();
await page.getByPlaceholder(/e\.g\. UE, Master UE/).fill('UE');
await page.getByPlaceholder(/e\.g\. Active-online/).fill('Offline');
await page.getByRole('button', { name: 'Save Settings' }).click();
const cfg2 = await page.evaluate(() => JSON.parse(localStorage.getItem('vms_gtin_sheet_config_v1') || '{}'));
check('Save Settings keeps the tag', cfg2.tagsFilter === 'Offline' && cfg2.tabName === 'UE', JSON.stringify(cfg2));
await page.getByRole('button', { name: /Sync Now/ }).first().click();
await page.waitForTimeout(1500);
check('Sync Now uses saved tab + tag', (await catalogSkus()) === 'FL-4,TF-5', await catalogSkus());

msg = await syncWith('Master_UE', 'Active-online', 'https://docs.google.com/spreadsheets/d/1MasterUEsheetId_abc/edit#gid=0');
check('Master_UE sheet link: "Active-online" column used, 3 products', (await catalogSkus()) === 'SHR-AK-02,UP-GO-CH-01,UP-KUM-01' && /column "Active-online"/.test(msg), `${await catalogSkus()} | ${msg}`);

await page.screenshot({ path: process.env.SHOT || '/tmp/claude-0/catalog-sync.png' });
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
