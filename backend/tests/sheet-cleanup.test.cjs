'use strict';
// Settings > Sheet cleanup: removes duplicate and unusable rows, keeps one good row per recording,
// copies every removed row to an Archive tab first, and never touches recent rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const OHDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const UHDR = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
const fid = (s) => 'FILE_' + s + '_abcdefghijklmnop';
const day = 86400000;

function setup() {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const t = new Date(Date.now() - 30 * day);
  const t2 = new Date(Date.now() - 30 * day + 60000);
  const now = new Date(Date.now() - 600000); // 10 minutes ago
  const up = (ts, order, file, progress, status, type = 'Forward', size = '44.28 MB') =>
    [ts, order, 'D2C', 'v@vms.com', order.slice(1) + '_D2C_' + type + '.mp4', size, 'u' + Math.random(), 'Uploaded to Google Drive', progress, file, status, '', type, 'Station', ''];
  const uploads = [UHDR,
    up(t, '#OD-6831', fid('a1'), 100, 'Completed'),      // row 2: matches OrderLog -> keep
    up(t, '#OD-5904', fid('b1'), 0, 'Completed', 'Return'), // row 3
    up(t2, '#OD-6831', fid('a2'), 100, 'Completed'),     // row 4: extra copy
    up(t2, '#OD-6831', fid('a1'), 0, 'Completed'),       // row 5: same file, progress 0
    up(t2, '#OD-6831', fid('a3'), 100, 'Completed'),     // row 6: extra copy
    up(t2, '#OD-5904', fid('b2'), 100, 'Completed', 'Return'), // row 7: better than row 3
    up(t, '#OD-7000', '', 0, 'Failed'),                  // row 8: unfinished, no video
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // row 9: empty
    up(t, '#OD-7100', fid('c1'), 100, 'Completed'),      // row 10: unique
    up(t, '#OD-6831', fid('r1'), 100, 'Completed', 'Return'), // row 11: other type, unique
    up(now, '#OD-8000', fid('n1'), 100, 'Completed'),    // row 12: recent
    up(now, '#OD-8000', fid('n2'), 100, 'Completed'),    // row 13: recent duplicate, left alone
    up(now, '#OD-8001', '', 0, 'Started'),               // row 14: recent upload in progress
  ];
  const orders = [OHDR,
    [t, '#OD-6831', 'D2C', 'v@vms.com', fid('a1'), '', '44.28 MB', 'Completed', 'Forward', '', 'video/mp4', 'READY'],
    [t2, '#OD-6831', 'D2C', 'v@vms.com', fid('a1'), '', '44.28 MB', 'Completed', 'Forward', '', 'video/mp4', 'READY'],
    [t, '#OD-7100', 'D2C', 'v@vms.com', fid('c1'), '', '44.28 MB', 'Completed', 'Forward', '', 'video/mp4', 'READY'],
  ];
  rt.addSheet('OrderLog', orders);
  rt.addSheet('UploadLog', uploads);
  rt.addSheet('ReturnLog', [OHDR, [t2, '#OD-5904', 'D2C', 'v@vms.com', fid('b2'), '', '', 'Completed', 'Return', '', '', '']]);
  const trashed = [];
  rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
  rt.sandbox.UrlFetchApp = { fetchAll: (reqs) => reqs.map((r) => { trashed.push(decodeURIComponent(r.url.match(/files\/([^?]+)/)[1])); return { getResponseCode: () => 200, getContentText: () => '{}' }; }) };
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, admin, packer, trashed, uploads: uploads.map((r) => r.slice()), orders };
}
const col = (rt, sheet, c) => rt.sheets.get(sheet).rows.slice(1).map((r) => r[c]);

test('scan only reports; counts duplicates, unusable rows and extra video copies', () => {
  const { rt, admin } = setup();
  const before = rt.sheets.get('UploadLog').rows.length;
  const r = rt.call('scanSheetCleanup', { token: admin });
  assert.equal(r.success, true);
  const u = r.sheets.find((s) => s.name === 'UploadLog');
  assert.equal(u.duplicates, 4, 'rows 3,4,5,6');
  assert.equal(u.unusable, 2, 'failed upload + empty row');
  assert.equal(r.sheets.find((s) => s.name === 'OrderLog').duplicates, 1);
  assert.equal(r.totalRemove, 7);
  assert.equal(r.extraVideos, 3, 'a2, a3 and b1 are copies nobody keeps');
  assert.equal(rt.sheets.get('UploadLog').rows.length, before, 'scan changes nothing');
});

test('run keeps one good row per recording, archives removed rows, leaves recent rows', () => {
  const { rt, admin, uploads, trashed } = setup();
  const r = rt.call('runSheetCleanup', { token: admin });
  assert.equal(r.success, true);
  assert.equal(r.done, true);
  assert.equal(r.removedRowsCount, 7);
  assert.equal(r.archivedRowsCount, 7);
  assert.deepEqual(trashed, [], 'videos untouched unless asked');
  const ids = col(rt, 'UploadLog', 9);
  assert.deepEqual(ids, [fid('a1'), fid('b2'), fid('c1'), fid('r1'), fid('n1'), fid('n2'), ''],
    'kept the OrderLog video at 100%, the better Return row, unique rows and all recent rows');
  assert.equal(col(rt, 'UploadLog', 8)[0], 100);
  assert.equal(rt.sheets.get('OrderLog').rows.length, 3);
  const arch = rt.sheets.get('UploadLog Archive').rows;
  assert.deepEqual(arch[0].slice(0, 3), ['Archived At', 'Reason', 'Timestamp']);
  assert.equal(arch.length, 1 + 6);
  const archivedIds = arch.slice(1).map((x) => x[2 + 9]).sort();
  assert.deepEqual(archivedIds, ['', '', fid('a1'), fid('a2'), fid('a3'), fid('b1')].sort());
  const full = arch.slice(1).find((x) => x[2 + 9] === fid('a2'));
  assert.deepEqual(full.slice(2), uploads[3], 'whole original row copied');
  assert.ok(rt.sheets.get('OrderLog Archive').rows.length === 2);
  const again = rt.call('scanSheetCleanup', { token: admin });
  assert.equal(again.totalRemove, 0, 'nothing left');
});

test('extra video copies go to Drive Trash only when asked, never a kept video', () => {
  const { rt, admin, trashed } = setup();
  const r = rt.call('runSheetCleanup', { token: admin, trashExtraVideos: true });
  assert.equal(r.videosTrashedCount, 3);
  assert.deepEqual(trashed.sort(), [fid('a2'), fid('a3'), fid('b1')].sort());
});

test('works in rounds when time runs out', () => {
  const { rt, admin } = setup();
  let rounds = 0, total = 0, last;
  do { last = rt.call("runSheetCleanup", { token: admin, budgetMs: 0 }); rounds++; total += last.removedRowsCount; } while (last.done === false && rounds < 20);
  assert.equal(last.done, true);
  assert.ok(rounds === 3, 'needed more than one round');
  assert.equal(total, 7);
  assert.equal(rt.sheets.get('UploadLog Archive').rows.length, 7, 'each row archived once');
});

test('admins only', () => {
  const { rt, packer } = setup();
  assert.equal(rt.call('scanSheetCleanup', { token: packer }).success, false);
  assert.equal(rt.call('runSheetCleanup', { token: packer }).success, false);
});

test('live progress reports videos moved and rows removed (admin only)', () => {
  const { rt, admin, packer } = setup();
  assert.equal(rt.call('getSheetCleanupProgress', { token: packer }).success, false);
  const r = rt.call('runSheetCleanup', { token: admin, trashExtraVideos: true });
  assert.equal(r.success, true, r.error);
  const p = rt.call('getSheetCleanupProgress', { token: admin }).progress;
  assert.equal(p.phase, 'done');
  assert.equal(p.rowsDone, r.removedRowsCount);
  assert.equal(p.videosDone, r.videosTrashedCount + r.videosFailedCount);
  assert.ok(p.videosTotal > 0 && p.rowsTotal >= p.rowsDone);
});

test('archived rows can be listed and put back exactly as they were (admin only)', () => {
  const { rt, admin, packer, orders } = setup();
  rt.call('runSheetCleanup', { token: admin });
  assert.equal(rt.call('listCleanupArchive', { token: packer }).success, false);
  const list = rt.call('listCleanupArchive', { token: admin });
  assert.equal(list.success, true, list.error);
  const ol = list.rows.filter((r) => r.sheet === 'OrderLog');
  assert.equal(ol.length, 1, 'OrderLog duplicate archived');
  assert.equal(ol[0].orderId, '#OD-6831');
  assert.ok(ol[0].sizeBytes > 40 * 1048576);
  const before = rt.sheets.get('OrderLog').rows.length;
  const r = rt.call('restoreCleanupArchive', { token: admin, items: [{ sheet: 'OrderLog', archiveRow: ol[0].archiveRow }] });
  assert.equal(r.success, true, r.error);
  assert.equal(r.restored, 1);
  const rows = rt.sheets.get('OrderLog').rows;
  assert.equal(rows.length, before + 1);
  const back = rows[rows.length - 1];
  assert.deepEqual(back.slice(1), orders[1].slice(1), 'same values as the removed row');
  assert.equal(rt.sheets.get('OrderLog').cellFormats[rows.length + ':1'], 'dd-mmm-yy hh:mm');
  assert.equal(rt.sheets.get('OrderLog Archive').rows.length, 1, 'row left the Archive tab');
  assert.equal(rt.call('listCleanupArchive', { token: admin }).rows.filter((x) => x.sheet === 'OrderLog').length, 0);
});
