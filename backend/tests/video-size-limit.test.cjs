'use strict';
// Admin "max video size": one central limit (default 1 GB, 0 = no limit) enforced by the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const { fakeDrive } = require('./fake-drive.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const MB = 1024 * 1024;

function setup() {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const drive = fakeDrive();
  rt.sandbox.DriveApp = drive;
  drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  let n = 0;
  const start = (size) => {
    n++;
    return rt.call('startUpload', {
      token: packer, orderId: 'ORD-' + n, platform: 'Amazon', recordingType: 'Forward', fileName: 'ORD-' + n + '_Amazon_Forward.webm',
      fileSize: size, uploadId: 'u' + n, recordingDate: '2026-11-24', totalChunks: 1,
    });
  };
  return { rt, admin, packer, start };
}

test('default limit is 1 GB and is reported by getBranding', () => {
  const { rt, start } = setup();
  assert.equal(rt.call('getBranding', {}).maxVideoSizeMb, 1024);
  assert.notEqual(start(900 * MB).code, 'VIDEO_TOO_LARGE');
  const big = start(1100 * MB);
  assert.equal(big.success, false);
  assert.equal(big.code, 'VIDEO_TOO_LARGE');
  assert.match(big.error, /1024 MB limit/);
});

test('admin can raise the limit or remove it; packers cannot change it', () => {
  const { rt, admin, packer, start } = setup();
  assert.equal(rt.call('saveBranding', { token: packer, maxVideoSizeMb: 0 }).success, false);
  assert.equal(rt.call('getBranding', {}).maxVideoSizeMb, 1024);

  assert.equal(rt.call('saveBranding', { token: admin, maxVideoSizeMb: 2048 }).success, true);
  assert.equal(rt.call('getBranding', {}).maxVideoSizeMb, 2048);
  assert.notEqual(start(1500 * MB).code, 'VIDEO_TOO_LARGE');

  assert.equal(rt.call('saveBranding', { token: admin, maxVideoSizeMb: 0 }).success, true);
  assert.equal(rt.call('getBranding', {}).maxVideoSizeMb, 0);
  assert.notEqual(start(8000 * MB).code, 'VIDEO_TOO_LARGE');
});

test('invalid limits are refused and the old value stays', () => {
  const { rt, admin } = setup();
  assert.equal(rt.call('saveBranding', { token: admin, maxVideoSizeMb: 10 }).success, false);
  assert.equal(rt.call('saveBranding', { token: admin, maxVideoSizeMb: -5 }).success, false);
  assert.equal(rt.call('saveBranding', { token: admin, maxVideoSizeMb: 999999 }).success, false);
  assert.equal(rt.call('getBranding', {}).maxVideoSizeMb, 1024);
});
