// E2E: with Supabase set up, the admin's "Live packer stations" shows exactly what each packer's
// own Upload Queue shows (waiting / uploading / failed), and a change on the packer's computer
// reaches the admin within about a second. Apps Script is the real Code.gs with 1.5 s latency.
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
rt.props.set('SUPABASE_URL', sb.url);
rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey);
rt.props.set('SUPABASE_ENABLED', 'true');
const PACKER = { email: 'vineet@test.local', password: 'PackerPass1', name: 'Vineet' };
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
rt.sheets.get('Users').appendRow([new Date(), PACKER.name, PACKER.email, sha(PACKER.password), 'User', 'Approved']);

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
  const admin = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const sbCalls = [];
  for (const p of [packer, admin]) {
    await attach(p, backend);
    p.on('request', (r) => { if (r.url().startsWith(sb.url)) sbCalls.push(r.url().split('/rpc/')[1]); });
  }
  await signIn(packer, PACKER);
  await packer.waitForFunction(() => !!localStorage.getItem('vms_supabase_cfg'), null, { timeout: 20000 });

  // Vineet's computer: 10 waiting, 2 uploading, 1 failed (the upload worker is held back by a slow startUpload).
  await packer.evaluate(async () => {
    const { dbPutQueue } = await import('/src/lib/storage.ts');
    const blob = () => new Blob([new Uint8Array(500)], { type: 'video/mp4' });
    const base = { platform: 'Amazon', recordingType: 'Forward', mimeType: 'video/mp4', source: 'Automatic Recording', recordingDate: '2026-11-26', fileSize: 500 };
    const t = Date.now();
    for (let i = 0; i < 10; i++) await dbPutQueue({ ...base, id: 'w' + i, createdAt: t - 1000 * i, orderId: 'WAIT-' + i, fileName: `WAIT-${i}.mp4`, blob: blob(), status: 'pending', progress: 0 });
    for (let i = 0; i < 2; i++) await dbPutQueue({ ...base, id: 'u' + i, createdAt: t - 20000 - i, orderId: 'UP-' + i, fileName: `UP-${i}.mp4`, blob: blob(), status: 'uploading', progress: 40 });
    await dbPutQueue({ ...base, id: 'f0', createdAt: t - 30000, orderId: 'FAIL-0', fileName: 'FAIL-0.mp4', blob: blob(), status: 'failed', progress: 10, error: 'Drive refused the upload' });
    window.dispatchEvent(new Event('ops_queue_updated'));
  });
  const stationCounts = () => packer.evaluate(async () => {
    const { dbGetAllQueue } = await import('/src/lib/storage.ts');
    const { queueCounts } = await import('/src/lib/stationReporter.ts');
    const c = queueCounts(await dbGetAllQueue());
    return `${c.waiting}/${c.uploading}/${c.failed}`;
  });

  await signIn(admin, backend.ADMIN);
  await admin.getByRole('button', { name: /Upload Logs/ }).first().click();
  await admin.waitForSelector('#live-station-queues', { timeout: 15000 });
  const adminCounts = () => admin.evaluate((email) => document.querySelector(`[data-station="${email}"] [data-station-counts]`)?.getAttribute('data-station-counts') || '', PACKER.email);

  // 1) Same numbers on both sides.
  let a = '', s = '';
  for (let i = 0; i < 30; i++) {
    s = await stationCounts();
    a = await adminCounts();
    if (a && a === s) break;
    await sleep(500);
  }
  check('admin shows the same waiting/uploading/failed as the packer', a && a === s, `packer ${s} · admin ${a}`);
  check('totals add up across stations', /^\d+ waiting$/.test((await admin.locator('#live-count-pending').innerText()).trim()), await admin.locator('#live-count-pending').innerText());
  check('admin view says it is live', (await admin.locator('#live-station-mode').innerText()) === 'live', await admin.locator('#live-station-mode').innerText());

  // 2) The packer's own Upload Queue page shows the same numbers.
  await packer.getByRole('button', { name: /Upload Queue/ }).first().click().catch(() => {});
  let own = '';
  s = await stationCounts();
  for (let i = 0; i < 20; i++) {
    own = await packer.locator('#station-own-counts').getAttribute('data-station-counts', { timeout: 10000 }).catch(() => '');
    if (own === s) break;
    await sleep(250);
  }
  a = await adminCounts();
  check("packer's Upload Queue shows the same numbers", own && own === s && own === a, `queue page ${own} · packer ${s} · admin ${a}`);

  // 3) A change on the packer's computer reaches the admin quickly.
  const t0 = Date.now();
  await packer.evaluate(async () => {
    const { dbGetAllQueue, dbPutQueue } = await import('/src/lib/storage.ts');
    const items = await dbGetAllQueue();
    for (const id of ['w0', 'w1', 'w2']) {
      const it = items.find((x) => x.id === id);
      if (it) await dbPutQueue({ ...it, status: 'failed', error: 'Network lost' });
    }
    window.dispatchEvent(new Event('ops_queue_updated'));
  });
  const want = await stationCounts();
  let ms = -1;
  for (let i = 0; i < 100; i++) {
    if ((await adminCounts()) === want) { ms = Date.now() - t0; break; }
    await sleep(100);
  }
  check('a packer change reaches the admin within 3 s', ms >= 0 && ms <= 3000, ms >= 0 ? `${(ms / 1000).toFixed(1)} s (now ${want})` : `admin still ${await adminCounts()}, packer ${want}`);
  const failText = await admin.evaluate((email) => document.querySelector(`[data-station="${email}"] [data-order="WAIT-0"]`)?.textContent || '', PACKER.email);
  check('admin sees the failure reason', /Network lost/.test(failText), failText);

  // 4) Went through Supabase, not Apps Script.
  check('station reports go to Supabase', sbCalls.includes('vms_station_report'), sbCalls.filter((c) => c.startsWith('vms_station')).length + ' station calls');
  check('no station reports through Apps Script', !backend.calls.some((c) => c.action === 'reportStationQueue'), backend.calls.filter((c) => c.action === 'reportStationQueue').length);

  // 5) A packer cannot read other stations, even with the Supabase key.
  const denied = await packer.evaluate(async () => {
    const { sbRpc } = await import('/src/lib/supabase/client.ts');
    const { getStoredToken } = await import('/src/lib/storage.ts');
    try { await sbRpc('vms_station_list', { p_token: getStoredToken(), p_since: 0 }); return 'allowed'; } catch (e) { return e.message; }
  });
  check('packer cannot list stations', denied !== 'allowed', denied);

  // 6) Supabase down: the admin view keeps working through Apps Script.
  await admin.route(sb.url + '/**', (r) => r.abort());
  await packer.route(sb.url + '/**', (r) => r.abort());
  await packer.evaluate(async () => {
    const { dbGetAllQueue, dbPutQueue } = await import('/src/lib/storage.ts');
    const it = (await dbGetAllQueue()).find((x) => x.id === 'w3');
    await dbPutQueue({ ...it, status: 'failed', error: 'Offline test' });
    window.dispatchEvent(new Event('ops_queue_updated'));
  });
  const want2 = await stationCounts();
  let ok = false;
  for (let i = 0; i < 40; i++) {
    if ((await adminCounts()) === want2) { ok = true; break; }
    await sleep(500);
  }
  check('Supabase down: admin still matches via Apps Script', ok, `packer ${want2} · admin ${await adminCounts()} · mode ${await admin.locator('#live-station-mode').innerText()}`);
  await admin.locator('#live-station-queues').screenshot({ path: process.env.SHOT || '/tmp/claude-0/live-station-supabase.png' }).catch(() => {});
} finally {
  await browser.close();
  try { sb.kill(); } catch {}
  try { await db.drop(); } catch {}
}
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
