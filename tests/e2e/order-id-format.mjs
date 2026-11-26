// E2E: D2C order IDs show one '#', the product list shows for an order saved in an older
// format, a new D2C order typed with "##" and spaces is saved as "#OD-…", and the Settings
// card fixes old IDs in the sheet without removing rows.
// Dev server on :5179, then node tests/e2e/order-id-format.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
const backend = createMockBackend();
const now = new Date();
// Older data: the manifest (with products) was saved as "OD-10063", the video as "#OD-10063".
backend.rt.sheets.get('OrderManifest').appendRow([now, 'OD-10063', 'D2C', 'vineet', 'admin@test.local', 'Test Admin', 'admin@test.local', 2,
  'Rose Soap [SKU-RS] x 2', 'Pending', '', '', '', '']);
backend.rt.sheets.get('UploadLog').appendRow([now, '#OD-10063', 'D2C', 'admin@test.local', '#OD-10063_D2C_Forward.mp4', '138.96 MB', 'up-1',
  'Completed', 100, 'FILE_1', 'Completed', '', 'Forward', 'UploadLog', 'job-1']);
backend.rt.sheets.get('OrderLog').appendRow([now, ' ##OD-10064 ', 'D2C', 'admin@test.local', 'FILE_2', '', '', 'Completed', 'Forward']);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await attach(page, backend);
await login(page, BASE, backend);

// 1. Upload Logs details: one '#', and the product list is there.
await page.getByRole('button', { name: /Upload Logs/ }).first().click();
await page.waitForSelector('text=#OD-10063', { timeout: 20000 });
await page.waitForTimeout(2500); // order list sync
await page.locator('tr', { hasText: '#OD-10063' }).first().locator('button[title="View Complete Log Metadata"]').click();
await page.waitForSelector('text=Upload Session Log Details');
const modal = await page.locator('text=Product Information').locator('xpath=ancestor::div[3]').innerText();
const details = await page.locator('text=Upload Session Log Details').locator('xpath=ancestor::div[3]').innerText();
check('no "##" in the details', !details.includes('##') && details.includes('#OD-10063'), '');
check('product list shows Rose Soap x2', /Rose Soap/.test(modal) && /x2/.test(modal), modal.replace(/\s+/g, ' '));
await page.screenshot({ path: `${SHOTS}/upload-log-details.png` });
await page.getByRole('button', { name: 'Close' }).last().click();

// 2. Order Processing: "  ## od-20001 " typed for D2C is saved as "#OD-20001".
await page.getByRole('button', { name: /Order Processing/ }).first().click();
await page.waitForSelector('text=Order ID / AWB Number');
const oid = page.locator('input[placeholder="e.g. 402-1234567-8901234"]');
await oid.fill('  ## od-20001 ');
await oid.blur();
await page.locator('button', { hasText: /^D2C$/ }).first().click();
const shown = await oid.inputValue();
check('order ID box shows "#OD-20001" once D2C is picked', shown === '#OD-20001', shown);
await oid.fill('OD- 20002');
await oid.blur();
check('typing without # for D2C gets one #', (await oid.inputValue()) === '#OD-20002', await oid.inputValue());
await page.screenshot({ path: `${SHOTS}/order-processing-id.png` });

// The save path (same function the form calls) stores exactly one '#'.
await page.evaluate(async () => {
  const ms = await import('/src/lib/manifestStorage.ts');
  await ms.saveOrderManifest({ id: 'x', orderId: '  ## od-20001 ', platform: 'D2C', status: 'Pending', items: [{ id: '1', sku: 'S', gtin: '1', productName: 'Thing', quantity: 1 }] });
});
await page.waitForTimeout(1500);
const manRows = backend.rt.sheets.get('OrderManifest').rows.map((r) => r[1]);
check('sheet has "#OD-20001"', manRows.includes('#OD-20001'), manRows.join(', '));

// 3. Settings: fix the old IDs, rows stay.
const before = Object.fromEntries(['OrderManifest', 'OrderLog', 'UploadLog'].map((n) => [n, backend.rt.sheets.get(n).rows.length]));
await page.getByRole('button', { name: /^Settings$/ }).first().click();
await page.locator('#settings-section-data').click();
await page.waitForSelector('#order-id-format-card');
await page.locator('#order-id-format-scan').click();
await page.waitForSelector('#order-id-format-preview');
const prev = await page.locator('#order-id-format-preview').innerText();
check('check finds the 2 old-format IDs', /2 cell\(s\) need fixing/.test(prev), prev.replace(/\s+/g, ' '));
await page.locator('#order-id-format-card').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/settings-order-id-check.png` });
await page.locator('#order-id-format-fix').click();
await page.locator('#order-id-format-confirm-yes').click();
await page.waitForSelector('#order-id-format-result', { timeout: 20000 });
const after = Object.fromEntries(['OrderManifest', 'OrderLog', 'UploadLog'].map((n) => [n, backend.rt.sheets.get(n).rows.length]));
check('no rows added or removed', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
check('manifest row now "#OD-10063"', backend.rt.sheets.get('OrderManifest').rows[1][1] === '#OD-10063', backend.rt.sheets.get('OrderManifest').rows[1][1]);
check('order log row now "#OD-10064"', backend.rt.sheets.get('OrderLog').rows[1][1] === '#OD-10064', backend.rt.sheets.get('OrderLog').rows[1][1]);
await page.locator('#order-id-format-card').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/settings-order-id-fixed.png` });

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
