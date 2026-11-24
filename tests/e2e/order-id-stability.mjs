// E2E: the Order ID on Scan & Record must only change when the packer scans/types a new order.
// Runs the real app (dev server, default :5179) against the real Code.gs via the GAS harness.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const sh = backend.rt.sheets.get('OrderManifest');
const item = (name, sku, gtin, qty = 1) => ({ id: sku, productName: name, shortName: name, sku, gtin, quantity: qty });
const row = (orderId, items) => [new Date().toISOString(), orderId, 'Amazon', 'Test Admin', backend.ADMIN.email, 'Test Admin', backend.ADMIN.email, '', JSON.stringify(items), 'Pending', '', '', '', ''];
// Two pending orders share the same product barcode (very common), a third has its own.
sh.appendRow(row('ORDER-AAA-1001', [item('Blue Shirt', 'SKU-BLUE', '8901234500011', 2)]));
sh.appendRow(row('ORDER-BBB-2002', [item('Blue Shirt', 'SKU-BLUE', '8901234500011')]));
sh.appendRow(row('ORDER-CCC-3003', [item('Red Cap', 'SKU-RED', '8901234500028')]));

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.waitForSelector('#orderIdInput');
await page.waitForTimeout(1500); // let the manifest sync land

// Scanner = burst of keys ~5 ms apart ending in Enter, sent to whatever has focus.
const scan = async (code) => {
  for (const ch of code) await page.keyboard.press(ch === '-' ? 'Minus' : ch, { delay: 0 }).then(() => page.waitForTimeout(5));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
};
const orderValue = () => page.inputValue('#orderIdInput');
const blurAll = () => page.evaluate(() => (document.activeElement && document.activeElement.blur(), document.body.focus()));
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail });

// 1. Scan an order label with nothing focused
await blurAll();
await scan('ORDER-AAA-1001');
check('scan label loads order', (await orderValue()) === 'ORDER-AAA-1001', await orderValue());
const modalOpen = await page.getByPlaceholder(/Scan or type product GTIN/).count();
check('verification popup opens', modalOpen > 0, modalOpen);

// 2. Click inside the popup (GTIN box loses focus), then scan the product barcode
await page.mouse.click(5, 5);
await blurAll();
await scan('8901234500011');
check('product scan with popup unfocused keeps Order ID', (await orderValue()) === 'ORDER-AAA-1001', await orderValue());
const progress = await page.locator('text=/1\\s*\\/\\s*2/').count();
check('product scan counted for the right order (1/2)', progress > 0, progress);

const closePopup = async () => {
  const x = page.getByRole('button', { name: 'Close verification' });
  if (await x.count()) await x.first().click();
  await page.waitForTimeout(200);
};

// 3. Ambiguous product barcode with no order loaded must not pick an order
await closePopup();
await page.fill('#orderIdInput', '');
await blurAll();
await scan('8901234500011');
const afterAmbiguous = await orderValue();
const popupForAmbiguous = await page.getByPlaceholder(/Scan or type product GTIN/).count();
check('shared product barcode does not auto-pick an order', afterAmbiguous === '' && popupForAmbiguous === 0, `'${afterAmbiguous}' popup=${popupForAmbiguous}`);
await closePopup();

// 4. Scanner typing into the Order ID box that still holds the previous order
await page.fill('#orderIdInput', 'ORDER-OLD-9999');
await page.click('#orderIdInput');
await page.keyboard.press('End');
await scan('ORDER-CCC-3003');
check('scan into filled box replaces, not appends', (await orderValue()) === 'ORDER-CCC-3003', await orderValue());

// 5. Verify the product, start recording, then a stray label scan must not change the order
await scan('8901234500028');
await page.getByRole('button', { name: /Start Packing Video Recording/ }).first().click();
await page.waitForSelector('text=/Recording \\(/', { timeout: 20000 });
await blurAll();
await scan('ORDER-AAA-1001');
check('order locked while recording (scan ignored)', (await orderValue()) === 'ORDER-CCC-3003', await orderValue());
const readOnly = await page.getAttribute('#orderIdInput', 'readonly');
check('Order ID box is read-only while recording', readOnly !== null, readOnly);
const dl = page.waitForEvent('download', { timeout: 30000 });
await page.getByRole('button', { name: /Stop/i }).first().click();
const file = await dl;
check('saved file is named after the locked order and its platform', file.suggestedFilename() === 'ORDER-CCC-3003_Amazon_Forward.mp4', file.suggestedFilename());

console.table(results);
if (errors.length) console.log('page errors:', errors);
await page.screenshot({ path: process.env.SHOT || '/tmp/order-id-stability.png' });
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
