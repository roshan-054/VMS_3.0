'use strict';
// Rows saved with a year 100 too far ahead (15 Oct 2126) are read as 15 Oct 2026, so the newest
// real entries come first in Upload Logs instead of being pushed below "future" rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Ada Admin', 'ada@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  const ol = rt.sheets.get('OrderLog');
  ol.appendRow([new Date('2126-10-15T05:49:58'), '#OD-6594', 'D2C', 'vineet@vms.com', 'FILE_OLD_6594_x', '', '53 MB', 'Completed', 'Forward', 'job-6594']);
  ol.appendRow([new Date(Date.now() - 3600000), '#OD-9703', 'D2C', 'vineet@vms.com', 'FILE_NEW_9703_x', '', '22 MB', 'Completed', 'Forward', 'job-9703']);
  const token = rt.call('login', { email: 'ada@example.com', password: 'AdminPass1' }).token;
  return { rt, token };
}

test('Upload Logs: newest real entry first, the 2126 row is shown as 2026', () => {
  const { rt, token } = setup();
  const res = rt.call('getUploadLogs', { token, limit: 500 });
  assert.equal(res.success, true, res.error);
  assert.equal(res.logs[0].orderId, '#OD-9703');
  const old = res.logs.find((l) => l.orderId === '#OD-6594');
  assert.equal(new Date(old.timestamp).getFullYear(), 2026);
  assert.equal(new Date(old.timestamp).getMonth(), 9);
});

test('a real future-looking date within 2 days is left alone', () => {
  const { rt } = setup();
  const soon = new Date(Date.now() + 3600000);
  assert.equal(rt.sandbox.rowDate_(soon).getTime(), soon.getTime());
  assert.equal(rt.sandbox.rowIso_('not a date'), 'not a date');
});

test('Search and analytics also read the corrected date', () => {
  const { rt, token } = setup();
  const s = rt.call('advancedSearch', { token, orderId: '#OD-6594' });
  const rows = s.results || s.rows || [];
  assert.ok(rows.length >= 1, JSON.stringify(s).slice(0, 200));
  assert.equal(new Date(rows[0].timestamp).getFullYear(), 2026);
});

test('Upload Logs default view: recent rows saved as day-first text are newest, not dropped below older ones', () => {
  const { rt, token } = setup();
  const ol = rt.sheets.get('OrderLog');
  // 600 older real-date rows (16 Nov), then today's rows typed/pasted as text in Indian order.
  const base = new Date(2026, 10, 16, 14, 0).getTime();
  for (let i = 0; i < 600; i++) ol.appendRow([new Date(base + i * 60000), '#OD-' + (8000 + i), 'D2C', 'v@x', 'F16_' + i + '_xxxxxxxx', '', '10 MB', 'Completed', 'Forward', 'j16_' + i]);
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0'), mm = String(today.getMonth() + 1).padStart(2, '0'), yy = today.getFullYear();
  ol.appendRow([`${dd}/${mm}/${yy} 00:05:00`, '#OD-T1', 'D2C', 'v@x', 'FT1_xxxxxxxxxxxx', '', '10 MB', 'Completed', 'Forward', 'jt1']);
  ol.appendRow([`${dd}/${mm}/${yy} 00:06:00`, '#OD-T2', 'D2C', 'v@x', 'FT2_xxxxxxxxxxxx', '', '10 MB', 'Completed', 'Forward', 'jt2']);
  const res = rt.call('getUploadLogs', { token, limit: 500 });
  const ids = res.logs.slice(0, 4).map((l) => l.orderId);
  assert.ok(ids.includes('#OD-T1') && ids.includes('#OD-T2'), ids.join(','));
  const times = res.logs.map((l) => new Date(l.timestamp).getTime());
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i], 'sorted newest first at ' + i);
  // A date filter no longer lets unreadable dates slip in.
  ol.appendRow(['someday', '#OD-BAD', 'D2C', 'v@x', 'FBAD_xxxxxxxxxxx', '', '1 MB', 'Completed', 'Forward', 'jbad']);
  const f = rt.call('getUploadLogs', { token, fromDate: '2026-11-16', toDate: '2026-11-16', limit: 5000 });
  assert.ok(!f.logs.some((l) => l.orderId === '#OD-BAD'));
});
