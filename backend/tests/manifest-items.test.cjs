'use strict';
// An order's products must all reach the app, however the Items List cell or the rows were written.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  const token = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  rt.call('getOrderManifests', { token }); // creates the OrderManifest tab
  return { rt, token, sheet: () => rt.sheets.get('OrderManifest') };
}
const row = (id, items, status = 'Pending') =>
  ['27-Nov-2026 10:00:00', id, 'D2C', 'Vineet', 'vineet@vms.com', '', '', '', items, status, '', '', '', ''];
const find = (res, id) => res.manifests.find((m) => m.orderId === id);
const names = (m) => m.items.map((it) => `${it.productName}|${it.sku}|${it.quantity}`);

test('two products saved from the app come back as two products', () => {
  const { rt, token } = setup();
  rt.call('saveOrderManifest', { token, manifest: { orderId: 'OD-7083', platform: 'D2C', items: [
    { productName: 'Sindoor', sku: 'UP-SI-SI-MA-KAM-0101', quantity: 1 },
    { productName: 'Kumkum', sku: 'UP-KU-0202', quantity: 2 },
  ] } });
  const m = find(rt.call('getOrderManifests', { token }), '#OD-7083');
  assert.deepEqual(names(m), ['Sindoor|UP-SI-SI-MA-KAM-0101|1', 'Kumkum|UP-KU-0202|2']);
});

test('the same order in two rows (one product each) shows both products', () => {
  const { rt, token, sheet } = setup();
  sheet().appendRow(row('#OD-7083', 'Sindoor [UP-SI-SI-MA-KAM-0101] x 1'));
  sheet().appendRow(row('OD-7083', 'Kajal [UP-KA-0303] x 1'));
  const res = rt.call('getOrderManifests', { token });
  assert.equal(res.manifests.length, 1);
  assert.deepEqual(names(find(res, '#OD-7083')), ['Sindoor|UP-SI-SI-MA-KAM-0101|1', 'Kajal|UP-KA-0303|1']);
  assert.equal(new Set(find(res, '#OD-7083').items.map((i) => i.id)).size, 2, 'unique item ids');
});

test('a row written twice with the same product does not double the product', () => {
  const { rt, token, sheet } = setup();
  sheet().appendRow(row('#OD-1', 'Sindoor [S1] x 1; Kajal [K1] x 2'));
  sheet().appendRow(row('#OD-1', 'Sindoor [S1] x 1; Kajal [K1] x 2'));
  assert.deepEqual(names(find(rt.call('getOrderManifests', { token }), '#OD-1')), ['Sindoor|S1|1', 'Kajal|K1|2']);
});

test('products typed into the Sheet on separate lines, or with | or , are all read', () => {
  const { rt, token, sheet } = setup();
  sheet().appendRow(row('#OD-2', 'Sindoor [S1] x 1\nKajal [K1] x 2'));
  sheet().appendRow(row('#OD-3', 'Sindoor [S1] x 1 | Kajal [K1] x 2'));
  sheet().appendRow(row('#OD-4', 'Sindoor [S1] x 1, Kajal [K1] x 2'));
  sheet().appendRow(row('#OD-5', 'Sindoor, Red [S1] x 1')); // a comma inside a name is not a separator
  const res = rt.call('getOrderManifests', { token });
  for (const id of ['#OD-2', '#OD-3', '#OD-4']) assert.deepEqual(names(find(res, id)), ['Sindoor|S1|1', 'Kajal|K1|2'], id);
  assert.deepEqual(names(find(res, '#OD-5')), ['Sindoor, Red|S1|1']);
});

test('saving the order again keeps the old rows but stops them adding back removed products', () => {
  const { rt, token, sheet } = setup();
  sheet().appendRow(row('#OD-6', 'Sindoor [S1] x 1'));
  sheet().appendRow(row('OD-6', 'Kajal [K1] x 1'));
  const before = sheet().rows.length;
  // The admin edits the order in the app and keeps only Kajal.
  rt.call('saveOrderManifest', { token, manifest: { orderId: '#OD-6', platform: 'D2C', items: [{ productName: 'Kajal', sku: 'K1', quantity: 1 }] } });
  assert.equal(sheet().rows.length, before, 'no row deleted or added');
  assert.deepEqual(names(find(rt.call('getOrderManifests', { token }), '#OD-6')), ['Kajal|K1|1']);
});

test('packing an order with both products writes both into the sheet', () => {
  const { rt, token, sheet } = setup();
  sheet().appendRow(row('#OD-8', 'Sindoor [S1] x 1'));
  sheet().appendRow(row('#OD-8', 'Kajal [K1] x 1'));
  const m = find(rt.call('getOrderManifests', { token }), '#OD-8');
  rt.call('updateManifestStatus', { token, orderId: '#OD-8', status: 'Packed', items: m.items });
  assert.deepEqual(names(find(rt.call('getOrderManifests', { token }), '#OD-8')), ['Sindoor|S1|1', 'Kajal|K1|1']);
  assert.equal(sheet().rows.length, 3);
});
