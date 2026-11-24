'use strict';
// Admin "video storage location": one central Drive folder for every station, validated before use.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const USERS = [
  [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
];

const { fakeDrive } = require('./fake-drive.cjs');

function setup(opts) {
  const rt = createRuntime({ users: USERS.map((r) => r.slice()) });
  const drive = fakeDrive(opts);
  rt.sandbox.DriveApp = drive;
  drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
  drive.add('NEWFOLDER_abcdefghij', 'Videos 2027');
  drive.add('READONLY_abcdefghij', 'Someone Elses Folder');
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, drive, admin, packer };
}

test('checkDriveFolder reports name, link and write access', () => {
  const { rt, admin } = setup({ readOnly: ['READONLY_abcdefghij'] });
  const ok = rt.call('checkDriveFolder', { token: admin, folder: 'https://drive.google.com/drive/folders/NEWFOLDER_abcdefghij?usp=sharing' });
  assert.equal(ok.success, true);
  assert.equal(ok.name, 'Videos 2027');
  assert.equal(ok.folderId, 'NEWFOLDER_abcdefghij');
  assert.equal(ok.canWrite, true);

  const ro = rt.call('checkDriveFolder', { token: admin, folder: 'READONLY_abcdefghij' });
  assert.equal(ro.success, false);
  assert.equal(ro.canWrite, false);
  assert.match(ro.error, /Editor/);

  const missing = rt.call('checkDriveFolder', { token: admin, folder: 'DOESNOTEXIST_12345' });
  assert.equal(missing.success, false);
  assert.match(missing.error, /cannot open/i);
});

test('only admins can check or change the video folder', () => {
  const { rt, packer } = setup();
  assert.equal(rt.call('checkDriveFolder', { token: packer, folder: 'NEWFOLDER_abcdefghij' }).success, false);
  assert.equal(rt.call('saveBranding', { token: packer, videoDriveFolderId: 'NEWFOLDER_abcdefghij' }).success, false);
});

test('saving an unusable folder is refused and the old folder stays active', () => {
  const { rt, admin } = setup({ readOnly: ['READONLY_abcdefghij'] });
  const res = rt.call('saveBranding', { token: admin, videoDriveFolderId: 'READONLY_abcdefghij' });
  assert.equal(res.success, false);
  assert.equal(rt.sandbox.videoRootFolderId_(), '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA');
});

test('after the admin changes the folder, every station uploads into it (station value ignored)', () => {
  const { rt, drive, admin, packer } = setup();
  // Warm the cache with the old folder, then change it: the cache must be refreshed.
  assert.equal(rt.sandbox.videoRootFolderId_(), '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA');
  const saved = rt.call('saveBranding', { token: admin, videoDriveFolderId: 'https://drive.google.com/drive/folders/NEWFOLDER_abcdefghij' });
  assert.equal(saved.success, true);
  assert.equal(saved.folder.name, 'Videos 2027');

  // A packing station still has the old folder id in its browser and sends it: it must be ignored.
  const up = rt.call('startUpload', {
    token: packer, orderId: 'ORD-1', platform: 'Amazon', recordingType: 'Forward', fileName: 'ORD-1_Amazon_Forward.mp4',
    fileSize: 1000, uploadId: 'u1', recordingDate: '2026-11-24', driveFolderId: '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', totalChunks: 1,
  });
  assert.notEqual(up.code, 'AUTH_REQUIRED');
  const dateFolders = [...drive.folders.values()].filter((f) => f.name === '2026-11-24');
  assert.equal(dateFolders.length, 1, 'one date folder created');
  assert.equal(drive.pathOf(dateFolders[0]), 'Videos 2027/Amazon/Forward/Nov-2026/2026-11-24');
});

test('if the configured folder becomes inaccessible, uploads fail loudly instead of going elsewhere', () => {
  const { rt, drive, admin, packer } = setup();
  rt.call('saveBranding', { token: admin, videoDriveFolderId: 'NEWFOLDER_abcdefghij' });
  drive.folders.delete('NEWFOLDER_abcdefghij'); // access removed later
  const up = rt.call('startUpload', {
    token: packer, orderId: 'ORD-2', platform: 'Amazon', recordingType: 'Forward', fileName: 'ORD-2_Amazon_Forward.mp4',
    fileSize: 1000, uploadId: 'u2', recordingDate: '2026-11-24', totalChunks: 1,
  });
  assert.equal(up.success, false);
  assert.match(up.error, /Cannot open the Google Drive video folder/);
  assert.equal([...drive.folders.values()].filter((f) => f.name === '2026-11-24').length, 0);
});
