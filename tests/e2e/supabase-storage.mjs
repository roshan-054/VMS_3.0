// E2E: Settings > Supabase shows how much database storage is used against the plan limit, the
// biggest Sheet tabs, and a hint to run the newer script on an older database. Needs local Postgres + :5179.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const { pgAvailable, createTestDb, spawnFakeSupabase } = require('../supabase/pg-setup.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
if (!(await pgAvailable())) { console.log('SKIP: no local Postgres'); process.exit(0); }
const db = await createTestDb();
const sb = await spawnFakeSupabase(db.url);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 140) });
const browser = await chromium.launch();
function makeBackend() {
  const backend = createMockBackend();
  backend.rt.sheets.get('Users').rows[1][4] = 'Super Admin';
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
  return backend;
}
async function openSettings(backend) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  const page = await context.newPage();
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').click();
  await page.locator('#settings-section-database').click();
  await page.waitForSelector('#supabase-storage', { timeout: 30000 });
  return page;
}
try {
  // Some data so the tabs have a size: 3,000 upload log rows.
  const backend = makeBackend();
  const ul = backend.rt.sheets.get('UploadLog');
  ul.rows[0] = ['Timestamp','Order ID','Platform','Packer Email','File Name','File Size','Upload ID','Stage','Progress','Drive File ID','Status','Error','Recording Type','Source','Queue Job ID'];
  for (let i = 0; i < 3000; i++) ul.rows.push([new Date(Date.now() - i * 60000), 'OD-' + (10000 + i), 'Amazon', 'p@test.local', 'file-' + i + '.mp4', '12 MB', 'u' + i, 'Uploaded', 100, 'fid' + i, 'Completed', '', 'Forward', 'Recorder', 'j' + i]);
  const tok = backend.rt.call('login', { email: backend.ADMIN.email, password: backend.ADMIN.password }).token;
  const imp = backend.rt.call('supabaseImport', { token: tok });
  check('data copied to Supabase', imp.success, imp.error || '');

  const page = await openSettings(backend);
  const st = page.locator('#supabase-storage');
  const used = Number(await st.getAttribute('data-used'));
  const c = new Client({ connectionString: db.url });
  c.on('error', () => {});
  await c.connect();
  const real = Number((await c.query('select pg_database_size(current_database()) b')).rows[0].b);
  check('shows the real database size', used > 0 && Math.abs(used - real) / real < 0.05, `${used} vs ${real}`);
  const usedText = await page.locator('#supabase-storage-used').innerText();
  check('size in MB', /^\d+(\.\d)? MB$/.test(usedText), usedText);
  check('against the 500 MB free plan', /of 500 MB/.test(await st.innerText()), (await st.innerText()).replace(/\s+/g, ' '));
  const pct = await page.locator('#supabase-storage-pct').innerText();
  check('percent shown', pct === `${Math.round((used / (500 * 1048576)) * 100)}%` || pct === '<1%', pct);
  check('UploadLog listed as the biggest tab', (await page.locator('#supabase-storage-tabs [data-tab]').first().getAttribute('data-tab')) === 'UploadLog');
  check('no old-script note on the current script', (await page.locator('#supabase-schema-old').count()) === 0);
  await st.screenshot({ path: process.env.SHOT || '/tmp/claude-0/supabase-storage.png' });
  await page.locator('#supabase-plan').selectOption('pro');
  check('Pro plan switches the limit to 8 GB', /of 8 GB/.test(await st.innerText()));
  await page.reload();
  await page.locator('#nav-item-settings').click();
  await page.locator('#settings-section-database').click();
  await page.waitForSelector('#supabase-storage', { timeout: 30000 });
  check('plan choice is remembered', (await page.locator('#supabase-plan').inputValue()) === 'pro');

  // A database still on version 2 of the script: a hint instead of the bar, and the update note.
  await c.query(`create or replace function vms_private.status_json() returns jsonb language sql stable security definer set search_path = vms_private, public as $$ select jsonb_build_object('schemaVersion', 2, 'now', now(), 'tabs', '{}'::jsonb, 'pendingSheetWrites', 0, 'state', '{}'::jsonb) $$`);
  await c.end();
  const page2 = await openSettings(makeBackend());
  check('older script: hint to run the newer script', (await page2.locator('#supabase-storage[data-missing]').count()) === 1, await page2.locator('#supabase-storage').innerText());
  check('older script: update note says version 3', /needs version 3/.test(await page2.locator('#supabase-schema-old').innerText().catch(() => '')));
} catch (e) {
  check('test ran to the end', false, e.message);
} finally {
  await browser.close();
  try { sb.kill(); } catch {}
  try { await db.drop(); } catch {}
}
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
