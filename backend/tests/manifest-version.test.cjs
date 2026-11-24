'use strict';
// Stations poll the order list cheaply: "unchanged" unless something was written since their last read.
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

test('a poll with the current stamp gets "unchanged" without the order list', () => {
  const { rt, token } = setup();
  rt.call('saveOrderManifest', { token, manifest: { orderId: 'A-1', platform: 'Amazon', items: [] } });
  const full = rt.call('getOrderManifests', { token });
  assert.equal(full.manifests.length, 1);
  assert.ok(full.version);
  const again = rt.call('getOrderManifests', { token, sinceVersion: full.version });
  assert.equal(again.unchanged, true);
  assert.equal(again.manifests, undefined);
});

test('any manifest write changes the stamp, so the next poll gets the new list', () => {
  const { rt, token } = setup();
  const v0 = rt.call('getOrderManifests', { token }).version;
  rt.call('saveOrderManifest', { token, manifest: { orderId: 'B-1', platform: 'Amazon', items: [] } });
  const r1 = rt.call('getOrderManifests', { token, sinceVersion: v0 });
  assert.equal(r1.unchanged, undefined);
  assert.equal(r1.manifests.length, 1);

  for (const [action, payload] of [
    ['updateManifestStatus', { orderId: 'B-1', status: 'Packed' }],
    ['saveOrderManifestsBatch', { manifests: [{ orderId: 'B-2', platform: 'Amazon', items: [] }] }],
    ['deleteOrderManifest', { orderId: 'B-2' }],
  ]) {
    const before = rt.call('getOrderManifests', { token }).version;
    rt.call(action, { token, ...payload });
    assert.notEqual(rt.call('getOrderManifests', { token, sinceVersion: before }).unchanged, true, `${action} must change the stamp`);
  }
});

test('a failed write does not change the stamp', () => {
  const { rt, token } = setup();
  const v = rt.call('getOrderManifests', { token }).version;
  rt.call('saveOrderManifest', { token, manifest: {} });
  assert.equal(rt.call('getOrderManifests', { token, sinceVersion: v }).unchanged, true);
});
