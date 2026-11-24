'use strict';
// Live station queues: packers report their upload queue; admins read all stations.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function setup() {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Vineet', 'vineet@vms.com', sha('PackerPass1'), 'User', 'Approved'],
    [new Date(), 'Ravi', 'ravi@vms.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const tok = (e, p) => rt.call('login', { email: e, password: p }).token;
  return { rt, admin: tok('alice@example.com', 'AdminPass1'), vineet: tok('vineet@vms.com', 'PackerPass1'), ravi: tok('ravi@vms.com', 'PackerPass1') };
}

test('admin sees each packer station queue with status, progress and errors', () => {
  const { rt, admin, vineet, ravi } = setup();
  assert.equal(rt.call('reportStationQueue', { token: vineet, recording: true, items: [
    { id: 'j1', orderId: 'OD-9601', platform: 'D2C', recordingType: 'Return', status: 'uploading', progress: 40, stage: 'Uploading chunk 2 of 5', fileSize: 30e6, blob: 'x'.repeat(1000) },
    { id: 'j2', orderId: 'OD-9603', status: 'failed', error: 'Request timed out', progress: 0 },
    { id: 'j3', orderId: 'OD-9606', status: 'pending' },
  ] }).success, true);
  rt.call('reportStationQueue', { token: ravi, items: [] });
  const res = rt.call('getStationQueues', { token: admin });
  assert.equal(res.success, true);
  assert.equal(res.stations.length, 2);
  const v = res.stations.find((s) => s.email === 'vineet@vms.com');
  assert.equal(v.live, true);
  assert.equal(v.recording, true);
  assert.equal(v.items.length, 3);
  assert.equal(v.items[0].progress, 40);
  assert.equal(v.items[1].error, 'Request timed out');
  assert.equal(v.items[0].blob, undefined, 'video data is never stored');
  assert.deepEqual(res.totals, { uploading: 1, pending: 1, failed: 1, completed: 0 });
});

test('a new report replaces the previous report; packers cannot read other stations', () => {
  const { rt, admin, vineet } = setup();
  rt.call('reportStationQueue', { token: vineet, items: [{ id: 'j1', status: 'uploading', progress: 10 }] });
  rt.call('reportStationQueue', { token: vineet, items: [{ id: 'j1', status: 'completed', progress: 100 }] });
  const v = rt.call('getStationQueues', { token: admin }).stations[0];
  assert.equal(v.items.length, 1);
  assert.equal(v.items[0].status, 'completed');
  assert.equal(rt.call('getStationQueues', { token: vineet }).success, false);
  assert.equal(rt.call('reportStationQueue', { items: [] }).success, false);
});
