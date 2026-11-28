// E2E: Super Admin connects Shopify in Settings and switches it on; orders arrive in Order
// Processing; typing a Shopify order ID fills its products with catalog barcodes; bulk assign
// skips an order whose SKU is not in the GTIN catalog; the packer scan-verifies (quantity 2 = 2
// scans, extra and wrong scans flagged and logged) and reaches recording; an order cancelled in
// Shopify is stopped at scan time. An Admin does not see the Shopify settings.
// Dev server on :5179, then node tests/e2e/shopify-orders.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const crypto = require('crypto');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots/shopify';
mkdirSync(SHOTS, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const backend = createMockBackend();
const rt = backend.rt;
const users = rt.sheets.get('Users');
users.rows[1][4] = 'Super Admin';
users.appendRow([new Date(), 'Pat Packer', 'pat@test.local', sha('PackerPass1'), 'User', 'Approved']);
users.appendRow([new Date(), 'Alice Admin', 'alice@test.local', sha('AdminPass2'), 'Admin', 'Approved']);
const cat = rt.sheets.get('GTINCatalog');
cat.rows.length = 0;
cat.rows.push(['Timestamp', 'GTIN', 'SKU', 'Product Name', 'Short Name', 'Category', 'Image URL', 'Default Quantity', 'Notes', 'Tag']);
cat.rows.push([new Date(), '8901111111111', 'SA-IT-SARO-02', 'Pure Natural Itra (Set of 2)', 'Itra Set', 'Active-online', '', 1, '', 'Active-online']);
cat.rows.push([new Date(), '8902222222222', 'NA-CL-RE-01', 'Red Pooja Cloth', 'Red Cloth', 'Active-online', '', 1, '', 'Active-online']);

// Fake Shopify store.
const now = Date.now();
const li = (sku, name, qty) => ({ id: 'l-' + sku, sku, name, title: name, variantTitle: null, quantity: qty, currentQuantity: qty, requiresShipping: true, image: null });
const shopOrders = [
  { id: 'gid://shopify/Order/1', name: '#OD-20001', createdAt: new Date(now - 3600e3).toISOString(), updatedAt: new Date(now - 3600e3).toISOString(), cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', lineItems: { nodes: [li('SA-IT-SARO-02', 'Paraayan Itra Set of 2', 2), li('NA-CL-RE-01', 'Paraayan Red Cloth', 1)] } },
  { id: 'gid://shopify/Order/2', name: '#OD-20002', createdAt: new Date(now - 1800e3).toISOString(), updatedAt: new Date(now - 1800e3).toISOString(), cancelledAt: null,
    displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', lineItems: { nodes: [li('SA-IT-SARO-02', 'Paraayan Itra Set of 2', 1)] } },
  { id: 'gid://shopify/Order/3', name: '#OD-20003', createdAt: new Date(now - 900e3).toISOString(), updatedAt: new Date(now - 900e3).toISOString(), cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', lineItems: { nodes: [li('NEW-SKU-9', 'Brand new product', 1)] } },
];
const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
rt.sandbox.UrlFetchApp = {
  fetch(url, opt) {
    if (/access_token$/.test(url)) return opt.payload.client_secret === 'secret-1' ? json(200, { access_token: 'tok', expires_in: 86399 }) : json(400, { error: 'invalid_client' });
    const body = JSON.parse(opt.payload);
    if (/shop\{name/.test(body.query)) return json(200, { data: { shop: { name: 'Test Store', myshopifyDomain: 'teststore.myshopify.com' }, orders: { nodes: [{ name: '#OD-20003', createdAt: shopOrders[2].createdAt }] } } });
    const since = String(body.variables.q).match(/'(.+)'/)[1];
    const field = /^created/.test(body.variables.q) ? 'createdAt' : 'updatedAt';
    const nodes = shopOrders.filter((o) => o[field] >= since).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    return json(200, { data: { orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
  },
};
const triggers = [];
rt.sandbox.ScriptApp = {
  getProjectTriggers: () => triggers.slice(),
  deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
  newTrigger: (fn) => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } }; return b; },
};

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 160) });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const open = async (who) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await attach(page, backend);
  await login(page, BASE, { ADMIN: who });
  return page;
};

try {
  // 1. Super Admin connects the store and switches Shopify on.
  const sa = await open(backend.ADMIN);
  await sa.getByRole('button', { name: /^Settings$/ }).first().click();
  await sa.locator('#settings-section-shopify').click();
  await sa.waitForSelector('#shopify-settings-card');
  check('off at first, switch disabled until connected', (await sa.locator('#shopify-feature-toggle').isDisabled()));
  await sa.fill('#shopify-shop', 'teststore');
  await sa.fill('#shopify-client-id', 'cid-1');
  await sa.fill('#shopify-client-secret', 'wrong');
  await sa.locator('#shopify-save').click();
  await sa.waitForSelector('text=(saved; leave empty to keep it)');
  check('store address saved as myshopify.com', (await sa.inputValue('#shopify-shop')) === 'teststore.myshopify.com', await sa.inputValue('#shopify-shop'));
  check('secret box is empty after save', (await sa.inputValue('#shopify-client-secret')) === '');
  await sa.locator('#shopify-test').click();
  await sa.waitForSelector('#shopify-settings-error');
  check('wrong secret explained', /client ID and secret/.test(await sa.locator('#shopify-settings-error').innerText()), await sa.locator('#shopify-settings-error').innerText());
  await sa.fill('#shopify-client-secret', 'secret-1');
  await sa.locator('#shopify-save').click();
  await sa.waitForTimeout(500);
  await sa.locator('#shopify-test').click();
  await sa.waitForSelector('#shopify-settings-note');
  check('test connection names the store', /Connected to Test Store/.test(await sa.locator('#shopify-settings-note').innerText()), await sa.locator('#shopify-settings-note').innerText());
  await sa.locator('#shopify-feature-toggle').click();
  await sa.waitForSelector('#shopify-feature-toggle[aria-checked="true"]');
  check('5-minute timer installed', triggers.length === 1 && triggers[0].getHandlerFunction() === 'shopifySyncTick');
  await sa.locator('#shopify-sync').click();
  await sa.waitForSelector('#shopify-settings-note >> text=/Sync done/');
  check('sync brought 3 orders', /3 new/.test(await sa.locator('#shopify-settings-note').innerText()), await sa.locator('#shopify-settings-note').innerText());
  check('secret not in the Sheet', !JSON.stringify([...rt.sheets.values()].map((s) => s.rows)).includes('secret-1'));
  await sa.screenshot({ path: `${SHOTS}/settings.png` });

  // 2. Order Processing: waiting list, autofill by typing the order ID, save & assign.
  await sa.getByRole('button', { name: /Order Processing/ }).first().click();
  await sa.waitForSelector('#shopify-orders-panel');
  await sa.waitForSelector('#shopify-orders-panel tr[data-order="#OD-20003"]');
  check('3 orders waiting', /waiting to be assigned \(3\)/.test(await sa.locator('#shopify-orders-panel h2').innerText()), await sa.locator('#shopify-orders-panel h2').innerText());
  check('unknown SKU flagged', /SKU not in GTIN catalog/.test(await sa.locator('tr[data-order="#OD-20003"]').innerText()));
  await sa.screenshot({ path: `${SHOTS}/order-processing-waiting.png` });
  await sa.getByPlaceholder('e.g. 402-1234567-8901234').fill('od-20001');
  await sa.waitForTimeout(400);
  const formText = await sa.locator('form').first().evaluate((f) => Array.from(f.querySelectorAll('input')).map((i) => i.value).join(' | '));
  check('typing the ID filled both products', /SA-IT-SARO-02/.test(formText) && /NA-CL-RE-01/.test(formText), formText);
  check('barcodes came from the GTIN catalog', /8901111111111/.test(formText) && /8902222222222/.test(formText), formText);
  check('quantity 2 kept', / 2 \|/.test(' ' + formText + ' |') || /\| 2 \|/.test(formText), formText);
  check('order ID formatted', (await sa.getByPlaceholder('e.g. 402-1234567-8901234').inputValue()) === '#OD-20001');
  await sa.screenshot({ path: `${SHOTS}/order-form-filled.png`, fullPage: false });
  await sa.locator('form select').filter({ has: sa.locator('option[value="pat@test.local"]') }).first().selectOption('pat@test.local');
  await sa.getByRole('button', { name: /Save & Assign Order to Packer/ }).click();
  await sa.waitForSelector('text=/assigned to Pat Packer/');
  await sa.waitForTimeout(800);
  const man = () => rt.sheets.get('OrderManifest').rows;
  const m1 = man().find((r) => r[1] === '#OD-20001');
  check('manifest saved for the packer', m1 && m1[4] === 'pat@test.local' && /x 2/.test(m1[8]), m1 && m1.join(' / '));
  await sa.waitForFunction(() => !document.querySelector('#shopify-orders-panel tr[data-order="#OD-20001"]'));
  check('assigned order left the waiting list', true);

  // 2b. Filters for bulk assign: COD/Prepaid, single product, product SKU, date; only shown orders get assigned.
  const rowsShown = () => sa.locator('#shopify-orders-panel tr[data-order]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-order')).sort().join(','));
  await sa.locator('tr[data-order="#OD-20003"] input[type=checkbox]').check();
  await sa.selectOption('#shopify-filter-payment', 'COD');
  check('COD filter shows only the COD order', (await rowsShown()) === '#OD-20002', await rowsShown());
  check('count says 1 of 2', /Showing 1 of 2/.test(await sa.locator('#shopify-filter-count').innerText()));
  await sa.locator('#shopify-select-filtered').click();
  check('hidden ticked order not counted for assign', /Assign 1 selected/.test(await sa.locator('#shopify-assign-selected').innerText()), await sa.locator('#shopify-assign-selected').innerText());
  await sa.screenshot({ path: `${SHOTS}/bulk-filters.png` });
  await sa.selectOption('#shopify-filter-payment', 'Prepaid');
  check('Prepaid filter', (await rowsShown()) === '#OD-20003', await rowsShown());
  await sa.selectOption('#shopify-filter-payment', '');
  await sa.selectOption('#shopify-filter-lines', 'single');
  check('single-product filter', (await rowsShown()) === '#OD-20002,#OD-20003', await rowsShown());
  await sa.selectOption('#shopify-filter-lines', 'multi');
  check('multi-product filter', (await rowsShown()) === '', await rowsShown());
  await sa.selectOption('#shopify-filter-lines', '');
  await sa.selectOption('#shopify-filter-sku', 'NEW-SKU-9');
  check('product filter', (await rowsShown()) === '#OD-20003', await rowsShown());
  check('clear button shows how many filters are on', /Clear 1 filter$/.test((await sa.locator('#shopify-filter-clear').innerText()).trim()), await sa.locator('#shopify-filter-clear').innerText());
  await sa.screenshot({ path: `${SHOTS}/clear-filters.png` });
  await sa.locator('#shopify-filter-clear').click();
  const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await sa.fill('#shopify-filter-from', day(now + 86400e3));
  check('date filter (tomorrow) hides today\'s orders', (await rowsShown()) === '', await rowsShown());
  await sa.fill('#shopify-filter-from', day(now - 900e3));
  await sa.fill('#shopify-filter-to', day(now - 900e3));
  check('date filter (order day) shows them', (await rowsShown()).includes('#OD-20003'), await rowsShown());
  await sa.locator('#shopify-filter-clear').click();
  await sa.locator('#shopify-select-none').click();

  // 3. Bulk assign: the order with an unknown SKU is held back.
  await sa.locator('tr[data-order="#OD-20002"] input[type=checkbox]').check();
  await sa.locator('tr[data-order="#OD-20003"] input[type=checkbox]').check();
  await sa.selectOption('#shopify-bulk-packer', 'pat@test.local');
  await sa.locator('#shopify-assign-selected').click();
  await sa.waitForSelector('text=/1 Shopify order assigned to Pat Packer/');
  await sa.waitForTimeout(1500);
  check('bulk assigned #OD-20002', !!man().find((r) => r[1] === '#OD-20002'));
  check('#OD-20003 held back (no barcode)', !man().find((r) => r[1] === '#OD-20003'));
  await sa.screenshot({ path: `${SHOTS}/bulk-assign.png` });

  // 4. Packer: scan to pack #OD-20001.
  const pk = await open({ email: 'pat@test.local', password: 'PackerPass1' });
  await pk.getByRole('button', { name: /Scan & Record/ }).first().click();
  await pk.waitForSelector('#orderIdInput');
  await pk.waitForTimeout(2500); // manifests sync
  await pk.fill('#orderIdInput', '#OD-20001');
  await pk.press('#orderIdInput', 'Enter');
  const scanBox = pk.getByPlaceholder('Scan or type product GTIN barcode...');
  await scanBox.waitFor({ timeout: 15000 });
  const scan = async (code) => { await scanBox.fill(code); await scanBox.press('Enter'); await pk.waitForTimeout(300); };
  await scan('8901111111111');
  await scan('8902222222222');
  await scan('8902222222222'); // extra
  const extra = await pk.locator('body').innerText();
  check('extra scan flagged', /Already scanned required quantity \(1\/1\)/.test(extra));
  await scan('1234567890123'); // wrong product
  check('wrong barcode flagged', /does NOT belong to Order #OD-20001/.test(await pk.locator('body').innerText()));
  await pk.screenshot({ path: `${SHOTS}/scan-flags.png` });
  check('not done after 1 of 2', !(await pk.locator('text=All Products 100% Verified!').count()));
  await scan('8901111111111');
  await pk.waitForSelector('text=All Products 100% Verified!');
  check('second scan of quantity 2 completes the order', true);
  await pk.screenshot({ path: `${SHOTS}/scan-verified.png` });
  await pk.getByRole('button', { name: /Start Packing Video Recording/ }).click();
  await pk.waitForSelector('text=/Order #OD-20001 verified! Starting packing recording/', { timeout: 10000 });
  check('recording step reached as before', true);
  await pk.screenshot({ path: `${SHOTS}/after-verify.png` });
  await pk.waitForTimeout(1500);
  const logs = rt.sheets.get('PackVerificationLog').rows.filter((r) => r[1] === '#OD-20001').map((r) => r[7]);
  check('audit log has the extra and wrong scans and the match', logs.includes('OVER_PACK') && logs.includes('MISMATCH') && logs.includes('MATCHED'), logs.join(','));

  // 5. #OD-20002 is cancelled in Shopify: the next sync stops the packer.
  shopOrders[1].cancelledAt = new Date().toISOString();
  shopOrders[1].updatedAt = new Date().toISOString();
  rt.sandbox.shopifySyncTick();
  const m2 = man().find((r) => r[1] === '#OD-20002');
  check('assigned order marked Cancelled', m2 && m2[9] === 'Cancelled', m2 && m2.join(' / '));
  await pk.reload();
  await pk.waitForSelector('text=Scan & Record', { timeout: 20000 });
  await pk.getByRole('button', { name: /Scan & Record/ }).first().click();
  await pk.waitForSelector('#orderIdInput');
  await pk.waitForTimeout(3000);
  await pk.fill('#orderIdInput', '#OD-20002');
  await pk.press('#orderIdInput', 'Enter');
  await pk.waitForTimeout(800);
  const txt = await pk.locator('body').innerText();
  check('packer told the order is cancelled', /cancelled/i.test(txt) && !(await scanBox.count()), txt.match(/.{0,40}cancelled.{0,40}/i)?.[0]);
  await pk.screenshot({ path: `${SHOTS}/cancelled.png` });

  // 6. An Admin has no Shopify settings section.
  const al = await open({ email: 'alice@test.local', password: 'AdminPass2' });
  await al.getByRole('button', { name: /^Settings$/ }).first().click();
  await al.waitForSelector('#settings-sections');
  check('Admin has no Shopify section', (await al.locator('#settings-section-shopify').count()) === 0);
} catch (e) {
  check('script ran to the end', false, e.message);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
