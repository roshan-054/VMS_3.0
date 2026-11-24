'use strict';
// Catalog sync from the master "UE" tab: exact tag matching, reliable columns, no silent tab fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const USERS = [[new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved']];

const UE = [
  ['S.No', 'Product Name', 'Seller SKU', 'EAN', 'Product Image', 'Tag', 'Category', 'MRP'],
  [1, 'Steel Bottle 1L', 'BTL-1L', '8901000000011', 'https://drive.google.com/file/d/IMG1/view', 'Active-online', 'Kitchen', 499],
  [2, 'Steel Bottle 500ml', 'BTL-500', '8901000000028', '', 'Inactive-online', 'Kitchen', 399],
  [3, 'Lunch Box', 'LB-3', '8901000000035', '', 'active online', 'Kitchen', 299],
  [4, 'Flask', 'FL-4', '8901000000042', '', 'Offline', 'Kitchen', 899],
  [5, 'Tiffin Set', 'TF-5', '8901000000059', '', 'Active-online, Offline', 'Kitchen', 999],
  [6, 'Untagged Jar', 'JR-6', '8901000000066', '', '', 'Kitchen', 199],
  [7, 'Mug', 'MG-7', 8901000000073, '', 'ACTIVE_ONLINE', 'Kitchen', 149],
];

function setup() {
  const rt = createRuntime({ users: USERS.map((r) => r.slice()) });
  rt.addSheet('UE', UE.map((r) => r.slice()));
  const gt = rt.sheets.get('GTINCatalog');
  gt.rows = [['Timestamp', 'GTIN', 'SKU', 'Product Name', 'Short Name', 'Category', 'Image URL', 'Default Quantity', 'Notes']];
  const token = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}
const skus = (list) => list.map((p) => p.sku).sort();

test('tag filter keeps only exact tag matches (not "Inactive-online", not untagged rows)', () => {
  const { rt, token } = setup();
  const res = rt.call('getGtinCatalog', { token, tabName: 'UE', tags: ['Active-online'] });
  assert.equal(res.success, true, res.error);
  assert.deepEqual(skus(res.catalog), ['BTL-1L', 'LB-3', 'MG-7', 'TF-5']);
  assert.equal(res.totalRows, 7);
  assert.equal(res.tagColumn, 'Tag');
});

test('several tags can be combined', () => {
  const { rt, token } = setup();
  const res = rt.call('getGtinCatalog', { token, tabName: 'UE', tags: ['offline', 'Inactive-online'] });
  assert.deepEqual(skus(res.catalog), ['BTL-500', 'FL-4', 'TF-5']);
});

test('columns are detected by header, not by position', () => {
  const { rt, token } = setup();
  const res = rt.call('getGtinCatalog', { token, tabName: 'UE' });
  assert.deepEqual(res.columns, {
    gtin: 'EAN', sku: 'Seller SKU', tag: 'Tag', image: 'Product Image', name: 'Product Name', category: 'Category', cogs: 'MRP',
  });
  const bottle = res.catalog.find((p) => p.sku === 'BTL-1L');
  assert.equal(bottle.productName, 'Steel Bottle 1L');
  assert.equal(bottle.gtin, '8901000000011');
  assert.equal(bottle.tag, 'Active-online');
  assert.equal(bottle.category, 'Kitchen');
  assert.match(bottle.imageUrl, /IMG1/);
  assert.equal(res.catalog.find((p) => p.sku === 'MG-7').gtin, '8901000000073');
});

test('reports which tags exist so a typo is easy to see', () => {
  const { rt, token } = setup();
  const res = rt.call('getGtinCatalog', { token, tabName: 'UE', tags: ['Actve-online'] });
  assert.equal(res.count, 0);
  const active = res.tagsFound.find((t) => t.tag.toLowerCase().replace(/[^a-z]/g, '') === 'activeonline');
  assert.equal(active.count, 4);
});

test('a missing tab is an error that lists the real tabs (no silent fallback)', () => {
  const { rt, token } = setup();
  const res = rt.call('getGtinCatalog', { token, tabName: 'Master UE', tags: ['Active-online'] });
  assert.equal(res.success, false);
  assert.match(res.error, /"Master UE" was not found/);
  assert.ok(res.tabs.includes('UE'));
  const ext = rt.call('syncExternalGtinSheet', { token, gtinSheetId: 'abc', tabName: 'Wrong' });
  assert.equal(ext.success, false);
  assert.match(ext.error, /not found/);
});

test('tab names match regardless of case and spacing', () => {
  const { rt, token } = setup();
  assert.equal(rt.call('getGtinCatalog', { token, tabName: ' ue ' }).success, true);
});

test('external sync mirrors tags into GTINCatalog in one write, and re-sync updates rows', () => {
  const { rt, token } = setup();
  const res = rt.call('syncExternalGtinSheet', { token, gtinSheetId: 'https://docs.google.com/spreadsheets/d/abcDEF123/edit', tabName: 'UE', tags: ['Active-online'] });
  assert.equal(res.success, true, res.error);
  assert.equal(res.count, 4);
  const gt = rt.sheets.get('GTINCatalog').rows;
  assert.equal(gt[0][9], 'Tag');
  assert.equal(gt.length, 5);
  assert.equal(gt.find((r) => r[2] === 'BTL-1L')[9], 'Active-online');

  rt.call('syncExternalGtinSheet', { token, gtinSheetId: 'abcDEF123', tabName: 'UE', tags: ['Active-online'] });
  assert.equal(rt.sheets.get('GTINCatalog').rows.length, 5, 'no duplicate rows');

  const master = rt.call('getGtinCatalog', { token, tabName: 'GTINCatalog', tags: ['active-online'] });
  assert.deepEqual(skus(master.catalog), ['BTL-1L', 'LB-3', 'MG-7', 'TF-5']);
});

test('older GTINCatalog rows with the tag in Category still match', () => {
  const { rt, token } = setup();
  rt.sheets.get('GTINCatalog').rows.push([new Date(), '111', 'OLD-1', 'Old item', 'Old', 'Active-online', '', 1, '']);
  rt.sheets.get('GTINCatalog').rows.push([new Date(), '222', 'OLD-2', 'Other', 'Other', 'Offline', '', 1, '']);
  const res = rt.call('getGtinCatalog', { token, tags: ['Active-online'] });
  assert.deepEqual(skus(res.catalog), ['OLD-1']);
});

test('filtering a tab without a tag column is refused with a clear message', () => {
  const { rt, token } = setup();
  rt.addSheet('Plain', [['SKU', 'Name'], ['A1', 'Thing']]);
  const res = rt.call('getGtinCatalog', { token, tabName: 'Plain', tags: ['x'] });
  assert.equal(res.success, false);
  assert.match(res.error, /no Tag column/);
});

// Deepak's Master_UE layout: the tag column is headed with a tag value ("Active-online"), not "Tag".
const MASTER_UE = [
  ['Product SKU', 'GTIN Number', 'Product Name', 'Quantity', 'COGS', 'Active-online', 'Image'],
  ['UP-KUM-01', 8906191690025, 'Kumkum Powder', 1, 11.31, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/kumkum.jpg?v=1&width=1946'],
  ['UP-GO-CH-01', 8906191691732, 'Gopi Chandan', 1, 11.31, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/gopi.jpg'],
  ['SHR-AK-02', 8906191690896, 'Akshat pk of 2', 2, 18.42, 'Active-online', 'https://www.paraayan.com/cdn/shop/files/Akshat.png'],
  ['OLD-01', 8906191699999, 'Old Item', 1, 9.5, 'Inactive', ''],
  ['OFF-01', 8906191698888, 'Offline Item', 1, 9.5, 'Offline', ''],
];

test('Master_UE layout: tag column headed "Active-online" is found and filtered exactly', () => {
  const { rt, token } = setup();
  rt.addSheet('Master_UE', MASTER_UE.map((r) => r.slice()));
  const res = rt.call('syncExternalGtinSheet', { token, gtinSheetId: 'masterUE123', tabName: 'Master_UE', tags: ['Active-online'] });
  assert.equal(res.success, true, res.error);
  assert.deepEqual(res.columns, { sku: 'Product SKU', gtin: 'GTIN Number', name: 'Product Name', qty: 'Quantity', cogs: 'COGS', image: 'Image', tag: 'Active-online' });
  assert.equal(res.tagColumn, 'Active-online');
  assert.deepEqual(skus(res.items), ['SHR-AK-02', 'UP-GO-CH-01', 'UP-KUM-01']);
  const ak = res.items.find((p) => p.sku === 'SHR-AK-02');
  assert.equal(ak.gtin, '8906191690896');
  assert.equal(ak.productName, 'Akshat pk of 2');
  assert.equal(ak.defaultQuantity, 2);
  assert.equal(ak.tag, 'Active-online');

  const off = rt.call('syncExternalGtinSheet', { token, gtinSheetId: 'masterUE123', tabName: 'Master_UE', tags: ['Offline'] });
  assert.deepEqual(skus(off.items), ['OFF-01']);
});

test('Master_UE layout where every row is Active-online still finds the tag column', () => {
  const { rt, token } = setup();
  rt.addSheet('Master_UE', MASTER_UE.slice(0, 4).map((r) => r.slice()));
  const res = rt.call('getGtinCatalog', { token, tabName: 'Master_UE', tags: ['Active-online'] });
  assert.equal(res.success, true, res.error);
  assert.equal(res.count, 3);
  assert.equal(res.tagColumn, 'Active-online');
});
