'use strict';
// Admin "Drive storage" card: account quota plus the space VMS videos take.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const { fakeDrive } = require('./fake-drive.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const HDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const GB = 1073741824;

function setup({ used = 5 * GB, limit = 15 * GB } = {}) {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const drive = fakeDrive();
  drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'VMS Videos');
  drive.getStorageUsed = () => used;
  drive.getStorageLimit = () => limit;
  rt.sandbox.DriveApp = drive;
  const now = new Date();
  const old = new Date(now.getTime() - 60 * 86400000);
  rt.addSheet('OrderLog', [HDR,
    [now, '#A1', 'Amazon', 'pat@example.com', 'f1', '', '100.00 MB', 'Completed', 'Forward', 'q1', 'video/mp4', 'READY'],
    [now, '#A2', 'Flipkart', 'pat@example.com', 'f2', '', '50.00 MB', 'Completed', 'Forward', 'q2', 'video/mp4', 'READY'],
    [old, '#A3', 'Amazon', 'pat@example.com', 'f3', '', '1.00 GB', 'Completed', 'Forward', 'q3', 'video/mp4', 'READY'],
    [now, '#A4', 'Amazon', 'pat@example.com', '', '', '', 'Failed', 'Forward', 'q4', 'video/mp4', ''],
  ]);
  rt.addSheet('ReturnLog', [HDR,
    [now, '#R1', 'Amazon', 'pat@example.com', 'f5', '', '10.00 MB', 'Completed', 'Return', 'q5', 'video/mp4', 'READY'],
  ]);
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, admin, packer };
}

test('reports account quota and VMS video space', () => {
  const { rt, admin } = setup();
  const r = rt.call('getDriveStorage', { token: admin });
  assert.equal(r.success, true, r.error);
  assert.equal(r.account.used, 5 * GB);
  assert.equal(r.account.limit, 15 * GB);
  assert.equal(r.account.free, 10 * GB);
  assert.equal(r.account.percent, 33.3);
  assert.equal(r.videos.count, 4, 'rows without a Drive file are not counted');
  assert.equal(r.videos.bytes, (160 + 1024) * 1048576);
  assert.equal(r.videos.monthBytes, 160 * 1048576);
  assert.equal(r.byPlatform[0].platform, 'Amazon');
  assert.equal(r.folder.name, 'VMS Videos');
  assert.ok(r.daysLeft > 0);
});

test('is cached, and refresh recomputes', () => {
  const { rt, admin } = setup();
  rt.call('getDriveStorage', { token: admin });
  rt.sandbox.DriveApp.getStorageUsed = () => 6 * GB;
  assert.equal(rt.call('getDriveStorage', { token: admin }).cached, true);
  const fresh = rt.call('getDriveStorage', { token: admin, refresh: true });
  assert.equal(fresh.cached, false);
  assert.equal(fresh.account.used, 6 * GB);
});

test('unlimited or pooled storage is shown as no limit', () => {
  const { rt, admin } = setup({ limit: 0 });
  const r = rt.call('getDriveStorage', { token: admin });
  assert.equal(r.account.unlimited, true);
  assert.equal(r.account.limit, -1);
  assert.equal(r.daysLeft, -1);
});

test('only admins can see it', () => {
  const { rt, packer } = setup();
  const r = rt.call('getDriveStorage', { token: packer });
  assert.notEqual(r.success, true);
});
