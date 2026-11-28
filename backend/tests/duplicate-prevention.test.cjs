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
  assert.equal(rows().length, 1, 'a re-record never leaves two videos of one order');
});

// #OD-10088 (26-Nov-26): a 959.1 KB video was uploaded, then the full 81.94 MB recording of the
// same order, waiting in the queue, was uploaded a day later from another login with the duplicate
// check skipped. Both stayed in Drive and the order showed twice in UploadLog.
function od10088() {
  const t = setup();
  const uploadRows = () => t.rt.sheets.get('UploadLog').rows.filter((r) => r[1] === '#OD-9592');
  const startSized = (who, job, bytes, extra = {}) => t.start(who, job, { fileSize: bytes, ...extra });
  return { ...t, uploadRows, startSized };
}

test('#OD-10088: a bigger video uploaded later with bypass replaces the small one (one row, small file trashed)', () => {
  const { startSized, finish, rows, uploadRows, trashed } = od10088();
  const a = startSized(0, 'job-small', 982118);
  finish(0, a.uploadId, 'FILE_SMALL_0001', 'job-small');
  const b = startSized(1, 'job-full', 85917450, { bypassDuplicate: true });
  assert.equal(b.success, true, b.error);
  const fb = finish(1, b.uploadId, 'FILE_FULL_00002', 'job-full');
  assert.equal(fb.fileId, 'FILE_FULL_00002');
  assert.equal(fb.replacedOlderVideo, true);
  assert.equal(rows().length, 1, 'one OrderLog row');
  assert.equal(rows()[0][4], 'FILE_FULL_00002');
  assert.equal(uploadRows().length, 1, 'one UploadLog row');
  assert.equal(uploadRows()[0][9], 'FILE_FULL_00002');
  assert.equal(uploadRows()[0][10], 'Completed');
  assert.deepEqual(trashed, ['FILE_SMALL_0001']);
});

test('a smaller video uploaded later with bypass is dropped; the bigger one stays', () => {
  const { startSized, finish, rows, uploadRows, trashed } = od10088();
  const a = startSized(0, 'job-full', 85917450);
  finish(0, a.uploadId, 'FILE_FULL_00001', 'job-full');
  const b = startSized(1, 'job-small', 982118, { bypassDuplicate: true });
  assert.equal(b.success, true, b.error);
  const fb = finish(1, b.uploadId, 'FILE_SMALL_0002', 'job-small');
  assert.equal(fb.duplicateRemoved, true);
  assert.equal(fb.fileId, 'FILE_FULL_00001', 'station is told the kept file');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0][4], 'FILE_FULL_00001');
  assert.equal(uploadRows().length, 1);
  assert.equal(uploadRows()[0][9], 'FILE_FULL_00001');
  assert.deepEqual(trashed, ['FILE_SMALL_0002']);
});

test('without bypass a second video of an uploaded order is still refused at start', () => {
  const { startSized, finish } = od10088();
  const a = startSized(0, 'job-small', 982118);
  finish(0, a.uploadId, 'FILE_SMALL_0001', 'job-small');
  const b = startSized(1, 'job-full', 85917450);
  assert.equal(b.success, false);
  assert.equal(b.code, 'DUPLICATE_ORDER_ID');
});

test('Forward and Return videos of one order are both kept', () => {
  const { rt, start, finish, trashed } = od10088();
  const a = start(0, 'job-F');
  finish(0, a.uploadId, 'FILE_FORWARD_01', 'job-F');
  const r = start(1, 'job-R', { recordingType: 'Return' });
  assert.equal(r.success, true, r.error);
  rt.call('finishUpload', { token: rt.call('login', { email: 'p2@example.com', password: 'PackerPass1' }).token,
    uploadId: r.uploadId, fileId: 'FILE_RETURN_002', orderId: '#OD-9592', platform: 'D2C', recordingType: 'Return', queueJobId: 'job-R' });
  assert.equal(rt.sheets.get('OrderLog').rows.filter((x) => x[1] === '#OD-9592').length, 1);
  assert.equal(rt.sheets.get('ReturnLog').rows.filter((x) => x[1] === '#OD-9592').length, 1);
  assert.deepEqual(trashed, []);
});

test('duplicate check on a big sheet finds the order and reads only the Order ID column plus matches', () => {
  const { rt, start, finish } = setup();
  const ol = rt.sheets.get('OrderLog');
  for (let i = 0; i < 20000; i++) ol.rows.push([new Date(), `#OD-${100000 + i}`, 'D2C', 'p1@example.com', `FILEID_${i}_xxxxxxxx`, '', '1 MB', 'Completed', 'Forward', `job-${i}`, 'video/mp4', 'READY']);
  const a = start(0, 'job-A');
  finish(0, a.uploadId, 'FILE_REAL_00001', 'job-A');
  const tok = rt.call('login', { email: 'p2@example.com', password: 'PackerPass1' }).token;
  const t0 = Date.now();
  const hit = rt.call('checkDuplicateOrder', { token: tok, orderId: 'OD-9592', platform: 'D2C', recordingType: 'Forward' });
  const miss = rt.call('checkDuplicateOrder', { token: tok, orderId: '#OD-777777', platform: 'D2C', recordingType: 'Forward' });
  const old = rt.call('checkDuplicateOrder', { token: tok, orderId: '#OD-100005', platform: 'D2C', recordingType: 'Forward' });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(hit.isDuplicate, true);
  assert.equal(hit.existing.fileId, 'FILE_REAL_00001');
  assert.equal(hit.existing.queueJobId, 'job-A');
  assert.equal(miss.isDuplicate, false);
  assert.equal(old.existing.fileId, 'FILEID_5_xxxxxxxx');
  assert.equal(old.existing.row, 7, 'row number points at the sheet row');
});
