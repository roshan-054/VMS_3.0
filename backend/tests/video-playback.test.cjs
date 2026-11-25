'use strict';
// Full-quality playback: the original uploaded file is read from Drive in byte ranges.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const VIDEO = crypto.randomBytes(20 * 1024 * 1024 + 123); // 20 MB + a bit: 3 chunks
const FID = 'VIDEOFILE_abcdefghij123';
const OTHER = 'PRIVATEDOC_abcdefghij99';

function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved']] });
  rt.addSheet('OrderLog', [['Timestamp', 'OrderId', 'DriveFileId'], [new Date(), 'ORD-1', FID]]);
  const files = { [FID]: VIDEO, [OTHER]: Buffer.from('secret') };
  const fetches = [];
  const driveLookups = [];
  rt.sandbox.DriveApp = {
    getFileById: (id) => {
      driveLookups.push(id);
      if (!files[id]) throw new Error('No item with the given ID could be found');
      return { getSize: () => files[id].length, getMimeType: () => 'video/mp4', getName: () => id + '.mp4' };
    },
  };
  rt.sandbox.ScriptApp = { getOAuthToken: () => 'tok' };
  rt.sandbox.UrlFetchApp = {
    fetch: (url, opts) => {
      fetches.push({ url, range: opts.headers.Range, auth: opts.headers.Authorization });
      const id = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      const [a, b0] = opts.headers.Range.replace('bytes=', '').split('-').map(Number);
      const b = Math.min(b0, files[id].length - 1); // Drive trims a range that runs past the end
      const part = files[id].subarray(a, b + 1);
      return {
        getResponseCode: () => 206,
        getHeaders: () => ({ 'Content-Range': `bytes ${a}-${b}/${files[id].length}`, 'Content-Type': 'video/mp4' }),
        getContent: () => Array.from(part, (x) => (x > 127 ? x - 256 : x)),
      };
    },
  };
  const token = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, token, fetches, driveLookups };
}

test('the original file is returned byte-for-byte in 8 MB chunks', () => {
  const { rt, token, fetches, driveLookups } = setup();
  const parts = [];
  let start = 0;
  let size = Infinity;
  while (start < size) {
    const r = rt.call('getVideoChunk', { token, fileId: FID, start });
    assert.equal(r.success, true, r.error);
    size = r.size;
    assert.ok(r.length <= 8 * 1024 * 1024);
    parts.push(Buffer.from(r.data, 'base64'));
    start += r.length;
  }
  assert.equal(parts.length, 3);
  assert.ok(Buffer.concat(parts).equals(VIDEO), 'reassembled file matches the original');
  assert.equal(fetches[0].range, 'bytes=0-8388607');
  assert.match(fetches[0].url, /alt=media/);
  assert.equal(fetches[0].auth, 'Bearer tok');
  assert.equal(driveLookups.length, 0, 'size and type come from the ranged read, no extra Drive lookups per chunk');
  assert.equal(fetches.length, 3, 'one Drive read per chunk');
});

test('files that are not logged packing videos cannot be read, and login is required', () => {
  const { rt, token } = setup();
  const r = rt.call('getVideoChunk', { token, fileId: OTHER, start: 0 });
  assert.equal(r.success, false);
  assert.equal(r.code, 'NOT_A_VMS_VIDEO');
  const anon = rt.call('getVideoChunk', { fileId: FID, start: 0 });
  assert.equal(anon.success, false);
});

test('a 403 because the Drive API is off in the Cloud project says how to fix it', () => {
  const { rt, token } = setup();
  const reply = (code, body) => ({ getResponseCode: () => code, getHeaders: () => ({}), getContentText: () => JSON.stringify(body), getContent: () => [] });
  rt.sandbox.UrlFetchApp = {
    fetch: () => reply(403, { error: { code: 403, message: 'Google Drive API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }),
  };
  const r = rt.call('getVideoChunk', { token, fileId: FID, start: 0 });
  assert.equal(r.success, false);
  assert.match(r.error, /Drive API is turned off/);
  rt.sandbox.UrlFetchApp = { fetch: () => reply(403, { error: { message: 'The user does not have sufficient permissions for this file.' } }) };
  const other = rt.call('getVideoChunk', { token, fileId: FID, start: 0 });
  assert.match(other.error, /403 while reading the video: The user does not have sufficient permissions/);
});
