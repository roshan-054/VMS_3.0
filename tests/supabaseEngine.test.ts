// The browser engine must answer exactly like Apps Script. Each case runs the same request
// through the real Code.gs twice: once on the mocked Google Sheet (backend/tests/gas-harness)
// and once in the browser engine on the Supabase copy of the same rows, then compares the
// answers and the rows written.
process.env.TZ = 'Asia/Kolkata';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { compileCodeGs, runEngine, formatDate, type TabSnapshot } from '../src/lib/supabase/gasEngine';
import { encodeRow, decodeRow, type ReplicaRow } from '../src/lib/supabase/cells';

const require = createRequire(import.meta.url);
const { createRuntime } = require('../backend/tests/gas-harness.cjs');
const CODE = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'backend', 'Code.gs'), 'utf8');
const factory = compileCodeGs(CODE);

const HEADERS: Record<string, string[]> = {
  OrderLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID', 'Video MIME Type', 'Playback Status'],
  ReturnLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID', 'Video MIME Type', 'Playback Status'],
  DownloadLog: ['Timestamp', 'Order ID', 'Platform', 'User Email', 'File Name', 'File Size', 'Download Type', 'Recording Type'],
  UploadLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'File Name', 'File Size', 'Upload ID', 'Stage', 'Progress', 'Drive File ID', 'Status', 'Error', 'Recording Type', 'Source', 'Queue Job ID'],
  OrderManifest: ['Timestamp', 'Order ID', 'Platform', 'Assigned Packer Name', 'Assigned Packer Email', 'Processed By Name', 'Processed By Email', 'Total Items Count', 'Items List', 'Status', 'Notes', 'Packed At', 'Packed By Name', 'Video Drive Link'],
  PackVerificationLog: ['Timestamp', 'Order ID', 'Platform', 'Assigned Packer', 'Verified By Packer', 'Packer Email', 'Processed By', 'Status', 'Total Required Items', 'Total Scanned Items', 'Items Summary', 'Scanned GTINs Log', 'Duration Seconds', 'Drive Video URL'],
  GTINCatalog: ['Timestamp', 'GTIN', 'SKU', 'Product Name', 'Short Name', 'Category', 'Image URL', 'Default Quantity', 'Notes', 'Tag'],
  PackageDetails: ['Timestamp', 'Order ID', 'Platform', 'Recording Type', 'Box', 'Length (cm)', 'Breadth (cm)', 'Height (cm)', 'Actual Weight (kg)', 'Volumetric Weight (kg)', 'Chargeable Weight (kg)', 'Volumetric Divisor', 'Packer Email'],
};

// Deterministic pseudo-random data.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const DAY = 86400000;
const NOW = Date.now();
const PLATFORMS = ['Amazon', 'D2C', 'JioMart', 'Meesho'];
const PACKERS = ['p1@vms.test', 'p2@vms.test', 'admin@vms.test'];
const pad = (row: unknown[], n: number) => { const r = row.slice(); while (r.length < n) r.push(''); return r; };

function fixtures(): Record<string, unknown[][]> {
  seed = 42;
  const t: Record<string, unknown[][]> = {};
  Object.keys(HEADERS).forEach((k) => (t[k] = []));
  for (let i = 0; i < 160; i++) {
    const type = rnd() < 0.75 ? 'Forward' : 'Return';
    const ts = new Date(NOW - Math.floor(rnd() * 40 * DAY));
    const oid = '405-' + (1000000 + i * 7) + '-' + (2000000 + i);
    const pf = pick(PLATFORMS);
    const pe = pick(PACKERS);
    const fid = 'file' + i + 'abcdef';
    const job = 'job-' + i;
    (type === 'Forward' ? t.OrderLog : t.ReturnLog).push(pad([ts, oid, pf, pe, fid, rnd() < 0.5 ? 'https://drive.google.com/file/d/' + fid + '/preview' : '', (rnd() * 20).toFixed(1) + ' MB', rnd() < 0.9 ? 'Completed' : 'Verified', type, job, 'video/mp4', 'Ready'], 12));
    if (rnd() < 0.5) {
      t.UploadLog.push(pad([new Date(ts.getTime() - 60000), oid, pf, pe, oid + '_' + pf + '_' + type + '.mp4', '12 MB', 'up-' + i, 'Uploaded to Google Drive', 100, fid, 'Completed', '', type, 'Recorder', job], 15));
    }
    if (i % 4 === 0) t.PackageDetails.push([new Date(ts.getTime() + 30000), oid, pf, type, i % 8 ? 'Box-1' : 'Custom', 10, 10, 3, 0.25, 0.06, 0.25, 5000, pe]);
    if (rnd() < 0.3) t.DownloadLog.push(pad([new Date(ts.getTime() + DAY), oid, pf, pick(PACKERS), oid + '.mp4', '12 MB', 'single', type], 8));
  }
  for (let i = 0; i < 40; i++) {
    const ts = new Date(NOW - Math.floor(rnd() * 3 * DAY) - (i % 3 === 0 ? 30 * 60000 : 0));
    const st = pick(['In Progress', 'Started', 'Failed', 'Pending', 'Queued']);
    t.UploadLog.push(pad([ts, 'ORD-UP-' + i, pick(PLATFORMS), pick(PACKERS), 'ORD-UP-' + i + '.mp4', '3 MB', 'upl-' + i, 'Uploading chunk 2 of 5', 40, '', st, st === 'Failed' ? 'Network' : '', rnd() < 0.8 ? 'Forward' : 'Return', 'Recorder', 'jq-' + i], 15));
  }
  for (let i = 0; i < 50; i++) {
    const items = 'Soap [SKU' + (i % 7) + '] x ' + (1 + (i % 3)) + '; Shampoo [SKU9] x 1';
    t.OrderManifest.push(pad([new Date(Math.floor((NOW - i * 3600000) / 60000) * 60000), 'MAN-' + i, pick(PLATFORMS), 'Packer ' + (i % 3), pick(PACKERS), 'Office', 'office@vms.test', 2 + (i % 3), items, i % 4 === 0 ? 'Packed' : 'Pending', '', i % 4 === 0 ? new Date('2026-11-25T18:30:00Z') : '', i % 4 === 0 ? 'Packer 1' : '', ''], 14));
  }
  for (let i = 0; i < 30; i++) {
    t.PackVerificationLog.push(pad([new Date(NOW - i * 7200000), 'MAN-' + i, 'Amazon', 'Packer 1', 'Packer 1', 'p1@vms.test', 'Office', i % 5 ? 'MATCHED' : 'MISMATCH', 3, i % 5 ? 3 : 2, 'Soap x 2', JSON.stringify([{ gtin: '890' + i, at: 'x' }]), 40 + i, ''], 14));
  }
  for (let i = 0; i < 60; i++) {
    t.GTINCatalog.push(pad([new Date(NOW - i * DAY), String(8901000000000 + i), 'SKU' + i, 'Product ' + i, 'P' + i, i % 3 ? 'Active-online' : 'Offline', '', 1 + (i % 2), '', i % 3 ? 'Active-online' : 'Offline'], 10));
  }
  return t;
}

function makeHarness(data: Record<string, unknown[][]>) {
  const rt = createRuntime({ users: [[new Date(), 'Admin One', 'admin@vms.test', null, 'Admin', 'Approved'], [new Date(), 'Packer One', 'p1@vms.test', null, 'User', 'Approved']] });
  rt.sheets.get('Users').rows[1][3] = rt.hash('Secret123!');
  rt.sheets.get('Users').rows[2][3] = rt.hash('Secret123!');
  // The harness formatDate only knows a few letters; use the full one (same as Apps Script).
  rt.sandbox.Utilities.formatDate = formatDate;
  for (const [name, rows] of Object.entries(data)) {
    const sh = rt.sheets.get(name) || rt.sandbox.SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
    sh.rows.length = 0;
    sh.rows.push(HEADERS[name].slice(), ...rows.map((r) => r.map((v) => (v instanceof Date ? new Date(v.getTime()) : v))));
  }
  return rt;
}

function makeReplica(data: Record<string, unknown[][]>, rowKey: (t: string, r: unknown[]) => string) {
  const tabs = new Map<string, TabSnapshot>();
  let id = 0;
  for (const [name, rows] of Object.entries(data)) {
    const seen: Record<string, number> = {};
    const list: ReplicaRow[] = [];
    rows.forEach((vals, i) => {
      let k = rowKey(name, vals);
      if (!k) return;
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > 1) k += '#' + seen[k];
      list.push({ id: 'id-' + ++id, t: name, k, s: i + 1, v: encodeRow(name, vals), n: 1 });
    });
    tabs.set(name, { headers: HEADERS[name].slice(), rows: list });
  }
  return tabs;
}

/** What the Supabase copy looks like after vms_apply (enough for these tests). */
function applyOps(tabs: Map<string, TabSnapshot>, ops: any[]) {
  for (const o of ops) {
    if (o.op === 'tab') { const t = tabs.get(o.tab) || { headers: [], rows: [] }; t.headers = o.headers; tabs.set(o.tab, t); continue; }
    const t = tabs.get(o.tab)!;
    const keys = new Set(t.rows.map((r) => r.k));
    if (o.op === 'insert') {
      assert.ok(!keys.has(o.key), 'insert would hit the unique key ' + o.key);
      t.rows.push({ id: o.id, t: o.tab, k: o.key, s: (t.rows.at(-1)?.s || 0) + 1, v: o.vals, n: 1 });
    } else if (o.op === 'update') {
      const r = t.rows.find((x) => x.id === o.id)!;
      assert.ok(r, 'update of a missing row');
      assert.equal(r.n, o.version);
      Object.assign(r, { k: o.key, v: o.vals, n: r.n + 1 });
    } else if (o.op === 'delete') {
      t.rows = t.rows.filter((x) => x.id !== o.id);
    }
  }
}

// Normalise: dates -> ISO, values made "now" -> NOW, drop version stamps.
function norm(x: any): any {
  return JSON.parse(JSON.stringify(x, (k, v) => {
    if (k === 'version' || k === 'cached') return undefined;
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v) && Math.abs(Date.parse(v) - Date.now()) < 120000) return 'NOW';
    return v;
  }));
}
const isoNow = (v: unknown) => (v instanceof Date && Math.abs(v.getTime() - Date.now()) < 120000 ? 'NOW' : v);
// Real Google Sheets stores date text typed into a date column as a date; the mock keeps text.
const G_ = factory({ console, __over: {} } as any);
function asSheetsStores(name: string, row: unknown[]) {
  const cols: number[] = G_('sheetDateColumns_')(name, HEADERS[name]);
  const out = row.slice();
  for (const c of cols) {
    const v = out[c - 1];
    if (typeof v === 'string' && v) { const d = G_('rowDate_')(v); if (!isNaN(d.getTime())) out[c - 1] = d; }
  }
  return out;
}
function sheetRows(rt: any, name: string) {
  return rt.sheets.get(name).rows.slice(1).map((r: unknown[]) => norm(encodeRow(name, asSheetsStores(name, r).map(isoNow))));
}
function replicaRows(tabs: Map<string, TabSnapshot>, name: string) {
  return tabs.get(name)!.rows.slice().sort((a, b) => a.s - b.s).map((r) => norm(encodeRow(name, decodeRow(r.v).map(isoNow))));
}

function both(action: string, payload: any, opts: { as?: 'admin' | 'user'; call: (G: any, p: any) => any; data?: Record<string, unknown[][]> }) {
  const data = opts.data || fixtures();
  const rt = makeHarness(data);
  const who = opts.as === 'user' ? { email: 'p1@vms.test', name: 'Packer One', role: 'User' } : { email: 'admin@vms.test', name: 'Admin One', role: 'Admin' };
  const login = rt.call('login', { email: who.email, password: 'Secret123!' });
  assert.equal(login.success, true);
  const gas = rt.call(action, { ...payload, token: login.token });
  const G0 = factory({ console, __over: {} } as any);
  const tabs = makeReplica(data, G0('rowKey_'));
  const run = runEngine(factory, {
    user: who,
    tabs: (n) => { const t = tabs.get(n); return t ? { headers: t.headers.slice(), rows: t.rows.slice().sort((a, b) => a.s - b.s) } : null; },
    tabVersion: () => 'v1',
  }, (G) => opts.call(G, { ...payload, action, token: 'x' }));
  applyOps(tabs, run.ops);
  return { gas, engine: JSON.parse(JSON.stringify(run.result)), rt, tabs, ops: run.ops };
}

const today = formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
const ago = (d: number) => formatDate(new Date(Date.now() - d * DAY), 'Asia/Kolkata', 'yyyy-MM-dd');

const READS: Array<[string, string, any, (G: any, p: any) => any, ('admin' | 'user')?]> = [
  ['search: newest', 'advancedSearch', {}, (G, p) => G('advancedSearch_')(p)],
  ['search: order id part', 'advancedSearch', { orderId: '405-1000' }, (G, p) => G('advancedSearch_')(p)],
  ['search: platform + type', 'advancedSearch', { platform: 'Amazon', recordingType: 'Return' }, (G, p) => G('advancedSearch_')(p)],
  ['search: custom platform', 'advancedSearch', { platform: 'custom' }, (G, p) => G('advancedSearch_')(p)],
  ['search: dates oldest first', 'advancedSearch', { fromDate: ago(10), toDate: today, sort: 'oldest' }, (G, p) => G('advancedSearch_')(p)],
  ['search: packer', 'advancedSearch', { packer: 'p2' }, (G, p) => G('advancedSearch_')(p)],
  ['search: as packer', 'advancedSearch', { limit: 50 }, (G, p) => G('advancedSearch_')(p), 'user'],
  ['upload logs: default', 'getUploadLogs', {}, (G, p) => G('uploadLogs_')(p)],
  ['upload logs: failed', 'getUploadLogs', { status: 'failed' }, (G, p) => G('uploadLogs_')(p)],
  ['upload logs: in progress', 'getUploadLogs', { status: 'in progress' }, (G, p) => G('uploadLogs_')(p)],
  ['upload logs: search text', 'getUploadLogs', { searchQuery: 'jiomart' }, (G, p) => G('uploadLogs_')(p)],
  ['upload logs: dates', 'getUploadLogs', { fromDate: ago(5), toDate: today }, (G, p) => G('uploadLogs_')(p)],
  ['report', 'getReportData', { fromDate: ago(30), toDate: today }, (G, p) => G('getReportData_')(p)],
  ['report: filters', 'getReportData', { fromDate: ago(30), toDate: today, platform: 'D2C', recordingType: 'Forward' }, (G, p) => G('getReportData_')(p)],
  ['report: as packer', 'getReportData', { fromDate: ago(30), toDate: today }, (G, p) => G('getReportData_')(p), 'user'],
  ['analytics', 'getAnalyticsData', { fromDate: ago(30), toDate: today }, (G, p) => G('getAnalyticsDataUncached_')(p, G('session_')(p.token))],
  ['analytics: one week amazon', 'getAnalyticsData', { fromDate: ago(6), toDate: today, platform: 'Amazon' }, (G, p) => G('getAnalyticsDataUncached_')(p, G('session_')(p.token))],
  ['analytics: as packer', 'getAnalyticsData', { fromDate: ago(30), toDate: today }, (G, p) => G('getAnalyticsDataUncached_')(p, G('session_')(p.token)), 'user'],
  ['manifests', 'getOrderManifests', {}, (G, p) => G('getOrderManifests_')(p)],
  ['pack verification logs', 'getPackVerificationLogs', {}, (G, p) => G('getPackVerificationLogs_')(p)],
  ['catalog', 'getGtinCatalog', {}, (G, p) => G('getGtinCatalog_')(p)],
  ['catalog: by tag', 'getGtinCatalog', { tags: ['Active-online'] }, (G, p) => G('getGtinCatalog_')(p)],
  ['duplicate: existing', 'checkDuplicateOrder', { orderId: '405-1000007-2000001', platform: 'Amazon', recordingType: 'Forward' }, (G, p) => G('checkDuplicateOrder_')(p)],
  ['duplicate: new', 'checkDuplicateOrder', { orderId: 'NEW-1', platform: 'Amazon', recordingType: 'Forward' }, (G, p) => G('checkDuplicateOrder_')(p)],
];

for (const [name, action, payload, call, as] of READS) {
  test('same answer as Apps Script: ' + name, () => {
    const { gas, engine, ops } = both(action, payload, { call, as });
    assert.equal(gas.success, true, JSON.stringify(gas).slice(0, 300));
    assert.deepEqual(norm(engine), norm(gas));
    assert.equal(ops.length, 0, 'a read must not write');
  });
}

test('report from Supabase carries the box and weight columns', () => {
  const { engine } = both('getReportData', { fromDate: ago(45), toDate: today }, { call: (G, p) => G('getReportData_')(p) });
  const withBox = engine.rows.filter((r: any) => r['Box']);
  assert.ok(withBox.length > 10, 'orders with box details');
  assert.equal(withBox[0]['Volumetric Weight (kg)'], 0.06);
  assert.ok(engine.rows.every((r: any) => 'Chargeable Weight (kg)' in r));
});

const WRITES: Array<[string, string, any, (G: any, p: any) => any, string[]]> = [
  ['save new manifest', 'saveOrderManifest', { manifest: { orderId: 'NEW-77', platform: 'D2C', items: [{ productName: 'Soap', sku: 'S1', quantity: 2 }], processedByName: 'Office' } }, (G, p) => G('saveOrderManifest_')(p), ['OrderManifest']],
  ['save existing manifest', 'saveOrderManifest', { manifest: { orderId: 'man-3', platform: 'Amazon', items: [{ productName: 'Soap', quantity: 1 }], status: 'Pending' } }, (G, p) => G('saveOrderManifest_')(p), ['OrderManifest']],
  ['save manifest batch', 'saveOrderManifestsBatch', { manifests: [{ orderId: 'B-1', items: [] }, { orderId: 'MAN-4', items: [{ productName: 'X', quantity: 3 }] }, { orderId: 'B-1', status: 'Pending' }] }, (G, p) => G('saveOrderManifestsBatch_')(p), ['OrderManifest']],
  ['manifest packed', 'updateManifestStatus', { orderId: 'MAN-5', status: 'Packed', packerDetails: { name: 'Packer 2', email: 'p2@vms.test', videoDriveUrl: 'https://drive/x' } }, (G, p) => G('updateManifestStatus_')(p), ['OrderManifest']],
  ['manifest not found', 'updateManifestStatus', { orderId: 'NOPE', status: 'Packed' }, (G, p) => G('updateManifestStatus_')(p), ['OrderManifest']],
  ['delete manifest', 'deleteOrderManifest', { orderId: 'MAN-6' }, (G, p) => G('deleteOrderManifest_')(p), ['OrderManifest']],
  ['pack verification', 'logPackVerification', { log: { orderId: 'MAN-1', status: 'MATCHED', totalRequired: 2, totalScanned: 2, scannedGtinsLog: [{ g: 1 }] } }, (G, p) => G('logPackVerification_')(p), ['PackVerificationLog']],
  ['download log', 'downloadLog', { orderId: 'ORD-1', platform: 'Amazon', fileName: 'a.mp4', fileSize: '1 MB', downloadType: 'single' }, (G, p) => G('downloadLog_')(p), ['DownloadLog']],
  ['save product', 'saveGtinProduct', { product: { gtin: '8901000000005', sku: 'SKU5b', productName: 'Renamed', tag: 'Active-online' } }, (G, p) => G('saveGtinProduct_')(p), ['GTINCatalog']],
  ['add product', 'saveGtinProduct', { product: { gtin: '1234567890123', sku: 'NEW', productName: 'New one' } }, (G, p) => G('saveGtinProduct_')(p), ['GTINCatalog']],
  ['delete product', 'deleteGtinProduct', { gtin: '8901000000007' }, (G, p) => G('deleteGtinProduct_')(p), ['GTINCatalog']],
  ['catalog batch', 'saveGtinCatalogBatch', { products: [{ gtin: '8901000000001', productName: 'Upd', tag: 'Active-online' }, { gtin: '999', productName: 'Brand new' }] }, (G, p) => G('saveGtinCatalogBatch_')(p), ['GTINCatalog']],
];

for (const [name, action, payload, call, tabsToCheck] of WRITES) {
  test('same write as Apps Script: ' + name, () => {
    const { gas, engine, rt, tabs } = both(action, payload, { call });
    assert.deepEqual(norm(engine), norm(gas));
    for (const tab of tabsToCheck) assert.deepEqual(replicaRows(tabs, tab), sheetRows(rt, tab), tab + ' rows differ');
  });
}

test('rewriting a whole tab only sends the rows that changed (delete products batch)', () => {
  const run = both('deleteGtinProductsBatch', { gtins: ['8901000000002', '8901000000003'] }, { call: (G, p) => G('deleteGtinProductsBatch_')(p) });
  // The harness mock has no clearContents, so check the engine against the expected result directly.
  assert.equal(run.engine.success, true);
  assert.equal(run.engine.deletedCount ?? run.engine.deleted ?? 2, 2);
  const left = replicaRows(run.tabs, 'GTINCatalog').map((r: any) => String(r[1]));
  assert.equal(left.length, 58);
  assert.ok(!left.includes('8901000000002') && !left.includes('8901000000003'));
  const kinds = run.ops.map((o) => o.op);
  assert.deepEqual(kinds.filter((k) => k !== 'tab'), ['delete', 'delete'], JSON.stringify(run.ops.slice(0, 3)));
});

test('anything that needs Google Drive is handed back to Apps Script', () => {
  const data = fixtures();
  const G0 = factory({ console, __over: {} } as any);
  const tabs = makeReplica(data, G0('rowKey_'));
  // An order that is in no tab makes advancedSearch_ try Google Drive directly.
  assert.throws(() => runEngine(factory, {
    user: { email: 'admin@vms.test', name: 'A', role: 'Admin' },
    tabs: (n) => tabs.get(n) || null,
    tabVersion: () => 'v',
  }, (G) => G('advancedSearch_')({ orderId: 'NOT-IN-ANY-TAB' })), /Not available in the browser: DriveApp/);
});

test('formatDate matches Apps Script patterns in India time', () => {
  const d = new Date('2026-11-26T18:45:07Z'); // 00:15 on 27 Nov in India
  assert.equal(formatDate(d, 'Asia/Kolkata', 'dd-MMM-yy HH:mm'), '27-Nov-26 00:15');
  assert.equal(formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd'), '2026-11-27');
  assert.equal(formatDate(d, 'Asia/Kolkata', 'hh:mm a'), '12:15 AM');
  assert.equal(formatDate(d, 'Asia/Kolkata', "MMM-yyyy"), 'Nov-2026');
  assert.equal(formatDate(d, 'Asia/Kolkata', '_yyyyMMdd_HHmmss'), '_20261127_001507');
});
