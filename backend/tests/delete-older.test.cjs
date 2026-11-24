'use strict';
// "Delete Videos & Logs Older Than N Days": must really trash the Drive files, use the right
// columns per sheet, keep rows whose video could not be trashed, and finish in batches.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const OHDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const UHDR = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
const fid = (n) => 'FILE' + String(n).padStart(4, '0') + '_abcdefghijklmnop';

// Fake Drive REST: PATCH files/{id} {trashed:true}
function driveRest({ missing = [], forbidden = [] } = {}) {
  const trashed = new Set();
  const calls = { batches: 0, files: 0 };
  return {
    trashed, calls,
    UrlFetchApp: {
      fetchAll(reqs) {
        calls.batches++;
        return reqs.map((r) => {
          calls.files++;
          const id = decodeURIComponent(r.url.match(/files\/([^?]+)/)[1]);
          assert.equal(r.method, 'patch');
          assert.deepEqual(JSON.parse(r.payload), { trashed: true });
          let code = 200;
          if (missing.includes(id)) code = 404;
          else if (forbidden.includes(id)) code = 403;
          else trashed.add(id);
          return { getResponseCode: () => code, getContentText: () => JSON.stringify({ error: { message: code === 403 ? 'The user does not have sufficient permissions for this file.' : 'File not found' } }) };
        });
      },
    },
  };
}

function setup({ oldCount = 120, newCount = 5, missing, forbidden } = {}) {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const old = new Date(Date.now() - 100 * 86400000);
  const recent = new Date(Date.now() - 3 * 86400000);
  const orders = [OHDR];
  const uploads = [UHDR];
  for (let i = 0; i < oldCount + newCount; i++) {
    const ts = i < oldCount ? old : recent;
    orders.push([ts, '#OD-' + i, 'D2C', 'pat@example.com', fid(i), '', '10.00 MB', 'Completed', 'Forward', 'q' + i, 'video/mp4', 'READY']);
    uploads.push([ts, '#OD-' + i, 'D2C', 'pat@example.com', '#OD-' + i + '_D2C_Forward.mp4', '10.00 MB', 'u' + i, 'done', 100, fid(i), 'Completed', '', 'Forward', 'Station', 'q' + i]);
  }
  rt.addSheet('OrderLog', orders);
  rt.addSheet('UploadLog', uploads);
  rt.addSheet('ReturnLog', [OHDR]);
  const rest = driveRest({ missing, forbidden });
  rt.sandbox.UrlFetchApp = rest.UrlFetchApp;
  rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, rest, admin, packer };
}

test('scan reads UploadLog Drive File ID column, counts unique videos, newest first', () => {
  const { rt, admin } = setup({ oldCount: 3, newCount: 2 });
  const r = rt.call('scanOlderVideos', { token: admin, days: 90 });
  assert.equal(r.success, true);
  assert.equal(r.totalOlderSheetRows, 6, '3 OrderLog + 3 UploadLog rows');
  assert.equal(r.totalOlderDriveVideos, 3, 'UploadLog repeats the same 3 videos');
  const up = r.items.find((i) => i.sheet === 'UploadLog');
  assert.equal(up.fileId, fid(up.orderId.replace('#OD-', '') * 1), 'file id, not file name');
  assert.equal(r.estimatedTotalSizeBytes, 3 * 10 * 1048576);
});

test('delete trashes every old video in Drive and removes only old rows', () => {
  const { rt, rest, admin } = setup();
  const r = rt.call('deleteOlderVideos', { token: admin, days: 90, moveDriveVideosToTrash: true, removeSheetEntries: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.done, true);
  assert.equal(r.movedDriveVideosCount, 120);
  assert.equal(rest.trashed.size, 120);
  assert.ok(rest.calls.batches <= 3, 'files trashed in parallel batches of 50, not one by one');
  assert.equal(rest.calls.files, 120, 'each video trashed once even though UploadLog repeats it');
  assert.equal(r.removedSheetRowsCount, 0, 'no sheet row is ever deleted');
  assert.equal(r.keptRowsCount, 240);
  const ol = rt.sheets.get('OrderLog').rows, ul = rt.sheets.get('UploadLog').rows;
  assert.equal(ol.length, 1 + 125);
  assert.equal(ul.length, 1 + 125);
  assert.match(String(ol[1][11]), /^Video moved to Drive Trash/, 'OrderLog Playback Status marks it');
  assert.match(String(ul[1][7]), /^Video moved to Drive Trash/, 'UploadLog Stage marks it');
  assert.equal(ol[1][4], fid(0), 'Drive ID kept for the record');
  assert.equal(ol[125][11], 'READY', 'recent row untouched');
  // A second run finds nothing left to do.
  const again = rt.call('scanOlderVideos', { token: admin, days: 90 });
  assert.equal(again.totalOlderDriveVideos, 0);
  for (let i = 120; i < 125; i++) assert.ok(!rest.trashed.has(fid(i)), 'recent videos untouched');
});

test('a video that cannot be trashed keeps its rows; an already-deleted one is cleared', () => {
  const { rt, admin } = setup({ oldCount: 4, newCount: 0, missing: [fid(1)], forbidden: [fid(2)] });
  const r = rt.call('deleteOlderVideos', { token: admin, days: 90 });
  assert.equal(r.movedDriveVideosCount, 2);
  assert.equal(r.alreadyGoneCount, 1);
  assert.equal(r.failedCount, 1);
  assert.match(r.errors[0], /sufficient permissions/);
  const ol = rt.sheets.get('OrderLog').rows.slice(1);
  assert.equal(ol.length, 4, 'all rows kept');
  assert.equal(ol[2][11], 'READY', 'the video that could not be trashed is not marked');
  assert.match(String(ol[1][11]), /Drive Trash/, 'already-deleted video is marked');
});

test('runs out of time: returns done:false, next call finishes the rest', () => {
  const { rt, rest, admin } = setup({ oldCount: 120, newCount: 0 });
  const realNow = Date.now;
  let t = realNow();
  rt.sandbox.Date.now = () => (t += 1000); // every call "takes" a second
  let r;
  try {
    r = rt.call('deleteOlderVideos', { token: admin, days: 90, budgetMs: 5000 });
  } finally {
    rt.sandbox.Date.now = realNow;
  }
  assert.equal(r.done, false);
  assert.ok(r.remainingVideos > 0);
  const r2 = rt.call('deleteOlderVideos', { token: admin, days: 90 });
  assert.equal(r2.done, true);
  assert.equal(rest.trashed.size, 120);
  assert.equal(rt.sheets.get('OrderLog').rows.length, 121, 'rows kept');
});

test('an old app asking to remove sheet rows still keeps every row', () => {
  const { rt, admin } = setup({ oldCount: 3, newCount: 1 });
  const r = rt.call('deleteOlderVideos', { token: admin, days: 90, removeSheetEntries: true });
  assert.equal(r.removedSheetRowsCount, 0);
  assert.equal(rt.sheets.get('OrderLog').rows.length, 5);
  assert.equal(rt.sheets.get('UploadLog').rows.length, 5);
});

test('packers cannot delete', () => {
  const { rt, rest, packer } = setup({ oldCount: 2, newCount: 0 });
  const r = rt.call('deleteOlderVideos', { token: packer, days: 90 });
  assert.notEqual(r.success, true);
  assert.equal(rest.trashed.size, 0);
  assert.equal(rt.sheets.get('OrderLog').rows.length, 3);
});
