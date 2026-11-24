'use strict';
// Every future duplicate is stopped on the server, whatever the station does: one video (queue job)
// is uploaded and logged once, and a second video of an order already in Drive is refused unless
// the packer explicitly chose to re-record it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const { fakeDrive } = require('./fake-drive.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const USERS = [1, 2].map((i) => [new Date(), `Packer ${i}`, `p${i}@example.com`, sha('PackerPass1'), 'User', 'Approved']);

function setup() {
  const rt = createRuntime({ users: USERS.map((r) => r.slice()) });
  const drive = fakeDrive();
  drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
  const trashed = [];
  rt.sandbox.DriveApp = new Proxy(drive, {
    get: (t, k) => (k === 'getFileById'
      ? (id) => ({ setTrashed: (v) => v && trashed.push(id), setSharing() {}, getParents: () => ({ hasNext: () => false }) })
      : t[k]),
  });
  const tokens = USERS.map((r) => rt.call('login', { email: r[2], password: 'PackerPass1' }).token);
  const start = (who, job, extra = {}) => rt.call('startUpload', {
    token: tokens[who], orderId: '#OD-9592', platform: 'D2C', recordingType: 'Forward', fileName: 'OD-9592.mp4',
    fileSize: 18 * 1024 * 1024, recordingDate: '2026-11-24', totalChunks: 1, queueJobId: job, ...extra,
  });
  const finish = (who, uploadId, fileId, job) => rt.call('finishUpload', {
    token: tokens[who], uploadId, fileId, orderId: '#OD-9592', platform: 'D2C', recordingType: 'Forward', queueJobId: job,
  });
  const rows = () => rt.sheets.get('OrderLog').rows.filter((r) => r[1] === '#OD-9592');
  return { rt, start, finish, rows, trashed };
}

test('the same packer cannot upload a second video of an order while the first is uploading', () => {
  const { start } = setup();
  const a = start(0, 'job-A');
  assert.equal(a.success, true, a.error);
  const b = start(0, 'job-B'); // the double-click recording
  assert.equal(b.success, false);
  assert.equal(b.code, 'ACTIVE_UPLOAD_IN_PROGRESS');
});

test('a retry of the same video continues instead of being blocked', () => {
  const { start } = setup();
  assert.equal(start(0, 'job-A').success, true);
  const again = start(0, 'job-A');
  assert.equal(again.success, true, again.error);
});

test('two videos of one order finishing in parallel: one row, the extra Drive file is trashed', () => {
  const { start, finish, rows, trashed } = setup();
  const a = start(0, 'job-A');
  const b = start(1, 'job-B', { bypassGlobalQueue: true });
  assert.equal(b.success, false, 'other station is blocked while the order is uploading');
  // Even if a second upload got through (old station code), finishing it does not add a row.
  const fa = finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  assert.equal(fa.fileId, 'FILE_REAL_00001');
  const fb = finish(1, 'unknown-upload', 'FILE_EXTRA_0002', 'job-B');
  assert.equal(fb.success, true);
  assert.equal(fb.duplicateRemoved, true);
  assert.equal(fb.fileId, 'FILE_REAL_00001', 'station is told the kept file');
  assert.equal(rows().length, 1);
  assert.deepEqual(trashed, ['FILE_EXTRA_0002']);
});

test('finishing the same video twice never logs it twice', () => {
  const { start, finish, rows } = setup();
  const a = start(0, 'job-A');
  finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  finish(0, 'other-session', 'FILE_REAL_00001', 'job-A');
  assert.equal(rows().length, 1);
});

test('an uploaded video asked to upload again (even with bypass) gets its existing file back', () => {
  const { start, finish, rows } = setup();
  const a = start(0, 'job-A');
  finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  const again = start(0, 'job-A', { bypassDuplicate: true });
  assert.equal(again.success, false);
  assert.equal(again.alreadyUploaded, true);
  assert.equal(again.existing.fileId, 'FILE_REAL_00001');
  assert.equal(rows().length, 1);
});

test('another station recording the order later is refused; an explicit re-record is allowed', () => {
  const { start, finish, rows } = setup();
  const a = start(0, 'job-A');
  finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  const other = start(1, 'job-C');
  assert.equal(other.code, 'DUPLICATE_ORDER_ID');
  const rerecord = start(1, 'job-D', { bypassDuplicate: true });
  assert.equal(rerecord.success, true, rerecord.error);
  finish(1, rerecord.uploadId, 'FILE_RERECORD_3', 'job-D');
  assert.equal(rows().length, 2, 'explicit re-record keeps both');
});
