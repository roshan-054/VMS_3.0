'use strict';
// Pack Verification Audit Logs: each check links to the order's uploaded packing video.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  const token = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}

test('a pack check links to the Forward video of the same order (any # / space format)', () => {
  const { rt, token } = setup();
  const d = new Date('2026-11-25T09:00:00Z');
  const ol = rt.sheets.get('OrderLog');
  ol.rows.push([d, '#OD-9844', 'D2C', 'v@x.com', 'FWD_FILE_9844_abcdef', '', '', 'Completed', 'Forward']);
  ol.rows.push([d, '405-9801142-6317130', 'Amazon', 'v@x.com', 'AMZ_FILE_123456789', '', '', 'Completed', 'Forward']);
  rt.sheets.get('ReturnLog').rows.push([d, 'OD-9523', 'D2C', 'v@x.com', 'RET_FILE_9523_abcdef', '', '', 'Completed', 'Return']);
  const pv = rt.sheets.get('PackVerificationLog');
  for (const oid of ['#OD-9844', 'OD-9844', '405-9801142-6317130', '#OD-9523']) {
    pv.rows.push([d, oid, 'D2C', 'vineet', 'vineet', 'v@x.com', '', 'MATCHED', 1, 1, '', '[]', 5, '']);
  }
  const logs = rt.call('getPackVerificationLogs', { token }).logs;
  const by = (oid) => logs.find((l) => l.orderId === oid).videoDriveUrl;
  assert.equal(by('#OD-9844'), 'https://drive.google.com/file/d/FWD_FILE_9844_abcdef/view');
  assert.equal(by('OD-9844'), 'https://drive.google.com/file/d/FWD_FILE_9844_abcdef/view');
  assert.equal(by('405-9801142-6317130'), 'https://drive.google.com/file/d/AMZ_FILE_123456789/view');
  assert.equal(by('#OD-9523'), '', 'a return video is not the packing video');
});

test('a link already saved on the pack check is kept', () => {
  const { rt, token } = setup();
  rt.sheets.get('PackVerificationLog').rows.push([new Date(), '#OD-1', 'D2C', '', '', '', '', 'MATCHED', 1, 1, '', '[]', 1, 'https://saved/link']);
  assert.equal(rt.call('getPackVerificationLogs', { token }).logs[0].videoDriveUrl, 'https://saved/link');
});
