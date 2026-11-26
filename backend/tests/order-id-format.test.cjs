'use strict';
// D2C order IDs are always "#OD-10063": one '#', no spaces. Same order in any format = same order.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  const token = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}

test('canonicalOrderId_ gives D2C orders exactly one # and removes every space', () => {
  const { rt } = setup();
  const c = rt.sandbox.canonicalOrderId_;
  assert.equal(c('OD-10063', 'D2C'), '#OD-10063');
  assert.equal(c('#OD-10063', 'D2C'), '#OD-10063');
  assert.equal(c('##OD-10063', 'D2C'), '#OD-10063');
  assert.equal(c('  # OD - 10063 ', 'D2C'), '#OD-10063');
  assert.equal(c('od-10063', 'd2c'), '#OD-10063');
  assert.equal(c('##OD-10063', ''), '#OD-10063'); // unknown platform: an OD- order is D2C
  assert.equal(c(' 402-1234567-1234567 ', 'Amazon'), '402-1234567-1234567');
  assert.equal(c('##ABC 1', 'JioMart'), '#ABC1');
  assert.equal(c('', 'D2C'), '');
  assert.equal(c('##', 'D2C'), '');
});

test('normalizeOrderId_ treats #, ## and spaces as the same order', () => {
  const { rt } = setup();
  const n = rt.sandbox.normalizeOrderId_;
  assert.equal(n('##OD-10063'), n('OD-10063'));
  assert.equal(n(' # OD-10063'), n('OD-10063'));
});

test('saving an order with ## or spaces stores #OD-10063 and updates the same row', () => {
  const { rt, token } = setup();
  const items = [{ productName: 'Soap', sku: 'S1', gtin: '890', quantity: 2 }];
  rt.call('saveOrderManifest', { token, manifest: { orderId: '##OD-10063 ', platform: 'D2C', items } });
  rt.call('saveOrderManifest', { token, manifest: { orderId: 'OD-10063', platform: 'D2C', items, assignedPackerName: 'Vineet' } });
  const rows = rt.sheets.get('OrderManifest').rows;
  assert.equal(rows.length, 2, 'one header + one order row');
  assert.equal(rows[1][1], '#OD-10063');
  assert.equal(rows[1][3], 'Vineet');
});

test('product items show for an order saved earlier without # (older rows)', () => {
  const { rt, token } = setup();
  const sh = rt.sheets.get('OrderManifest');
  // An old row with the items, and a second old row for the same order without items.
  sh.rows.push([new Date(), 'OD-10063', 'D2C', 'Vineet', 'v@x.com', '', '', 2, 'Soap [S1] x 2', 'Pending', '', '', '', '']);
  sh.rows.push([new Date(), '#OD-10063', 'D2C', '', '', '', '', 0, '', 'Packed', '', '', 'Vineet', 'https://drive/x']);
  const res = rt.call('getOrderManifests', { token });
  assert.equal(res.manifests.length, 1);
  const m = res.manifests[0];
  assert.equal(m.orderId, '#OD-10063');
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].sku, 'S1');
  assert.equal(m.status, 'Packed');
  assert.equal(m.videoDriveUrl, 'https://drive/x');

  // Status updates find the row with the items whatever format the caller uses.
  const up = rt.call('updateManifestStatus', { token, orderId: '#OD-10063', status: 'Packed' });
  assert.equal(up.success, true);
  assert.equal(sh.rows[1][9], 'Packed');
});

test('pack verification and download logs store the standard format', () => {
  const { rt, token } = setup();
  rt.call('logPackVerification', { token, log: { orderId: ' ##OD-5 ', platform: 'D2C' } });
  assert.equal(rt.sheets.get('PackVerificationLog').rows[1][1], '#OD-5');
  rt.call('downloadLog', { token, orderId: 'OD-6', platform: 'D2C' });
  assert.equal(rt.sheets.get('DownloadLog').rows[1][1], '#OD-6');
});

test('Fix order ID format rewrites only the Order ID cells and never removes rows', () => {
  const { rt, token } = setup();
  const log = rt.sheets.get('OrderLog');
  const d = new Date('2026-11-26T10:00:00Z');
  log.rows.push([d, 'OD-1', 'D2C', 'p@x.com', 'f1', 'u1', '', 'Completed', 'Forward']);
  log.rows.push([d, '##OD-2', 'D2C', 'p@x.com', 'f2', 'u2', '', 'Completed', 'Forward']);
  log.rows.push([d, '#OD-3', 'D2C', 'p@x.com', 'f3', 'u3', '', 'Completed', 'Forward']);
  log.rows.push([d, ' 402-1 ', 'Amazon', 'p@x.com', 'f4', 'u4', '', 'Completed', 'Forward']);
  const man = rt.sheets.get('OrderManifest');
  man.rows.push([d, ' od-9 ', 'D2C', '', '', '', '', 1, 'Soap [S1] x 1', 'Pending', '', '', '', '']);

  const scan = rt.call('scanOrderIdFormat', { token });
  assert.equal(scan.success, true);
  assert.equal(scan.total, 4);
  assert.equal(log.rows[1][1], 'OD-1', 'scan changes nothing');

  const before = log.rows.length;
  const res = rt.call('fixOrderIdFormat', { token });
  assert.equal(res.success, true);
  assert.equal(res.fixed, 4);
  assert.equal(log.rows.length, before);
  assert.deepEqual(log.rows.slice(1).map((r) => r[1]), ['#OD-1', '#OD-2', '#OD-3', '402-1']);
  assert.equal(log.rows[1][4], 'f1', 'other cells untouched');
  assert.equal(man.rows[1][1], '#OD-9');
  assert.equal(rt.call('scanOrderIdFormat', { token }).total, 0);
});

test('only administrators can run the order ID fix', () => {
  const rt = createRuntime({ users: [[new Date(), 'Bob', 'bob@example.com', sha('UserPass1'), 'User', 'Approved']] });
  const token = rt.call('login', { email: 'bob@example.com', password: 'UserPass1' }).token;
  const res = rt.call('fixOrderIdFormat', { token });
  assert.equal(res.success, false);
});
