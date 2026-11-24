'use strict';
// Analytics answers come from a short cache on repeat views and refresh as soon as a video is logged.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const today = new Date().toLocaleDateString('en-CA');

function setup() {
  const rt = createRuntime({ users: [
    [new Date(), 'Ada Admin', 'ada@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const ol = rt.sheets.get('OrderLog');
  for (let i = 0; i < 5; i++) ol.appendRow([new Date(), `ORD-${i}`, 'Amazon', i < 3 ? 'pat@example.com' : 'ada@example.com', `FILE_${i}_abcdef`, '', '1 MB', 'Completed', 'Forward', `job-${i}`]);
  let reads = 0;
  const orig = ol.getDataRange.bind(ol);
  ol.getDataRange = () => { reads++; return orig(); };
  const admin = rt.call('login', { email: 'ada@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  const get = (token) => rt.call('getAnalyticsData', { token, fromDate: today, toDate: today });
  return { rt, ol, get, admin, packer, reads: () => reads };
}

test('a repeat view is answered from the cache without reading the sheets again', () => {
  const { get, admin, reads } = setup();
  const a = get(admin);
  assert.equal(a.success, true, a.error);
  const before = reads();
  const b = get(admin);
  assert.equal(b.cached, true);
  assert.equal(reads(), before);
  assert.equal(b.forwardCount, a.forwardCount);
});

test('packers and admins never share cached answers', () => {
  const { get, admin, packer } = setup();
  assert.equal(get(admin).forwardCount, 5);
  assert.equal(get(packer).forwardCount, 3);
});

test('a newly uploaded video shows up at once', () => {
  const { rt, get, admin } = setup();
  assert.equal(get(admin).forwardCount, 5);
  const fin = rt.call('finishUpload', { token: admin, uploadId: 'up-new', fileId: 'FILE_NEW_abcdef', orderId: 'ORD-NEW', platform: 'Amazon', recordingType: 'Forward', queueJobId: 'job-new' });
  assert.equal(fin.success, true, fin.error);
  const after = get(admin);
  assert.notEqual(after.cached, true);
  assert.equal(after.forwardCount, 6);
});

test('without a valid sign-in nothing is returned, cached or not', () => {
  const { rt, get, admin } = setup();
  get(admin);
  const r = rt.call('getAnalyticsData', { fromDate: today, toDate: today });
  assert.equal(r.success, false);
});
