'use strict';
// Shopify orders: Super Admin settings, fetch into the ShopifyOrders tab, SKU -> GTIN matching,
// cancellations reaching Order Processing.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const users = () => [
  [new Date(), 'Sue Super', 'sue@example.com', sha('SuperPass1'), 'Super Admin', 'Approved'],
  [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
];
const PW = { 'sue@example.com': 'SuperPass1', 'alice@example.com': 'AdminPass1', 'pat@example.com': 'PackerPass1' };
const login = (rt, email) => {
  const r = rt.call('login', { email, password: PW[email] });
  assert.equal(r.success, true, r.error);
  return r.token;
};

const order = (n, over = {}) => ({
  id: 'gid://shopify/Order/' + n,
  name: '#OD-' + n,
  createdAt: '2026-11-28T03:00:00Z',
  updatedAt: '2026-11-28T03:00:0' + (n % 10) + 'Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  lineItems: { nodes: [
    { id: 'li1', sku: 'SA-IT-SARO-02', name: 'Itra Set of 2', title: 'Itra', variantTitle: null, quantity: 2, currentQuantity: 2, requiresShipping: true, image: { url: 'https://cdn.shopify.com/a.jpg' } },
    { id: 'li2', sku: 'NA-CL-RE-01', name: 'Red Pooja Cloth', title: 'Cloth', variantTitle: null, quantity: 1, currentQuantity: 1, requiresShipping: true, image: null },
    { id: 'li3', sku: 'TIP', name: 'Tip', title: 'Tip', variantTitle: null, quantity: 1, currentQuantity: 1, requiresShipping: false, image: null },
    { id: 'li4', sku: 'REFUNDED', name: 'Removed item', title: 'x', variantTitle: null, quantity: 1, currentQuantity: 0, requiresShipping: true, image: null },
  ] },
  ...over,
});

/** Fake Shopify: token endpoint + GraphQL orders search. */
function fakeShopify(rt, state) {
  state.calls = [];
  rt.sandbox.UrlFetchApp = {
    fetch(url, opt) {
      state.calls.push({ url, opt });
      const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
      if (/\/admin\/oauth\/access_token$/.test(url)) {
        if (opt.payload.client_secret !== 'right-secret') return resp(400, { error: 'invalid_client' });
        state.tokens = (state.tokens || 0) + 1;
        return resp(200, { access_token: 'tok-' + state.tokens, scope: 'read_orders', expires_in: 86399 });
      }
      if (/\/admin\/api\/[\d-]+\/graphql\.json$/.test(url)) {
        const tok = opt.headers['X-Shopify-Access-Token'];
        if (state.rejectToken && tok === state.rejectToken) return resp(401, { errors: 'Invalid API key or access token' });
        const body = JSON.parse(opt.payload);
        if (state.denyCustomer && /customer\{/.test(body.query)) return resp(200, { errors: [{ message: 'This app is not approved to access the Customer object.' }] });
        if (/shop\{name/.test(body.query)) return resp(200, { data: { shop: { name: 'Paraayan', myshopifyDomain: 'teststore.myshopify.com' }, orders: { nodes: [{ name: '#OD-1', createdAt: 'x' }] } } });
        state.queries = (state.queries || []).concat(body.variables.q);
        const pages = state.pages || [[]];
        const idx = body.variables.after ? Number(body.variables.after) : 0;
        const nodes = pages[idx] || [];
        const more = idx + 1 < pages.length;
        return resp(200, { data: { orders: { nodes, pageInfo: { hasNextPage: more, endCursor: more ? String(idx + 1) : null } } } });
      }
      return resp(404, {});
    },
  };
  const triggers = [];
  state.triggers = triggers;
  rt.sandbox.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => { const t = { getHandlerFunction: () => fn, minutes: m }; triggers.push(t); return t; } }) }) }),
  };
}

function setupRuntime() {
  const rt = createRuntime({ users: users() });
  const state = {};
  fakeShopify(rt, state);
  const cat = rt.sandbox.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('GTINCatalog');
  cat.rows.length = 0;
  cat.rows.push(['Timestamp', 'GTIN', 'SKU', 'Product Name', 'Short Name', 'Category', 'Image URL', 'Default Quantity', 'Notes', 'Tag']);
  cat.rows.push([new Date(), '8901234567890', 'sa-it-saro-02', 'Pure Natural Itra (Set of 2)', 'Itra Set', 'Puja', 'https://img/itra.jpg', 1, '', 'Active-online']);
  return { rt, state, sue: login(rt, 'sue@example.com') };
}

test('only the Super Admin sees or changes the Shopify settings, and secrets never come back', () => {
  const { rt, sue } = setupRuntime();
  for (const email of ['alice@example.com', 'pat@example.com']) {
    const t = login(rt, email);
    assert.match(rt.call('getShopifySettings', { token: t }).error, /Only the Super Admin/);
    assert.match(rt.call('saveShopifySettings', { token: t, shop: 'x' }).error, /Only the Super Admin/);
  }
  assert.match(rt.call('saveShopifySettings', { token: sue, enabled: true }).error, /before switching Shopify orders on/);
  assert.match(rt.call('saveShopifySettings', { token: sue, shop: 'www.paraayan.com' }).error, /myshopify\.com/);
  const saved = rt.call('saveShopifySettings', { token: sue, shop: 'https://TestStore.myshopify.com/admin', clientId: 'cid', clientSecret: 'right-secret' });
  assert.equal(saved.success, true, saved.error);
  assert.equal(saved.shop, 'teststore.myshopify.com');
  assert.equal(saved.hasClientSecret, true);
  assert.equal(saved.connectedWith, 'clientCredentials');
  assert.ok(!JSON.stringify(saved).includes('right-secret'), 'the secret is never returned');
  assert.equal(rt.call('saveShopifySettings', { token: sue, shop: 'admin.shopify.com/store/teststore' }).shop, 'teststore.myshopify.com');
});

test('switching on adds a 5-minute trigger; off removes it; members cannot sync while off', () => {
  const { rt, state, sue } = setupRuntime();
  const pat = login(rt, 'pat@example.com');
  assert.match(rt.call('shopifySyncNow', { token: pat }).error, /switched off/);
  assert.deepEqual(rt.call('getShopifyOrders', { token: pat }), { success: true, enabled: false, orders: [] });
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  const on = rt.call('saveShopifySettings', { token: sue, enabled: true });
  assert.equal(on.enabled, true, on.error);
  assert.equal(state.triggers.length, 1);
  assert.equal(state.triggers[0].getHandlerFunction(), 'shopifySyncTick');
  assert.equal(state.triggers[0].minutes, 5);
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  assert.equal(state.triggers.length, 1, 'never a second trigger');
  const off = rt.call('saveShopifySettings', { token: sue, enabled: false });
  assert.equal(off.enabled, false);
  assert.equal(state.triggers.length, 0);
});

test('test connection reports a wrong client secret clearly', () => {
  const { rt, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'wrong' });
  assert.match(rt.call('testShopifyConnection', { token: sue }).error, /did not accept the client ID and secret/);
  rt.call('saveShopifySettings', { token: sue, clientSecret: 'right-secret' });
  const ok = rt.call('testShopifyConnection', { token: sue });
  assert.equal(ok.success, true, ok.error);
  assert.equal(ok.shopName, 'Paraayan');
  assert.equal(ok.latestOrder, '#OD-1');
});

test('sync saves open orders with shippable items, matches SKUs to GTINs and skips old shipped/cancelled ones', () => {
  const { rt, state, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret', backfillDays: 2 });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  state.pages = [
    [order(10360), order(10361, { displayFulfillmentStatus: 'FULFILLED' })],
    [order(10362, { cancelledAt: '2026-11-28T03:30:00Z' }), order(10363, { name: 'OD-10363' })],
  ];
  const pat = login(rt, 'pat@example.com');
  const r = rt.call('shopifySyncNow', { token: pat });
  assert.equal(r.success, true, r.error);
  assert.equal(r.firstRun, true);
  assert.equal(r.fetched, 4);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.pages, 2);
  assert.match(state.queries[0], /^created_at:>='/);
  const sh = rt.sheets.get('ShopifyOrders');
  assert.deepEqual(sh.rows[0], ['Synced At', 'Order ID', 'Order Date', 'Payment', 'Fulfillment', 'Order Status',
    'Total Items Count', 'Items List', 'Items JSON', 'Shopify Order ID', 'Shopify Updated At',
    'Payment Mode', 'Payment Gateway', 'Tags', 'Customer Name', 'Customer Phone', 'Customer Email',
    'Shipping Pincode', 'Shipping City', 'Shipping State', 'Courier', 'Tracking Number']);
  assert.deepEqual(sh.rows.slice(1).map((x) => x[1]), ['#OD-10360', '#OD-10363'], 'D2C IDs always #OD-…');
  assert.equal(sh.rows[1][6], 3, 'the tip and the refunded line are left out');
  assert.equal(sh.rows[1][7], 'Itra Set of 2 [SA-IT-SARO-02] x 2; Red Pooja Cloth [NA-CL-RE-01] x 1');
  assert.ok(sh.rows[1][0] instanceof Date && sh.rows[1][2] instanceof Date);

  const list = rt.call('getShopifyOrders', { token: pat });
  assert.equal(list.enabled, true);
  assert.equal(list.orders.length, 2);
  const o = list.orders.find((x) => x.orderId === '#OD-10360');
  assert.equal(o.items.length, 2);
  assert.deepEqual(o.items.map((i) => [i.sku, i.gtin, i.quantity, i.inCatalog]), [
    ['SA-IT-SARO-02', '8901234567890', 2, true],
    ['NA-CL-RE-01', '', 1, false],
  ]);
  assert.equal(o.items[0].shortName, 'Itra Set');
  assert.equal(o.items[0].imageUrl, 'https://img/itra.jpg', 'catalog image wins');
  assert.equal(o.items[1].imageUrl, '', 'no image on that line');
  assert.equal(o.missingGtin, 1);
  assert.equal(rt.call('getShopifyOrders', { token: pat, orderId: 'od-10360' }).orders.length, 1, 'lookup by any form of the ID');
});

test('the next run asks only for changed orders, updates rows in place and cancels a pending manifest', () => {
  const { rt, state, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  state.pages = [[order(10360), order(10364)]];
  assert.equal(rt.call('shopifySyncNow', { token: sue }).added, 2);
  // Order Processing assigned both orders; one is already packed.
  const man = rt.sheets.get('OrderManifest');
  man.rows.length = 0;
  man.rows.push(['Timestamp', 'Order ID', 'Platform', 'Assigned Packer Name', 'Assigned Packer Email', 'Processed By Name', 'Processed By Email', 'Total Items Count', 'Items List', 'Status', 'Notes', 'Packed At', 'Packed By Name', 'Video Drive Link']);
  man.rows.push([new Date(), '#OD-10360', 'D2C', 'Pat', 'pat@example.com', 'Sue', 'sue@example.com', 3, 'x', 'Pending', '', '', '', '']);
  man.rows.push([new Date(), '#OD-10364', 'D2C', 'Pat', 'pat@example.com', 'Sue', 'sue@example.com', 3, 'x', 'Packed', '', '', '', '']);
  state.pages = [[
    order(10360, { cancelledAt: '2026-11-28T04:00:00Z', updatedAt: '2026-11-28T04:00:00Z' }),
    order(10364, { cancelledAt: '2026-11-28T04:00:00Z', updatedAt: '2026-11-28T04:00:01Z' }),
    order(10365, { updatedAt: '2026-11-28T04:00:02Z' }),
  ]];
  const r = rt.call('shopifySyncNow', { token: sue, force: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.firstRun, false);
  assert.match(state.queries[1], /^updated_at:>='2026-11-28T02:58:/, 'cursor minus two minutes');
  assert.equal(r.updated, 2);
  assert.equal(r.added, 1);
  assert.equal(r.cancelledManifests, 1);
  const sh = rt.sheets.get('ShopifyOrders');
  assert.equal(sh.rows.length, 4, 'no second row for the same order');
  assert.equal(sh.rows[1][5], 'Cancelled');
  assert.deepEqual(man.rows[1].slice(9, 11), ['Cancelled', 'Cancelled in Shopify']);
  assert.equal(man.rows[2][9], 'Packed', 'a packed order is left alone');
  const open = rt.call('getShopifyOrders', { token: sue });
  assert.deepEqual(open.orders.map((o) => o.orderId), ['#OD-10365']);
  assert.equal(rt.call('getShopifyOrders', { token: sue, status: 'all' }).orders.length, 3);
  // Running again with nothing new changes nothing.
  const again = rt.call('shopifySyncNow', { token: sue, force: true });
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 3);
});

test('an expired client-credentials token is renewed once; an Admin API token is used as is', () => {
  const { rt, state, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  state.pages = [[order(10360)]];
  rt.call('shopifySyncNow', { token: sue });
  assert.equal(state.tokens, 1);
  state.rejectToken = 'tok-1';
  const r = rt.call('shopifySyncNow', { token: sue, force: true });
  assert.equal(r.success, true, r.error);
  assert.equal(state.tokens, 2);
  rt.call('saveShopifySettings', { token: sue, adminToken: 'shpat_abc' });
  state.calls.length = 0;
  rt.call('shopifySyncNow', { token: sue, force: true });
  assert.ok(state.calls.every((c) => !/access_token$/.test(c.url)));
  assert.equal(state.calls[0].opt.headers['X-Shopify-Access-Token'], 'shpat_abc');
});

test('the timed run does nothing while off and records failures for the Settings card', () => {
  const { rt, state, sue } = setupRuntime();
  rt.sandbox.shopifySyncTick();
  assert.equal(state.calls.length, 0);
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  rt.call('saveShopifySettings', { token: sue, clientSecret: 'wrong' });
  rt.sandbox.shopifySyncTick();
  const s = rt.call('getShopifySettings', { token: sue });
  assert.equal(s.lastResult.success, false);
  assert.equal(s.lastResult.source, 'auto');
  assert.match(s.lastResult.error, /client ID and secret/);
});

test('manifests read back from the Sheet get each product\'s barcode from the catalog by SKU', () => {
  const { rt, sue } = setupRuntime();
  const man = rt.sheets.get('OrderManifest');
  man.rows.length = 0;
  man.rows.push(['Timestamp', 'Order ID', 'Platform', 'Assigned Packer Name', 'Assigned Packer Email', 'Processed By Name', 'Processed By Email', 'Total Items Count', 'Items List', 'Status', 'Notes', 'Packed At', 'Packed By Name', 'Video Drive Link']);
  man.rows.push([new Date(), '#OD-10360', 'D2C', 'Pat', 'pat@example.com', 'Sue', 'sue@example.com', 3, 'Itra Set [SA-IT-SARO-02] x 2; Cloth [NA-CL-RE-01] x 1', 'Pending', '', '', '', '']);
  const r = rt.call('getOrderManifests', { token: sue });
  assert.equal(r.success, true, r.error);
  const items = r.manifests[0].items;
  assert.deepEqual(items.map((i) => [i.sku, i.gtin, i.quantity]), [['SA-IT-SARO-02', '8901234567890', 2], ['NA-CL-RE-01', '', 1]]);
  assert.equal(items[0].imageUrl, 'https://img/itra.jpg');
});

test('customer details, Prepaid/COD, tags and courier are saved; members do not get the customer details', () => {
  const { rt, state, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  const cust = { email: 'buyer@example.com', phone: null, customer: { displayName: 'Ravi Kumar' },
    shippingAddress: { name: 'Ravi Kumar', phone: '+919900000000', zip: '110037', city: 'New Delhi', province: 'Delhi' } };
  state.pages = [[
    order(10370, { ...cust, paymentGatewayNames: ['Cash on Delivery (COD)'], displayFinancialStatus: 'PENDING', tags: ['AiSensy_COD_Confirmed', 'Bad Address'] }),
    order(10371, { ...cust, paymentGatewayNames: ['1Razorpay - UPI, Cards, Wallets, NB'], tags: [] }),
  ]];
  assert.equal(rt.call('shopifySyncNow', { token: sue }).added, 2);
  const sh = rt.sheets.get('ShopifyOrders');
  const H = sh.rows[0];
  const col = (r, h) => r[H.indexOf(h)];
  const cod = sh.rows.find((r) => r[1] === '#OD-10370');
  const pre = sh.rows.find((r) => r[1] === '#OD-10371');
  assert.equal(col(cod, 'Payment Mode'), 'COD');
  assert.equal(col(pre, 'Payment Mode'), 'Prepaid');
  assert.equal(col(cod, 'Tags'), 'AiSensy_COD_Confirmed, Bad Address');
  assert.deepEqual(['Customer Name', 'Customer Phone', 'Customer Email', 'Shipping Pincode', 'Shipping City', 'Shipping State'].map((h) => col(cod, h)),
    ['Ravi Kumar', '+919900000000', 'buyer@example.com', '110037', 'New Delhi', 'Delhi']);
  // Shipped later: status, courier and tracking number are updated in place.
  state.pages = [[order(10370, { ...cust, paymentGatewayNames: ['Cash on Delivery (COD)'], displayFinancialStatus: 'PENDING', tags: [],
    displayFulfillmentStatus: 'FULFILLED', updatedAt: '2026-11-28T05:00:00Z', fulfillments: [{ trackingInfo: [{ company: 'Delhivery', number: '3373' }] }] })]];
  const r2 = rt.call('shopifySyncNow', { token: sue, force: true });
  assert.equal(r2.updated, 1);
  const shipped = sh.rows.find((r) => r[1] === '#OD-10370');
  assert.equal(col(shipped, 'Order Status'), 'Fulfilled');
  assert.equal(col(shipped, 'Courier'), 'Delhivery');
  assert.equal(col(shipped, 'Tracking Number'), '3373');
  const pat = login(rt, 'pat@example.com');
  const all = rt.call('getShopifyOrders', { token: pat, status: 'all' });
  assert.equal(all.orders.find((o) => o.orderId === '#OD-10371').paymentMode, 'Prepaid');
  assert.ok(!JSON.stringify(all).match(/Ravi|buyer@|9900000000|110037/), 'the order list for packing carries no customer details');
});

test('without customer data access the orders still arrive, and saved customer details are kept', () => {
  const { rt, state, sue } = setupRuntime();
  rt.call('saveShopifySettings', { token: sue, shop: 'teststore', clientId: 'cid', clientSecret: 'right-secret' });
  rt.call('saveShopifySettings', { token: sue, enabled: true });
  state.pages = [[order(10380, { email: 'a@b.c', shippingAddress: { name: 'A', phone: '1', zip: '400001', city: 'Mumbai', province: 'MH' } })]];
  rt.call('shopifySyncNow', { token: sue });
  state.denyCustomer = true;
  state.pages = [[order(10380, { updatedAt: '2026-11-28T06:00:00Z', displayFinancialStatus: 'REFUNDED' }), order(10381)]];
  const r = rt.call('shopifySyncNow', { token: sue, force: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.customerData, false);
  assert.match(r.note, /not approved to access the Customer/);
  assert.equal(r.added, 1);
  const sh = rt.sheets.get('ShopifyOrders');
  const row = sh.rows.find((x) => x[1] === '#OD-10380');
  assert.equal(row[3], 'REFUNDED');
  assert.equal(row[sh.rows[0].indexOf('Shipping Pincode')], '400001', 'kept');
});
