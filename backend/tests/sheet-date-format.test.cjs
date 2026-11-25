'use strict';
// Google Sheet dates: DD-MMM-YY format on every log tab; text and year-2126 timestamps become real dates.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const HDR = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];

function setup() {
  const rt = createRuntime({ users: [[new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  const real = new Date(2026, 10, 24, 14, 2);
  rt.addSheet('OrderLog', [HDR,
    [real, '#A1', 'Amazon', 'a@x', 'f1', '', '1 MB', 'Completed', 'Forward', 'q1', 'video/mp4', 'READY'],
    ['2026-11-23T10:00:00.000Z', '#A2', 'Amazon', 'a@x', 'f2', '', '1 MB', 'Completed', 'Forward', 'q2', 'video/mp4', 'READY'],
    [new Date(2126, 9, 15, 9, 0), '#A3', 'Amazon', 'a@x', 'f3', '', '1 MB', 'Completed', 'Forward', 'q3', 'video/mp4', 'READY'],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  return { rt, admin, real };
}

test('admin action formats date columns DD-MMM-YY and repairs text / 2126 dates', () => {
  const { rt, admin, real } = setup();
  const r = rt.call('applyDateFormats', { token: admin });
  assert.equal(r.success, true, r.error);
  const sh = rt.sheets.get('OrderLog');
  assert.equal(sh.numberFormats[1], 'dd-mmm-yy hh:mm');
  assert.ok(sh.rows[1][0] instanceof Date && sh.rows[1][0].getTime() === real.getTime(), 'real date untouched');
  assert.ok(sh.rows[2][0] instanceof Date, 'ISO text became a date');
  assert.equal(sh.rows[2][0].toISOString(), '2026-11-23T10:00:00.000Z');
  assert.equal(sh.rows[3][0].getFullYear(), 2026, '2126 repaired');
  assert.equal(sh.rows[4][0], '', 'blank stays blank');
  assert.ok('OrderLog' in r.converted);
  assert.equal(rt.sheets.get('Users').numberFormats[1], 'dd-mmm-yy hh:mm');
});

test('runs by itself from normal traffic, then not again for 6 hours', () => {
  const { rt, admin } = setup();
  rt.call('getUploadLogs', { token: admin });
  const sh = rt.sheets.get('OrderLog');
  assert.equal(sh.numberFormats[1], 'dd-mmm-yy hh:mm');
  sh.rows.push(['2026-11-24T08:00:00.000Z', '#A9', 'Amazon', 'a@x', 'f9', '', '1 MB', 'Completed', 'Forward', 'q9', 'video/mp4', 'READY']);
  rt.call('getUploadLogs', { token: admin });
  assert.equal(typeof sh.rows[5][0], 'string', 'skipped while the 6-hour flag is set');
});

test('Upload Logs still list newest first after the conversion', () => {
  const { rt, admin } = setup();
  rt.call('applyDateFormats', { token: admin });
  const r = rt.call('advancedSearch', { token: admin, fromDate: '2026-01-01', toDate: '2026-12-31', limit: 50 });
  const ids = (r.results || r.orders || []).map((x) => x.orderId);
  assert.ok(ids.includes('#A3') && ids.includes('#A1'), JSON.stringify(ids));
});

test('rows the backend appends later are DD-MMM-YY too (SecurityLog, Archive tabs, GTINCatalog)', () => {
  const { rt, admin } = setup();
  rt.call('applyDateFormats', { token: admin });
  // A new SecurityLog row (login) gets the format on its own date cell.
  rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' });
  const sec = rt.sheets.get('SecurityLog');
  assert.equal(sec.cellFormats[sec.rows.length + ':1'], 'dd-mmm-yy hh:mm', 'new SecurityLog row formatted');
  // GTINCatalog with a blank header row gets its headers back and dated rows formatted.
  rt.addSheet('GTINCatalog', [['', '', '', '', '', '', '', '', '', 'Tag']]);
  const r = rt.call('saveGtinCatalogBatch', { token: admin, products: [{ gtin: '8906191690025', sku: 'UP-KUM-01', productName: 'Kumkum Powder', tag: 'Active-online' }] });
  assert.equal(r.success, true, r.error);
  const cat = rt.sheets.get('GTINCatalog');
  assert.deepEqual(cat.rows[0].slice(0, 4), ['Timestamp', 'GTIN', 'SKU', 'Product Name']);
  assert.equal(cat.cellFormats['2:1'], 'dd-mmm-yy hh:mm');
  // Archive tabs: Archived At and the original Timestamp column.
  rt.addSheet('UploadLog Archive', [['Archived At', 'Reason', 'Timestamp', 'Order ID'], ['25/11/2026 17:21:56', 'Duplicate row', new Date(2026, 10, 20), '#A1']]);
  rt.call('applyDateFormats', { token: admin });
  const arch = rt.sheets.get('UploadLog Archive');
  assert.equal(arch.numberFormats[1], 'dd-mmm-yy hh:mm');
  assert.equal(arch.numberFormats[3], 'dd-mmm-yy hh:mm');
  assert.ok(arch.rows[1][0] instanceof Date && arch.rows[1][0].getDate() === 25, 'text date became a real date');
});
