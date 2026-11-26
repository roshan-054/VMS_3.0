// E2E: the app reads and saves in Supabase (a real local Postgres with supabase/vms_schema.sql
// behind a stand-in for the Supabase API), Apps Script copies changes into the Google Sheet, the
// backup downloads in the Sheet's layout, and the app falls back to Apps Script when Supabase is
// down. Apps Script is the real Code.gs (harness) with 1.5 s of latency, like the live one.
//
// Needs a local Postgres (see tests/supabase/pg-setup.cjs) and the dev server on :5179.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const XLSX = require('xlsx');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { pgAvailable, createTestDb, spawnFakeSupabase } = require('../supabase/pg-setup.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
if (!(await pgAvailable())) { console.log('SKIP: no local Postgres'); process.exit(0); }
const db = await createTestDb();
const sb = await spawnFakeSupabase(db.url);

const results = [];
const check = (name, ok, detail = '') => { results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 140) }); };
const cleanup = async () => { try { sb.kill(); } catch {} try { await db.drop(); } catch {} };

try {
  const backend = createMockBackend({ latencyMs: 1500 });
  const { rt } = backend;
  // Apps Script side: real HTTP to the Supabase stand-in.
  rt.sandbox.UrlFetchApp = {
    fetch(url, opts = {}) {
      const args = ['-s', '--noproxy', '*', '-X', String(opts.method || 'get').toUpperCase(), '-w', '\n%{http_code}', '-H', 'Content-Type: application/json'];
      Object.entries(opts.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
      if (opts.payload !== undefined) args.push('--data-binary', '@-');
      const out = execFileSync('curl', [...args, url], { input: opts.payload || '', maxBuffer: 1 << 28 }).toString();
      const i = out.lastIndexOf('\n');
      return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
    },
  };
  rt.sandbox.LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }), getUserLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
  const triggers = [];
  rt.sandbox.ScriptApp = { getProjectTriggers: () => triggers, newTrigger: (fn) => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => triggers.push({ getHandlerFunction: () => fn }) }; return b; }, deleteTrigger() {} };

  // A realistic Sheet: 3,000 recordings, 400 upload rows, 300 orders, 100 products.
  const H = {
    OrderLog: ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'],
    UploadLog: ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'],
    OrderManifest: ['Timestamp','Order ID','Platform','Assigned Packer Name','Assigned Packer Email','Processed By Name','Processed By Email','Total Items Count','Items List','Status','Notes','Packed At','Packed By Name','Video Drive Link'],
    GTINCatalog: ['Timestamp','GTIN','SKU','Product Name','Short Name','Category','Image URL','Default Quantity','Notes','Tag'],
    DownloadLog: ['Timestamp','Order ID','Platform','User Email','File Name','File Size','Download Type','Recording Type'],
  };
  Object.entries(H).forEach(([n, h]) => { rt.sheets.get(n).rows[0] = h; });
  const now = Date.now();
  const ol = rt.sheets.get('OrderLog').rows;
  for (let i = 0; i < 3000; i++) {
    ol.push([new Date(now - i * 15 * 60000), `405-${1000000 + i}-${2000000 + i}`, ['Amazon', 'D2C', 'JioMart'][i % 3], backend.ADMIN.email, 'fid' + i + 'xxxxxx', '', '12 MB', 'Completed', 'Forward', 'job-' + i, 'video/mp4', 'Ready']);
  }
  const ul = rt.sheets.get('UploadLog').rows;
  for (let i = 0; i < 400; i++) ul.push([new Date(now - i * 15 * 60000), `405-${1000000 + i}-${2000000 + i}`, 'Amazon', backend.ADMIN.email, 'f.mp4', '12 MB', 'up-' + i, 'Uploaded to Google Drive', 100, 'fid' + i + 'xxxxxx', 'Completed', '', 'Forward', 'Recorder', 'job-' + i]);
  const om = rt.sheets.get('OrderManifest').rows;
  for (let i = 0; i < 300; i++) om.push([new Date(now - i * 60000), 'MAN-' + i, 'Amazon', 'Test Admin', backend.ADMIN.email, 'Test Admin', backend.ADMIN.email, 1, 'Soap [S1] x 1', i % 2 ? 'Packed' : 'Pending', '', '', '', '']);
  const gc = rt.sheets.get('GTINCatalog').rows;
  for (let i = 0; i < 100; i++) gc.push([new Date(now - i * 86400000), String(8901000000000 + i), 'SKU' + i, 'Product ' + i, 'P' + i, 'Active-online', '', 1, '', 'Active-online']);

  rt.props.set('SUPABASE_URL', sb.url);
  rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
  rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey);
  rt.props.set('SUPABASE_ENABLED', 'true');
  const adminToken = rt.call('login', { email: backend.ADMIN.email, password: backend.ADMIN.password }).token;
  const t0 = Date.now();
  const imp = rt.call('supabaseImport', { token: adminToken });
  check('first copy of the Sheet into Supabase', imp.success, `${imp.results.map((r) => r.tab + ':' + (r.total ?? r.error)).join(' ')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const sbCalls = [];
  page.on('request', (r) => { if (r.url().startsWith(sb.url)) sbCalls.push(r.url().split('/rpc/')[1]); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 200)); });
  await attach(page, backend);
  await login(page, BASE, backend);
  const gasCalls = (a) => backend.calls.filter((c) => c.action === a).length;
  await page.waitForFunction(() => !!localStorage.getItem('vms_supabase_cfg'), null, { timeout: 20000 });
  check('station picked up the Supabase address from Apps Script', true, await page.evaluate(() => localStorage.getItem('vms_supabase_cfg')));
  const leaked = await page.evaluate((k) => JSON.stringify(localStorage).includes(k), sb.serviceKey);
  check('service key never reaches the browser', !leaked);

  // ---- Search Videos
  await page.locator('#nav-item-search').click();
  await page.waitForSelector('#searchQueryInput', { timeout: 20000 });
  const before = gasCalls('advancedSearch');
  await page.fill('#searchQueryInput', '405-1000123');
  let ts = Date.now();
  await page.click('#search-orders-submit-btn');
  await page.waitForSelector('text=405-1000123-2000123', { timeout: 30000 });
  const firstSearchMs = Date.now() - ts;
  await page.fill('#searchQueryInput', '405-1002999');
  ts = Date.now();
  await page.click('#search-orders-submit-btn');
  await page.waitForSelector('text=405-1002999-2002999', { timeout: 30000 });
  const searchMs = Date.now() - ts;
  check('search answered by Supabase (no Apps Script call)', gasCalls('advancedSearch') === before, `first search ${firstSearchMs} ms (downloads this station's copy), next ${searchMs} ms`);

  // ---- Upload Logs
  const ulBefore = gasCalls('getUploadLogs');
  await page.locator('#nav-item-logs').click();
  await page.waitForSelector('#upload-logs-container', { timeout: 20000 });
  await page.waitForSelector('text=405-1000001-2000001', { timeout: 20000 });
  check('upload logs answered by Supabase', gasCalls('getUploadLogs') === ulBefore, `${gasCalls('getUploadLogs') - ulBefore} Apps Script calls`);

  // ---- Analytics
  const anBefore = gasCalls('getAnalyticsData');
  await page.locator('#nav-item-analytics').click();
  await page.waitForTimeout(4000);
  check('analytics answered by Supabase', gasCalls('getAnalyticsData') === anBefore, `${gasCalls('getAnalyticsData') - anBefore} Apps Script calls`);

  // ---- a save goes to Supabase, then into the Sheet in the background
  const saveBefore = gasCalls('saveOrderManifest');
  ts = Date.now();
  const saved = await page.evaluate(async () => {
    const api = await import('/src/lib/api.ts');
    return api.requestApi('saveOrderManifest', { manifest: { orderId: 'E2E-NEW-1', platform: 'Amazon', items: [{ productName: 'Soap', sku: 'S1', quantity: 2 }], processedByName: 'Test Admin' } });
  });
  const saveMs = Date.now() - ts;
  check('save answered by Supabase', saved.success && gasCalls('saveOrderManifest') === saveBefore, `${saveMs} ms, version ${saved.version}`);
  const inSheet = async () => rt.sheets.get('OrderManifest').rows.some((r) => r[1] === 'E2E-NEW-1');
  let waited = 0;
  while (!(await inSheet()) && waited < 15000) { await new Promise((r) => setTimeout(r, 250)); waited += 250; }
  check('the new order reaches the Google Sheet in the background', await inSheet(), `${((saveMs + waited) / 1000).toFixed(1)} s after saving (syncSheetNow pings: ${gasCalls('syncSheetNow')})`);
  const st = await (await fetch(sb.url + '/rest/v1/rpc/vms_service_status', { method: 'POST', headers: { apikey: sb.serviceKey, 'Content-Type': 'application/json' }, body: '{}' })).json();
  check('nothing left waiting for the Sheet', st.pendingSheetWrites === 0, JSON.stringify(st.tabs));

  // An order added through Apps Script (another station on the old path) shows up via Supabase.
  rt.call('saveOrderManifest', { token: adminToken, manifest: { orderId: 'FROM-SHEET-9', platform: 'D2C', items: [] } });
  const list = await page.evaluate(async () => {
    const api = await import('/src/lib/api.ts');
    await new Promise((r) => setTimeout(r, 1600));
    return api.requestApi('getOrderManifests', {});
  });
  check('rows saved by Apps Script are visible through Supabase', list.manifests.some((m) => m.orderId === 'FROM-SHEET-9') && list.manifests.some((m) => m.orderId === 'E2E-NEW-1'), `${list.manifests.length} orders`);

  // ---- Settings: status + backup
  await page.locator('#nav-item-settings').click();
  await page.waitForSelector('#supabase-status', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#supabase-status')?.textContent === 'Connected', null, { timeout: 20000 });
  check('Settings shows Supabase connected', true, (await page.textContent('#supabase-rows')) + ' rows');
  await page.screenshot({ path: 'tests/e2e/out-supabase-settings.png', fullPage: false });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#backup-download')]);
  const file = await dl.path();
  const wb = XLSX.read(fs.readFileSync(file), { cellDates: true, cellNF: true });
  const olSheet = XLSX.utils.sheet_to_json(wb.Sheets.OrderLog, { header: 1 });
  const a2 = wb.Sheets.OrderLog.A2;
  check('backup: all tabs, Sheet columns, DD-MMM-YY dates', wb.SheetNames.length === 11 && olSheet.length === 3001 && olSheet[0][1] === 'Order ID' && a2.z === 'dd-mmm-yy hh:mm',
    `${dl.suggestedFilename()}: ${wb.SheetNames.join(',')}; OrderLog ${olSheet.length - 1} rows; A2 format ${a2.z}`);
  const users = XLSX.utils.sheet_to_json(wb.Sheets.Users, { header: 1 });
  check('backup: no passwords', users.slice(1).every((r) => !r[3]), `${users.length - 1} users`);

  await page.click('#backup-mode-range');
  const day = (d) => new Date(now - d * 86400000).toISOString().slice(0, 10);
  await page.fill('#backup-from', day(2));
  await page.fill('#backup-to', day(0));
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#backup-download')]);
  const wb2 = XLSX.read(fs.readFileSync(await dl2.path()), { cellDates: true });
  const ol2 = XLSX.utils.sheet_to_json(wb2.Sheets.OrderLog, { header: 1 }).length - 1;
  const gc2 = XLSX.utils.sheet_to_json(wb2.Sheets.GTINCatalog, { header: 1 }).length - 1;
  check('backup: date range keeps only those days (catalog in full)', ol2 > 150 && ol2 < 300 && gc2 === 100, `${dl2.suggestedFilename()}: OrderLog ${ol2} rows, GTINCatalog ${gc2}`);

  // ---- Supabase down: the app keeps working through Apps Script
  sb.kill();
  await new Promise((r) => setTimeout(r, 500));
  const gBefore = gasCalls('advancedSearch');
  ts = Date.now();
  const res = await page.evaluate(async () => {
    const api = await import('/src/lib/api.ts');
    return api.requestApi('advancedSearch', { orderId: '405-1000050' });
  });
  check('Supabase down: search still works via Apps Script', res.success && res.results.length >= 1 && gasCalls('advancedSearch') === gBefore + 1, `${Date.now() - ts} ms, ${res.results.length} result(s)`);

  console.log('Supabase calls from the browser:', Object.entries(sbCalls.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {})).map(([k, v]) => k + '×' + v).join(', '));
  await browser.close();
} catch (e) {
  check('run', false, e.stack || e.message);
} finally {
  await cleanup();
}
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
