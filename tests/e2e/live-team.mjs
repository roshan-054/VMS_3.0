// E2E: the admin's Live Team page shows each user's work as it happens: online, the page they
// have open, the order they are scanning, today's totals, their upload queue and last action.
// Packer and admin in two browsers, Supabase (local Postgres) in front, Apps Script at 1.5 s.
// Needs a local Postgres (tests/supabase/pg-setup.cjs) and the dev server on :5179.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { createMockBackend, attach } = require('./mockBackend.cjs');
const { pgAvailable, createTestDb, spawnFakeSupabase } = require('../supabase/pg-setup.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
if (!(await pgAvailable())) { console.log('SKIP: no local Postgres'); process.exit(0); }
const db = await createTestDb();
const sb = await spawnFakeSupabase(db.url);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 140) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backend = createMockBackend({ latencyMs: 1500, latencyByAction: { startUpload: 120000 } });
const { rt } = backend;
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
rt.sandbox.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => ({}) }; return b; }, deleteTrigger() {} };
const PACKER = { email: 'vineet@test.local', password: 'PackerPass1', name: 'Vineet' };
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
rt.sheets.get('Users').appendRow([new Date(), PACKER.name, PACKER.email, sha(PACKER.password), 'User', 'Approved']);
rt.sheets.get('Users').appendRow([new Date(), 'Ravi Away', 'ravi@test.local', sha('x'), 'User', 'Approved']);
// Today's work already in the Sheet: 3 recordings and 2 uploads by Vineet, 1 by Ravi.
const OL = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
const UL = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
rt.sheets.get('OrderLog').rows[0] = OL;
rt.sheets.get('UploadLog').rows[0] = UL;
const ago = (m) => new Date(Date.now() - m * 60000);
for (let i = 0; i < 3; i++) rt.sheets.get('OrderLog').rows.push([ago(40 - i), 'TODAY-' + i, 'Amazon', PACKER.email, 'fid' + i + 'xxxxxx', '', '1 MB', 'Completed', 'Forward', 'j' + i, 'video/mp4', 'Ready']);
for (let i = 0; i < 2; i++) rt.sheets.get('UploadLog').rows.push([ago(39 - i), 'TODAY-' + i, 'Amazon', PACKER.email, 'f.mp4', '1 MB', 'u' + i, 'Uploaded', 100, 'fid' + i + 'xxxxxx', 'Completed', '', 'Forward', 'Recorder', 'j' + i]);
rt.sheets.get('OrderLog').rows.push([ago(90), 'RAVI-1', 'D2C', 'ravi@test.local', 'fidRxxxxxxx', '', '1 MB', 'Completed', 'Forward', 'jr', 'video/mp4', 'Ready']);
rt.props.set('SUPABASE_URL', sb.url);
rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey);
rt.props.set('SUPABASE_ENABLED', 'true');
const adminTok = rt.call('login', { email: backend.ADMIN.email, password: backend.ADMIN.password }).token;
backend.rt.sheets.get('Users').rows[1][4] = 'Super Admin';
const imp = rt.call('supabaseImport', { token: adminTok });
check('Sheet copied to Supabase', imp.success, imp.error || '');

async function signIn(page, who) {
  await page.goto(BASE);
  await page.getByPlaceholder(/email/i).first().fill(who.email);
  await page.locator('input[type="password"]').first().fill(who.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
  await page.waitForSelector('text=Scan & Record', { timeout: 30000 });
}

const browser = await chromium.launch();
try {
  const packer = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  for (const p of [packer, admin]) await attach(p, backend);
  await signIn(packer, PACKER);
  check('packers do not get the Live Team page', (await packer.locator('#nav-item-team').count()) === 0);
  await packer.evaluate(async () => {
    const { dbPutQueue } = await import('/src/lib/storage.ts');
    const blob = () => new Blob([new Uint8Array(500)], { type: 'video/mp4' });
    const base = { platform: 'Amazon', recordingType: 'Forward', mimeType: 'video/mp4', source: 'Automatic Recording', recordingDate: '2026-11-26', fileSize: 500 };
    for (let i = 0; i < 4; i++) await dbPutQueue({ ...base, id: 'w' + i, createdAt: Date.now() - i, orderId: 'WAIT-' + i, fileName: `W${i}.mp4`, blob: blob(), status: 'pending', progress: 0 });
    await dbPutQueue({ ...base, id: 'f0', createdAt: Date.now() - 9, orderId: 'FAIL-0', fileName: 'F.mp4', blob: blob(), status: 'failed', progress: 0, error: 'Network' });
    window.dispatchEvent(new Event('ops_queue_updated'));
  });

  await signIn(admin, backend.ADMIN);
  await admin.locator('#nav-item-team').click();
  await admin.waitForSelector('#live-team', { timeout: 15000 });
  const card = (email) => admin.locator(`[data-user="${email}"]`);
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(200); } return v; };

  // Today's totals and online state.
  const today = await waitFor(async () => { const v = await card(PACKER.email).locator('[data-today]').getAttribute('data-today').catch(() => ''); return v === '3/2/0' ? v : ''; });
  check("today's totals from the Sheet (recorded/uploaded/packed)", today === '3/2/0', today || (await card(PACKER.email).locator('[data-today]').getAttribute('data-today').catch(() => 'no card')));
  const online = await waitFor(async () => (await card(PACKER.email).getAttribute('data-state').catch(() => '')) === 'online');
  check('packer shows Online', online, await card(PACKER.email).getAttribute('data-state').catch(() => ''));
  check('user who is not signed in shows Offline', (await card('ravi@test.local').getAttribute('data-state').catch(() => '')) === 'offline');
  const packerCounts = () => packer.evaluate(async () => {
    const { dbGetAllQueue } = await import('/src/lib/storage.ts');
    const { queueCounts } = await import('/src/lib/queueCounts.ts');
    const c = queueCounts(await dbGetAllQueue());
    return `${c.waiting}/${c.uploading}/${c.failed}`;
  });
  let pc = '';
  const q = await waitFor(async () => { pc = await packerCounts(); return (await card(PACKER.email).locator('[data-station-counts]').getAttribute('data-station-counts').catch(() => '')) === pc; });
  check('upload queue matches the packer (waiting/uploading/failed)', q, `packer ${pc} · admin ${await card(PACKER.email).locator('[data-station-counts]').getAttribute('data-station-counts').catch(() => '')}`);
  check('page shows live (Supabase)', (await admin.locator('#live-team-mode').innerText()) === 'Live', await admin.locator('#live-team-mode').innerText());

  // The packer scans an order: the admin sees the page and the order within a couple of seconds.
  await packer.locator('#orderIdInput').fill('405-7777777-1234567');
  const t0 = Date.now();
  const seen = await waitFor(async () => ((await card(PACKER.email).locator('[data-order]').innerText().catch(() => '')) === '405-7777777-1234567'), 10000);
  const ms = Date.now() - t0;
  check('admin sees the order being scanned', seen, `${(ms / 1000).toFixed(1)} s`);
  check('within 3 s', seen && ms <= 3000, `${(ms / 1000).toFixed(1)} s`);
  check('admin sees which page is open', (await card(PACKER.email).locator('[data-page]').innerText()) === 'Scan & Record', await card(PACKER.email).locator('[data-page]').innerText());

  // An action on the packer's computer shows as their last action.
  await packer.evaluate(async () => { const { noteAction } = await import('/src/lib/stationActivity.ts'); noteAction('Packed ORD-55'); });
  const last = await waitFor(async () => /Packed ORD-55/.test(await card(PACKER.email).locator('[data-last]').innerText().catch(() => '')), 10000);
  check('last action appears', last, await card(PACKER.email).locator('[data-last]').innerText().catch(() => ''));

  // Packers cannot read the board, even with the Supabase key.
  const denied = await packer.evaluate(async () => {
    const { requestApi } = await import('/src/lib/api.ts');
    try { const r = await requestApi('getTeamActivity', {}); return r && r.success ? 'allowed' : (r && r.error) || 'refused'; } catch (e) { return e.message; }
  });
  check('packer cannot read the team board', denied !== 'allowed', denied);
  await admin.locator('#live-team').screenshot({ path: process.env.SHOT || '/tmp/claude-0/live-team.png' });

  // Supabase down: the board keeps working through Apps Script.
  await admin.route(sb.url + '/**', (r) => r.abort());
  await packer.route(sb.url + '/**', (r) => r.abort());
  await packer.locator('#orderIdInput').fill('405-8888888-0000001');
  const fb = await waitFor(async () => ((await card(PACKER.email).locator('[data-order]').innerText().catch(() => '')) === '405-8888888-0000001'), 30000);
  check('Supabase down: still updates via Apps Script', fb, await admin.locator('#live-team-mode').innerText());
} finally {
  await browser.close();
  try { sb.kill(); } catch {}
  try { await db.drop(); } catch {}
}
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
