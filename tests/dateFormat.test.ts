import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtDateTime, fmtTime, dateMs } from '../src/lib/dateFormat';

test('DD-MMM-YY everywhere', () => {
  assert.equal(fmtDate(new Date(2026, 10, 24, 14, 2, 40)), '24-Nov-26');
  assert.equal(fmtDate('2026-08-05'), '05-Aug-26', 'plain day is the local calendar day');
  assert.equal(fmtDate(new Date(2026, 0, 1).toISOString()), '01-Jan-26');
  assert.equal(fmtDateTime(new Date(2026, 10, 24, 9, 5, 7)), '24-Nov-26 09:05');
  assert.equal(fmtDateTime(new Date(2026, 10, 24, 9, 5, 7), true), '24-Nov-26 09:05:07');
  assert.equal(fmtTime(new Date(2026, 10, 24, 23, 59)), '23:59');
  assert.equal(fmtDate('not a date'), 'not a date');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
});

test('reads day-first text dates from the sheet', () => {
  assert.equal(fmtDateTime('24/11/2026 14:02:05'), '24-Nov-26 14:02');
  assert.equal(fmtDateTime('16 Nov 2026, 2:06:05\u202fpm'), '16-Nov-26 14:06');
  assert.equal(fmtDate('24-Nov-26'), '24-Nov-26');
  assert.ok(dateMs('24/11/2026 10:00') > dateMs('16 Nov 2026, 14:06:05'));
  assert.equal(dateMs('garbage'), 0);
});

test('year-2124/2126 rows from old sheets read as the real year', () => {
  assert.equal(fmtDate('2124-04-10T10:45:09.744Z'), '10-Apr-24');
  assert.equal(fmtDate(new Date(2126, 9, 15)), '15-Oct-26');
  assert.ok(dateMs('2124-04-10T21:45:09.744Z') < Date.now());
  assert.equal(fmtDate(new Date(2027, 0, 5)), '05-Jan-27', 'real future dates are left alone');
});

test('video timestamp overlay uses DD-MMM-YY', async () => {
  const { formatOsdTime } = await import('../src/lib/videoOsd');
  assert.equal(formatOsdTime(new Date(2026, 10, 25, 17, 17, 31).getTime()), '25-Nov-26  17:17:31');
  assert.equal(formatOsdTime(new Date(2027, 0, 5, 9, 4, 3).getTime()), '05-Jan-27  09:04:03');
});
