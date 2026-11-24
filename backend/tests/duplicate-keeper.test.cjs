'use strict';
// Clean Duplicates must keep the real video, not a near-empty one recorded a moment later
// (Deepak's #OD-9592: a 17.98 MB video and a 1.4 KB one logged 2 seconds apart).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const HEAD = ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID'];

function setup(rows) {
  const rt = createRuntime({ users: [[new Date(), 'Ada Admin', 'ada@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  rt.sheets.get('OrderLog').rows = [HEAD, ...rows];
  const token = rt.call('login', { email: 'ada@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}
const row = (ts, fid, size) => [new Date(ts), '#OD-9592', 'D2C', 'vineet@vms.com', fid, `https://drive.google.com/file/d/${fid}/preview`, size, 'Completed', 'Forward', 'job-' + fid];

test('keeps the 17.98 MB video and removes the 1.4 KB one logged after it', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_REAL_0000001', '17.98 MB'), row('2026-11-23T17:25:13', 'FILE_TINY_0000002', '1.4 KB')]);
  const res = rt.call('scanDuplicateRecords', { token });
  assert.equal(res.success, true, res.error);
  const g = res.groups.find((x) => x.orderId === '#OD-9592');
  assert.ok(g, 'duplicate group found');
  assert.equal(g.keeper.fileId, 'FILE_REAL_0000001');
  assert.deepEqual(g.duplicates.map((d) => d.fileId), ['FILE_TINY_0000002']);
});

test('two real videos: still keeps the latest, as before', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_A_000000001', '17.98 MB'), row('2026-11-23T17:40:00', 'FILE_B_000000002', '20.1 MB')]);
  const g = rt.call('scanDuplicateRecords', { token }).groups.find((x) => x.orderId === '#OD-9592');
  assert.equal(g.keeper.fileId, 'FILE_B_000000002');
});
