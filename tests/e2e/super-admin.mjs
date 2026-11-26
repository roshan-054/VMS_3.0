// E2E: Super Admin role, per-user permissions (Admin > Users > Perms) and the Super Admin-only
// Supabase card, against the real Code.gs behind the mock backend.
// Run vite on :5179 first (npx vite --port 5179), then: node tests/e2e/super-admin.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOTS || '/tmp';
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const backend = createMockBackend();
const rt = backend.rt;
const users = rt.sheets.get('Users').rows;
users.push(
  [new Date(), 'Roshan', 'roshan.k@paraayan.com', sha('RoshanPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@test.local', sha('PackerPass1'), 'User', 'Approved'],
);

const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 160) });

async function signIn(browser, email, password) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await attach(page, backend);
  await page.goto(BASE);
  await page.getByPlaceholder(/email/i).first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
  await page.locator('nav').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return page;
}
const navIds = (page) => page.$$eval('[id^="nav-item-"]', (els) => els.map((e) => e.id.replace('nav-item-', '')));

const browser = await chromium.launch();

// 1. Roshan signs in: made Super Admin, sees Supabase settings, sets Pat's permissions.
{
  const page = await signIn(browser, 'roshan.k@paraayan.com', 'RoshanPass1');
  const roleRow = users.find((r) => r[2] === 'roshan.k@paraayan.com');
  check('Roshan is Super Admin in the Users sheet', roleRow[4] === 'Super Admin', roleRow[4]);
  check('footer shows Super Admin', (await page.locator('text=Super Admin').count()) > 0);
  await page.locator('#nav-item-settings').click();
  await page.locator('#supabase-card').waitFor({ timeout: 10000 }).catch(() => {});
  check('Super Admin sees the Supabase card', await page.locator('#supabase-card').isVisible());

  await page.locator('#nav-item-admin').click();
  await page.locator('#admin-tab-users-btn').click();
  await page.locator('text=pat@test.local').first().waitFor();
  const patRow = page.locator('tr', { hasText: 'pat@test.local' });
  await patRow.getByRole('button', { name: 'Perms' }).click();
  await page.locator('[data-perm="canAccessReports"]').check();
  await page.locator('[data-perm="canAccessLogs"]').uncheck();
  await page.screenshot({ path: SHOT + '/super-admin-perms-modal.png' });
  await page.locator('#save-permissions-btn').click();
  await page.locator('tr', { hasText: 'pat@test.local' }).locator('text=Custom access').waitFor({ timeout: 10000 });
  const stored = users.find((r) => r[2] === 'pat@test.local')[6];
  check('permissions saved in the Users sheet', stored === JSON.stringify({ canAccessLogs: false, canAccessReports: true }), stored);
  const editOpts = await (async () => {
    await page.locator('tr', { hasText: 'admin@test.local' }).getByRole('button', { name: 'Edit' }).click();
    const o = await page.locator('select option').allTextContents();
    await page.keyboard.press('Escape');
    return o;
  })();
  check('Super Admin can give the Super Admin role', editOpts.includes('Super Admin'), editOpts.join(','));
  await page.screenshot({ path: SHOT + '/super-admin-users.png' });
  await page.close();
}

// 2. Pat signs in: Reports shown, Upload Logs hidden.
{
  const page = await signIn(browser, 'pat@test.local', 'PackerPass1');
  const ids = await navIds(page);
  check('packer now sees Reports', ids.includes('reports'), ids.join(','));
  check('packer no longer sees Upload Logs', !ids.includes('logs'), ids.join(','));
  check('packer still has no Admin or Settings', !ids.includes('admin') && !ids.includes('settings'), ids.join(','));
  await page.locator('#nav-item-reports').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT + '/super-admin-packer-menu.png' });
  await page.close();
}

// 3. An ordinary Admin: everything as before, but no Supabase card and no Perms.
{
  const page = await signIn(browser, backend.ADMIN.email, backend.ADMIN.password);
  const ids = await navIds(page);
  check('Admin keeps every page', ['record', 'processing', 'queue', 'logs', 'search', 'reports', 'analytics', 'health', 'admin', 'settings'].every((i) => ids.includes(i)), ids.join(','));
  await page.locator('#nav-item-settings').click();
  await page.waitForTimeout(1200);
  check('Admin does not see the Supabase card', (await page.locator('#supabase-card').count()) === 0);
  check('Admin still sees the other Settings tools', await page.locator('#sheet-cleanup-card').isVisible());
  await page.screenshot({ path: SHOT + '/super-admin-admin-settings.png' });
  await page.locator('#nav-item-admin').click();
  await page.locator('#admin-tab-users-btn').click();
  await page.locator('text=pat@test.local').first().waitFor();
  check('Admin has no Perms buttons', (await page.getByRole('button', { name: 'Perms' }).count()) === 0);
  check('Super Admin row is locked for an Admin', await page.locator('tr', { hasText: 'roshan.k@paraayan.com' }).locator('text=Only the Super Admin').isVisible());
  await page.locator('tr', { hasText: 'pat@test.local' }).getByRole('button', { name: 'Edit' }).click();
  const opts = await page.locator('select option').allTextContents();
  check('Admin cannot pick the Super Admin role', !opts.includes('Super Admin'), opts.join(','));
  // The backend refuses the Supabase settings even if the app is bypassed.
  const token = await page.evaluate(() => localStorage.getItem('ops_token') || '');
  const direct = JSON.parse(rt.sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'getSupabaseConfig', token: token || 'x' }) }, parameter: {} }).text);
  check('backend refuses Supabase settings to an Admin', direct.success === false && /Only the Super Admin/.test(direct.error), direct.error);
  await page.screenshot({ path: SHOT + '/super-admin-admin-users.png' });
  await page.close();
}

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass);
if (failed.length) { console.error(failed.length + ' check(s) failed'); process.exit(1); }
console.log('All ' + results.length + ' checks passed');
