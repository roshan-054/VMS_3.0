'use strict';
// Settings > Data & Cleanup is the one duplicate tool. It must:
// - keep the real video, not a near-empty one recorded a moment later (Deepak's #OD-9592:
//   a 17.98 MB video and a 1.4 KB one logged 2 seconds apart),
// - only compare rows inside the same tab (never an OrderLog row against a DownloadLog row),
// - leave DownloadLog / OrderManifest / PackVerificationLog history alone.
// The old cross-tab finder (scanDuplicateRecords / removeDuplicateRecords) is retired.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const HEAD = ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID', 'Video MIME Type', 'Playback Status'];

function setup(rows) {
  const rt = createRuntime({ users: [[new Date(), 'Ada Admin', 'ada@example.com', sha('AdminPass1'), 'Super Admin', 'Approved']] });
  rt.sandbox.setupSystem();
  rt.sheets.get('OrderLog').rows = [HEAD, ...rows];
  const token = rt.call('login', { email: 'ada@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}
const row = (ts, fid, size, order = '#OD-9592') => [new Date(ts), order, 'D2C', 'vineet@vms.com', fid, `https://drive.google.com/file/d/${fid}/preview`, size, 'Completed', 'Forward', 'job-' + fid, 'video/mp4', 'READY'];
const fileIds = (rt) => rt.sheets.get('OrderLog').rows.slice(1).map((r) => r[4]);

test('keeps the 17.98 MB video and removes the 1.4 KB one logged after it', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_REAL_0000001', '17.98 MB'), row('2026-11-23T17:25:13', 'FILE_TINY_0000002', '1.4 KB')]);
  const scan = rt.call('scanSheetCleanup', { token });
  assert.equal(scan.totalDuplicates, 1, scan.message);
  const res = rt.call('runSheetCleanup', { token });
  assert.equal(res.success, true, res.error);
  assert.deepEqual(fileIds(rt), ['FILE_REAL_0000001']);
});

test('two real videos: keeps the latest', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_A_000000001', '17.98 MB'), row('2026-11-23T17:40:00', 'FILE_B_000000002', '20.1 MB')]);
  rt.call('runSheetCleanup', { token });
  assert.deepEqual(fileIds(rt), ['FILE_B_000000002']);
});

test('the same order in OrderLog and DownloadLog (downloaded twice) is not a duplicate', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_REAL_0000001', '44 MB')]);
  const t = new Date('2026-11-23T17:30:00');
  const dl = rt.sheets.get('DownloadLog');
  dl.rows.push([t, '#OD-9592', 'D2C', 'v@vms.com', 'OD-9592_D2C_Forward.mp4', '44 MB', 'Download', 'Forward'],
    [new Date(t.getTime() + 60000), '#OD-9592', 'D2C', 'v@vms.com', 'OD-9592_D2C_Forward.mp4', '44 MB', 'Download', 'Forward']);
  const before = dl.rows.length;
  const scan = rt.call('scanSheetCleanup', { token });
  assert.equal(scan.totalRemove, 0, scan.message);
  rt.call('runSheetCleanup', { token });
  assert.equal(dl.rows.length, before, 'download history kept');
  assert.deepEqual(fileIds(rt), ['FILE_REAL_0000001']);
});

test('the old cross-tab finder is retired and changes nothing', () => {
  const { rt, token } = setup([row('2026-11-23T17:25:11', 'FILE_A_000000001', '17.98 MB'), row('2026-11-23T17:40:00', 'FILE_B_000000002', '20.1 MB')]);
  for (const a of ['scanDuplicates', 'scanDuplicateRecords', 'cleanDuplicates', 'removeDuplicates', 'removeDuplicateRecords']) {
    const r = rt.call(a, { token });
    assert.equal(r.success, false, a);
    assert.match(r.error, /Data & Cleanup/, a);
  }
  assert.equal(rt.sheets.get('OrderLog').rows.length, 3);
});
