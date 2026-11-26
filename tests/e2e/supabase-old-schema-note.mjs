// E2E: when the Supabase database script is older than the app, Settings shows a note with its own
// "Copy database script" button (no need to open Connection details). Needs local Postgres + :5179.
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
try {
  // Pretend the database still has the first version of the script.
  const c = new Client({ connectionString: db.url });
  await c.connect();
  await c.query(`create or replace function vms_private.status_json() returns jsonb language sql stable security definer set search_path = vms_private, public as $$ select jsonb_build_object('schemaVersion', 1, 'now', now(), 'tabs', '{}'::jsonb, 'pendingSheetWrites', 0, 'state', '{}'::jsonb) $$`);
  await c.end();
  const backend = createMockBackend();
  backend.rt.sheets.get('Users').rows[1][4] = 'Super Admin';
  const { rt } = backend;
  rt.sandbox.UrlFetchApp = {
    fetch(url, opts = {}) {
      const args = ['-s', '--noproxy', '*', '-X', String(opts.method || 'get').toUpperCase(), '-w', '\n%{http_code}', '-H', 'Content-Type: application/json'];
      Object.entries(opts.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
      if (opts.payload !== undefined) args.push('--data-binary', '@-');
      const out = execFileSync('curl', [...args, url], { input: opts.payload || '' }).toString();
      const i = out.lastIndexOf('\n');
      return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
    },
  };
  rt.sandbox.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => ({}) }; return b; }, deleteTrigger() {} };
  rt.props.set('SUPABASE_URL', sb.url);
  rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
  rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey);
  rt.props.set('SUPABASE_ENABLED', 'true');

  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').click();
  await page.locator('#settings-section-database').click();
  await page.waitForSelector('#supabase-schema-old', { timeout: 30000 });
  const btn = page.locator('#supabase-copy-sql-note');
  check('note has its own Copy database script button', await btn.isVisible());
  check('Connection details stays closed', !(await page.locator('details[open]').count()), '');
  await btn.click();
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('the script is copied', /create or replace function public\.vms_station_report/.test(clip), clip.length + ' characters');
  await page.locator('#supabase-schema-old').screenshot({ path: process.env.SHOT || '/tmp/claude-0/old-schema-note.png' });
} finally {
  await browser.close();
  try { sb.kill(); } catch {}
  try { await db.drop(); } catch {}
}
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
