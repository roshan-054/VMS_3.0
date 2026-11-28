// E2E: a packer records a Return; the Return Details panel fills customer + pincode from the
// Shopify order data, picks a logistics partner, adds a new one, records the condition and a
// not-received claim; details save when the recording stops. The report download carries the
// return columns, and Analytics > Returns & RTO shows the partner, pincode and suspicious customer.
// Dev server on :5179, then node tests/e2e/return-details.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const crypto = require('crypto');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots/returns';
mkdirSync(SHOTS, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const backend = createMockBackend();
const users = backend.rt.sheets.get('Users');
users.rows[1][4] = 'Super Admin';
users.appendRow([new Date(), 'Pat Packer', 'pat@test.local', sha('PackerPass1'), 'User', 'Approved']);
const now = new Date();
backend.rt.addSheet('ShopifyOrders', [
  ['Synced At', 'Order ID', 'Order Date', 'Payment', 'Customer Name', 'Customer Phone', 'Customer Email', 'Shipping Pincode', 'Shipping City', 'Courier'],
  [now, '#OD-5001', now, 'COD', 'Raj Mehta', '9111111111', 'raj@example.com', '400001', 'Mumbai', 'Delhivery'],
  [now, '#OD-5002', now, 'COD', 'Raj Mehta', '9111111111', 'raj@example.com', '400001', 'Mumbai', 'Delhivery'],
  [now, '#OD-5003', now, 'Prepaid', 'Anu Rao', '9222222222', 'anu@example.com', '560001', 'Bengaluru', 'Blue Dart'],
]);
// An earlier RTO for the same customer (so two RTOs make them suspicious).
backend.rt.sheets.get('ReturnLog').appendRow([now, '#OD-5002', 'D2C', 'pat@test.local', 'FILE_RET_5002', '', '1 MB', 'Completed', 'Return', 'r0', 'video/mp4', 'READY']);
backend.rt.addSheet('ReturnDetails', [
  ['Timestamp', 'Order ID', 'Platform', 'Return Type', 'Logistics Partner', 'Return Condition', 'Notes', 'Pincode', 'Customer Name', 'Customer Phone', 'Customer Email', 'Not Received Claim', 'Recorded By'],
  [now, '#OD-5002', 'D2C', 'RTO', 'Delhivery', 'Good / resellable', '', '400001', 'Raj Mehta', '9111111111', 'raj@example.com', 'No', 'pat@test.local'],
]);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 160) });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const open = async (who) => {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await attach(page, backend);
  await login(page, BASE, { ADMIN: who });
  return page;
};

// 1. Packer: Return mode, scan the order.
const pk = await open({ email: 'pat@test.local', password: 'PackerPass1' });
await pk.getByRole('button', { name: /Scan & Record/ }).first().click();
await pk.waitForSelector('#orderIdInput', { timeout: 15000 });
check('no return panel in Forward mode', (await pk.locator('#return-details-card').count()) === 0);
await pk.getByRole('button', { name: /^Return$/ }).first().click();
await pk.waitForSelector('#return-details-card');
await pk.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await pk.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
await pk.fill('#orderIdInput', 'OD-5001');
await pk.waitForTimeout(500);
if (await pk.locator('#platformSelect').count()) await pk.selectOption('#platformSelect', 'D2C').catch(() => undefined);
await pk.waitForSelector('#return-filled-order', { timeout: 20000 });
check('panel follows the order', (await pk.locator('#return-details-order').innerText()).includes('OD-5001'), await pk.locator('#return-details-order').innerText());
check('pincode from order data', (await pk.inputValue('#return-pincode')) === '400001', await pk.inputValue('#return-pincode'));
check('name, phone, email from order data', (await pk.inputValue('#return-name')) === 'Raj Mehta' && (await pk.inputValue('#return-phone')) === '9111111111' && (await pk.inputValue('#return-email')) === 'raj@example.com');
check('courier from order data', (await pk.inputValue('#return-partner')) === 'Delhivery', await pk.inputValue('#return-partner'));
const partners = await pk.locator('#return-partner option').allInnerTexts();
check('default partners listed', partners.includes('Blue Dart') && partners.some((x) => /Add new partner/.test(x)), partners.join('|'));
await pk.screenshot({ path: `${SHOTS}/return-panel-filled.png` });

// 2. Add a new partner, record.
await pk.selectOption('#return-partner', '__add__');
await pk.fill('#return-partner-new', 'Shiprocket');
await pk.locator('#return-partner-add').click();
await pk.waitForSelector('#return-partner >> option:has-text("Shiprocket")', { state: 'attached' });
check('new partner selected', (await pk.inputValue('#return-partner')) === 'Shiprocket');
await pk.getByRole('button', { name: /Start Recording/i }).first().click();
await pk.waitForSelector('text=/Recording \\(/', { timeout: 10000 });
await pk.selectOption('#return-type', 'RTO');
await pk.selectOption('#return-condition', 'Opened / used');
await pk.locator('#return-claim').check();
await pk.fill('#return-notes', 'Tape re-sealed');
await pk.screenshot({ path: `${SHOTS}/return-recording.png` });
await pk.waitForTimeout(3000);
await pk.getByRole('button', { name: /Stop/i }).first().click();
await pk.waitForSelector('text=/saved & queued|queued for/i', { timeout: 30000 });
await pk.waitForTimeout(1500);
let rows = backend.rt.sheets.get('ReturnDetails').rows;
const r1 = rows.find((r) => r[1] === '#OD-5001');
check('saved at stop', r1 && r1[3] === 'RTO' && r1[4] === 'Shiprocket' && r1[5] === 'Opened / used' && r1[6] === 'Tape re-sealed' && r1[7] === '400001' && r1[10] === 'raj@example.com' && r1[11] === 'Yes', JSON.stringify(r1));
check('partner kept for everyone', JSON.stringify(backend.rt.sheets.get('Branding').rows).includes('Shiprocket'));
await pk.waitForSelector('#return-details-saved', { timeout: 5000 }).catch(() => undefined);
check('panel shows Saved', (await pk.locator('#return-details-saved').count()) === 1);
await pk.screenshot({ path: `${SHOTS}/return-saved.png` });

// 3. Invalid pincode is refused in the panel.
await pk.fill('#return-pincode', '4000');
await pk.locator('#return-details-save').click();
check('short pincode refused', /6 digits/.test(await pk.locator('#return-details-error').innerText().catch(() => '')));
await pk.context().close();

// 4. Super Admin: report + analytics.
backend.rt.sheets.get('ReturnLog').appendRow([new Date(), '#OD-5001', 'D2C', 'pat@test.local', 'FILE_RET_5001', '', '1 MB', 'Completed', 'Return', 'r1', 'video/mp4', 'READY']);
const sa = await open(backend.ADMIN);
await sa.getByRole('button', { name: /^Reports$/ }).first().click();
await sa.locator('#preview-report-btn').click();
await sa.waitForSelector('text=#OD-5001', { timeout: 20000 });
const head = await sa.locator('thead').first().innerText();
check('report has return columns', /Logistics Partner/.test(head) && /Return Condition/.test(head) && /Pincode/.test(head) && /Customer Email/.test(head), head.replace(/\s+/g, ' '));
const dl = sa.waitForEvent('download');
await sa.getByRole('button', { name: /Export CSV/ }).first().click();
const csv = readFileSync(await (await dl).path(), 'utf8');
const line = csv.split('\n').find((l) => l.includes('#OD-5001')) || '';
check('CSV row has return details', line.includes('"Shiprocket"') && line.includes('"RTO"') && line.includes('"400001"'), line);

await sa.getByRole('button', { name: /^Analytics$/ }).first().click();
await sa.locator('#analytics-returns-tab').click();
await sa.waitForSelector('#returns-suspicious-table', { timeout: 20000 });
check('2 returns counted', (await sa.locator('#ret-total').innerText()).includes('2'), await sa.locator('#ret-total').innerText());
check('RTO tile 2', /\b2\b/.test(await sa.locator('#ret-rto').innerText()));
check('return rate uses orders', /of 3 orders/.test(await sa.locator('#ret-rate').innerText()), await sa.locator('#ret-rate').innerText());
const sus = await sa.locator('#returns-suspicious-table').innerText();
check('Raj flagged suspicious', /Raj Mehta/.test(sus) && /RTO/.test(sus), sus.replace(/\s+/g, ' '));
check('Raj in repeat customers', /Raj Mehta/.test(await sa.locator('#returns-repeat-table').innerText()));
const pins = await sa.locator('#returns-pincode-table').innerText();
check('pincode 400001 with 100% return rate', /400001/.test(pins) && /100%/.test(pins), pins.replace(/\s+/g, ' '));
check('partner table has Shiprocket and Delhivery', /Shiprocket/.test(await sa.locator('#returns-partner-table').innerText()) && /Delhivery/.test(await sa.locator('#returns-partner-table').innerText()));
await sa.screenshot({ path: `${SHOTS}/analytics-returns.png`, fullPage: true });
const dl2 = sa.waitForEvent('download');
await sa.locator('#returns-export').click();
const xname = (await dl2).suggestedFilename();
check('Excel download named with DD-MMM-YY', /^Returns_RTO_\d{2}-[A-Z][a-z]{2}-\d{2}_to_/.test(xname), xname);
await sa.emulateMedia({ colorScheme: 'dark' });
await sa.evaluate(() => document.documentElement.classList.add('dark'));
await sa.screenshot({ path: `${SHOTS}/analytics-returns-dark.png`, fullPage: false });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
