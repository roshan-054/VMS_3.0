// Apps Script <-> Supabase sync, run against a real local Postgres with supabase/vms_schema.sql.
// Skipped automatically when no local Postgres is available (see tests/supabase/pg-setup.cjs).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { createRuntime } = require('./gas-harness.cjs');
const { pgAvailable, createTestDb, spawnFakeSupabase } = require('../../tests/supabase/pg-setup.cjs');

function curlFetch(url, opts = {}) {
  const args = ['-s', '--noproxy', '*', '-X', String(opts.method || 'get').toUpperCase(), '-w', '\n%{http_code}'];
  if (opts.contentType) args.push('-H', 'Content-Type: ' + opts.contentType);
  Object.entries(opts.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (opts.payload !== undefined) args.push('--data-binary', '@-');
  const out = execFileSync('curl', [...args, url], { input: opts.payload || '', maxBuffer: 1 << 28 }).toString();
  const i = out.lastIndexOf('\n');
  const body = out.slice(0, i);
  const code = Number(out.slice(i + 1));
  return { getResponseCode: () => code, getContentText: () => body };
}

async function rpc(sb, fn, args, key) {
  const r = await fetch(sb.url + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: key || sb.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}),
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  if (!r.ok) { const e = new Error(body && body.message); e.status = r.status; throw e; }
  return body;
}

function setup(sb) {
  const rt = createRuntime({ users: [[new Date(), 'Admin One', 'admin@vms.test', null, 'Super Admin', 'Approved']] });
  rt.sheets.get('Users').rows[1][3] = rt.hash('Secret123!');
  const triggers = [];
  rt.sandbox.UrlFetchApp = { fetch: curlFetch };
  rt.sandbox.LockService = {
    getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }),
    getUserLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }),
  };
  rt.sandbox.ScriptApp = {
    getProjectTriggers: () => triggers,
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (fn) => {
      const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
      return b;
    },
  };
  rt.triggers = triggers;
  // Real sheet headers, like setupSystem() creates them.
  const H = {
    OrderLog: ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'],
    DownloadLog: ['Timestamp','Order ID','Platform','User Email','File Name','File Size','Download Type','Recording Type'],
    OrderManifest: ['Timestamp','Order ID','Platform','Assigned Packer Name','Assigned Packer Email','Processed By Name','Processed By Email','Total Items Count','Items List','Status','Notes','Packed At','Packed By Name','Video Drive Link'],
    GTINCatalog: ['Timestamp','GTIN','SKU','Product Name','Short Name','Category','Image URL','Default Quantity','Notes','Tag'],
  };
  Object.entries(H).forEach(([n, h]) => { rt.sheets.get(n).rows[0] = h; });
  rt.sheets.get('Users').rows[0] = ['Timestamp','Full Name','Email','Password','Role','Status'];
  return rt;
}

test('Supabase sync with the Google Sheet', async (t) => {
  if (!(await pgAvailable())) { t.skip('no local Postgres'); return; }
  const db = await createTestDb();
  const sb = await spawnFakeSupabase(db.url);
  t.after(async () => { sb.kill(); await db.drop(); });

  const rt = setup(sb);
  rt.sheets.get('OrderLog').rows.push(
    [new Date('2026-11-20T10:00:00Z'), '405-1111111-1111111', 'Amazon', 'p@vms.test', 'fileA123456', '', '1.2 MB', 'Completed', 'Forward', 'job-1', 'video/mp4', 'Ready'],
    [new Date('2026-11-21T10:00:00Z'), '405-2222222-2222222', 'Amazon', 'p@vms.test', 'fileB123456', '', '2.0 MB', 'Completed', 'Forward', 'job-2', 'video/mp4', 'Ready'],
  );
  rt.sheets.get('GTINCatalog').rows.push([new Date('2026-11-01T00:00:00Z'), '08901234567890', 'SKU1', 'Soap', 'Soap', 'Active-online', '', 1, '', 'Active-online']);

  const login0 = rt.call('login', { email: 'admin@vms.test', password: 'Secret123!' });
  assert.equal(login0.success, true);

  // --- settings: wrong key is refused, right keys are saved and the trigger is installed
  const bad = rt.call('saveSupabaseConfig', { token: login0.token, url: sb.url.replace('http:', 'https:'), anonKey: sb.anonKey, serviceKey: 'nope' });
  assert.equal(bad.success, false);
  // the test server is plain http; store the config directly like saveSupabaseConfig would
  rt.props.set('SUPABASE_URL', sb.url); rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
  rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey); rt.props.set('SUPABASE_ENABLED', 'true');
  const cfg = rt.call('getSupabaseConfig', { token: login0.token });
  assert.equal(cfg.connected, true, JSON.stringify(cfg));
  assert.equal(cfg.status.schemaVersion, 2);

  // --- branding tells every station where Supabase is (anon key only)
  const br = rt.call('getBranding', {});
  assert.equal(br.supabaseEnabled, true);
  assert.equal(br.supabaseUrl, sb.url);
  assert.equal(br.supabaseAnonKey, sb.anonKey);
  assert.ok(!JSON.stringify(br).includes(sb.serviceKey), 'service key must never be sent to the browser');

  // --- sign-in is copied to Supabase
  const login = rt.call('login', { email: 'admin@vms.test', password: 'Secret123!' });
  const me = await rpc(sb, 'vms_whoami', { p_token: login.token });
  assert.equal(me.email, 'admin@vms.test');
  assert.equal(me.role, 'Super Admin');

  // --- first copy of the Sheet
  const imp = rt.call('supabaseImport', { token: login.token });
  assert.equal(imp.success, true, JSON.stringify(imp));
  assert.equal(rt.triggers.length, 1);
  let pull = await rpc(sb, 'vms_pull', { p_token: login.token });
  const byTab = (rows, tab) => rows.filter((r) => r.t === tab && !r.d);
  assert.equal(byTab(pull.rows, 'OrderLog').length, 2);
  assert.equal(byTab(pull.rows, 'GTINCatalog').length, 1);
  const users = byTab(pull.rows, 'Users');
  assert.equal(users.length, 1);
  assert.equal(users[0].v[3] || '', '', 'password hash must not be copied');
  const ol = byTab(pull.rows, 'OrderLog').sort((a, b) => a.s - b.s);
  assert.deepEqual(ol[0].v[0], { $d: '2026-11-20T10:00:00.000Z' });
  assert.equal(ol[1].v[1], '405-2222222-2222222');
  const cursor1 = pull.cursor;

  // --- running the import again changes nothing
  const imp2 = rt.call('supabaseImport', { token: login.token });
  assert.ok(imp2.results.every((r) => !r.inserted && !r.updated && !r.deleted), JSON.stringify(imp2.results));

  // --- the app adds a manifest in Supabase -> written into the Sheet by syncSheetNow
  const ins = await rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [
    { op: 'insert', tab: 'OrderManifest', key: 'o:ord-9', vals: ['26-Nov-26 10:00', 'ORD-9', 'Amazon', '', '', 'A', 'a@x', 2, 'Soap x 2', 'Pending', '', '', '', ''] },
  ] });
  const manifestId = ins.rows[0].id;
  let st = (await rpc(sb, 'vms_service_status', {}, sb.serviceKey));
  assert.equal(st.pendingSheetWrites, 1);
  assert.equal(rt.call('syncSheetNow', { token: login.token }).appended, 1);
  let mRows = rt.sheets.get('OrderManifest').rows;
  assert.equal(mRows.length, 2);
  assert.equal(mRows[1][1], 'ORD-9');
  st = (await rpc(sb, 'vms_service_status', {}, sb.serviceKey));
  assert.equal(st.pendingSheetWrites, 0);

  // --- update in place, then delete
  await rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [
    { op: 'update', id: manifestId, key: 'o:ord-9', vals: ['26-Nov-26 10:00', 'ORD-9', 'Amazon', '', '', 'A', 'a@x', 2, 'Soap x 2', 'Packed', '', '', '', ''], version: ins.rows[0].n },
  ] });
  rt.call('syncSheetNow', { token: login.token });
  mRows = rt.sheets.get('OrderManifest').rows;
  assert.equal(mRows.length, 2);
  assert.equal(mRows[1][9], 'Packed');
  // stale version is refused
  await assert.rejects(rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [{ op: 'update', id: manifestId, vals: [], version: 1 }] }), /VMS_CONFLICT/);
  await rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [{ op: 'delete', id: manifestId }] });
  rt.call('syncSheetNow', { token: login.token });
  assert.equal(rt.sheets.get('OrderManifest').rows.length, 1);

  // --- the app may not write tabs Apps Script owns, and may not call sync functions
  await assert.rejects(rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [{ op: 'insert', tab: 'OrderLog', key: 'x', vals: ['x'] }] }), /VMS_FORBIDDEN/);
  await assert.rejects(rpc(sb, 'vms_sync_claim', { p_limit: 1 }), (e) => e.status === 401);
  await assert.rejects(rpc(sb, 'vms_reconcile_tab', { p_tab: 'Users', p_headers: [], p_rows: [], p_started_at: new Date().toISOString(), p_allow_delete: true }), (e) => e.status === 401);
  await assert.rejects(rpc(sb, 'vms_pull', { p_token: 'not-a-session' }), /VMS_AUTH/);

  // --- rows Apps Script writes are copied to Supabase in the same request, not sent back to the Sheet
  assert.equal(rt.call('downloadLog', { token: login.token, orderId: 'ORD-1', platform: 'Amazon', fileName: 'a.mp4', fileSize: '1 MB', downloadType: 'single' }).success, true);
  pull = await rpc(sb, 'vms_pull', { p_token: login.token, p_since: cursor1 });
  const dl = byTab(pull.rows, 'DownloadLog');
  assert.equal(dl.length, 1);
  assert.equal(dl[0].v[1], 'ORD-1');
  st = (await rpc(sb, 'vms_service_status', {}, sb.serviceKey));
  assert.equal(st.pendingSheetWrites, 0, 'Apps Script rows must not echo back');
  assert.equal(rt.sheets.get('DownloadLog').rows.length, 2);

  // --- an admin tool removes a row in the Sheet -> removed in Supabase too
  rt.sheets.get('OrderLog').rows.splice(1, 1); // as if deleteLogEntry removed it
  rt.call('cleanupStuckUploads', { token: login.token }); // touches UploadLog only
  rt.sandbox.SB_TOUCH_ = null;
  rt.sandbox.sbTouchTabs_(['OrderLog']);
  rt.sandbox.sbFlush_(false);
  pull = await rpc(sb, 'vms_pull', { p_token: login.token, p_since: cursor1 });
  const gone = pull.rows.filter((r) => r.t === 'OrderLog' && r.d);
  assert.equal(gone.length, 1);

  // --- an app change made while Apps Script compares a tab is never lost
  const started = await rpc(sb, 'vms_now', {}, sb.serviceKey);
  await rpc(sb, 'vms_apply', { p_token: login.token, p_ops: [
    { op: 'insert', tab: 'OrderManifest', key: 'o:ord-10', vals: ['x', 'ORD-10'] },
  ] });
  const rec = rt.sandbox.sbReconcileTab_('OrderManifest', true, started);
  assert.equal(rec.deleted, 0);
  rt.call('syncSheetNow', { token: login.token });
  assert.equal(rt.sheets.get('OrderManifest').rows[1][1], 'ORD-10');

  // --- Supabase down: the copy waits and is sent by the next trigger run
  rt.props.set('SUPABASE_URL', 'http://127.0.0.1:1');
  rt.call('downloadLog', { token: login.token, orderId: 'ORD-2', platform: 'Amazon' });
  assert.ok(rt.cache.get('SB_PENDING'), 'pending copy kept');
  rt.props.set('SUPABASE_URL', sb.url);
  rt.sandbox.sbSyncTick();
  pull = await rpc(sb, 'vms_pull', { p_token: login.token, p_tabs: ['DownloadLog'] });
  assert.ok(pull.rows.some((r) => r.v[1] === 'ORD-2'));

  // --- live station status: a packer writes its own report, only admins can read the reports
  const ptoken = 'packer-token-for-station-test';
  const phash = require('crypto').createHash('sha256').update(ptoken).digest('hex');
  await rpc(sb, 'vms_session_put', { p_token_hash: phash, p_email: 'Vineet@vms.test', p_name: 'Vineet', p_role: 'User', p_expires_at: new Date(Date.now() + 3600e3).toISOString() }, sb.serviceKey);
  const report = { email: 'someone-else@vms.test', items: [{ id: 'q1', orderId: 'A-1', status: 'uploading', progress: 40 }], counts: { waiting: 10, uploading: 2, failed: 1, duplicate: 0, completed: 3, total: 16 }, recording: false, online: true, worker: '' };
  const put = await rpc(sb, 'vms_station_report', { p_token: ptoken, p_report: report });
  assert.ok(put.version > 0 && put.reportedAt > 0);
  await assert.rejects(rpc(sb, 'vms_station_list', { p_token: ptoken }), /VMS_FORBIDDEN/, 'packers cannot read other stations');
  await assert.rejects(rpc(sb, 'vms_station_report', { p_token: 'nope', p_report: report }), /VMS_AUTH/);
  await assert.rejects(rpc(sb, 'vms_station_report', { p_token: ptoken, p_report: [1] }), /VMS_BAD_REQUEST/);
  let list = await rpc(sb, 'vms_station_list', { p_token: login.token, p_since: 0 });
  assert.equal(list.changed, true);
  assert.equal(list.stations.length, 1);
  assert.equal(list.stations[0].email, 'vineet@vms.test', 'stored under the signed-in email, not the one in the report');
  assert.equal(list.stations[0].name, 'Vineet');
  assert.deepEqual(list.stations[0].counts, report.counts);
  const same = await rpc(sb, 'vms_station_list', { p_token: login.token, p_since: list.version });
  assert.equal(same.changed, false);
  assert.equal(same.stations, undefined, 'nothing sent again when nothing changed');
  await rpc(sb, 'vms_station_report', { p_token: ptoken, p_report: { ...report, counts: { ...report.counts, uploading: 1, completed: 4 } } });
  list = await rpc(sb, 'vms_station_list', { p_token: login.token, p_since: list.version });
  assert.equal(list.changed, true);
  assert.equal(list.stations.length, 1, 'one row per station');
  assert.equal(list.stations[0].counts.uploading, 1);
  await assert.rejects(rpc(sb, 'vms_station_list', { p_token: login.token }, 'wrong-key'), (e) => e.status === 401 || e.status === 403);

  // --- signing out removes the Supabase copy of the session
  rt.call('logout', { token: login.token });
  await assert.rejects(rpc(sb, 'vms_whoami', { p_token: login.token }), /VMS_AUTH/);
});

test('rowKey_ is stable across Sheet round trips', () => {
  const rt = createRuntime();
  const k = rt.sandbox.rowKey_;
  assert.equal(k('GTINCatalog', ['', '08901234567890']), k('GTINCatalog', ['', 8901234567890]));
  assert.equal(k('OrderManifest', ['', 'ord-1']), k('OrderManifest', ['', 'ORD-1 ']));
  assert.equal(k('DownloadLog', [new Date('2026-11-01T10:00:00.900Z'), 'A']), k('DownloadLog', [{ $d: '2026-11-01T10:00:00.100Z' }, 'A']));
  assert.equal(k('OrderLog', ['', '', '', '']), '');
  const keys = rt.sandbox.sheetKeys_('DownloadLog', [['h'], ['x', 'A'], ['x', 'A'], ['y']]);
  assert.deepEqual(keys, ['', 'r:x|a||', 'r:x|a||#2', 'r:y|||']);
});
