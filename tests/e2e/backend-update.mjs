// E2E: Settings gear in the sidebar, version label + "new version" banner, and the
// Settings > Backend code card (status, one-click update, rollback, old-backend message).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOTS || '/tmp/backend-update-shots';
fs.mkdirSync(SHOT, { recursive: true });
const CODE = fs.readFileSync(path.join(process.cwd(), 'backend/Code.gs'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(process.cwd(), 'backend/appsscript.json'), 'utf8');

function backendWithApi() {
  const backend = createMockBackend();
  const sb = backend.rt.sandbox;
  const project = {
    files: [{ name: 'appsscript', type: 'JSON', source: MANIFEST }, { name: 'Code', type: 'SERVER_JS', source: CODE }],
    versions: [7],
    deployments: [{ deploymentId: 'AKfycbwZFm2t3o2vLFC7blM1AOzmgDMxB0UiZ_scWkLYasPGn7iB9XPoCCIi3mggjObpaMP_', deploymentConfig: { versionNumber: 7 }, entryPoints: [{ entryPointType: 'WEB_APP' }] }],
  };
  const reply = (code, o) => ({ getResponseCode: () => code, getContentText: () => (typeof o === 'string' ? o : JSON.stringify(o)) });
  sb.ScriptApp = { getScriptId: () => 'S', getOAuthToken: () => 't' };
  sb.UrlFetchApp = { fetch: (url, o = {}) => {
    const m = (o.method || 'GET').toUpperCase();
    if (url.includes('backend/Code.gs')) return reply(200, CODE + '\n// newer build\n');
    if (url.includes('backend/appsscript.json')) return reply(200, MANIFEST);
    const rest = url.replace('https://script.googleapis.com/v1/projects/S', '');
    if (rest === '/content' && m === 'GET') return reply(200, { files: project.files });
    if (rest === '/content' && m === 'PUT') { project.files = JSON.parse(o.payload).files; return reply(200, {}); }
    if (rest === '/versions') { const n = Math.max(...project.versions) + 1; project.versions.push(n); return reply(200, { versionNumber: n }); }
    if (rest.startsWith('/deployments?')) return reply(200, { deployments: project.deployments });
    if (rest.startsWith('/deployments/')) { Object.assign(project.deployments[0].deploymentConfig, JSON.parse(o.payload).deploymentConfig); return reply(200, {}); }
    return reply(404, {});
  } };
  return { backend, project };
}

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
const browser = await chromium.launch();

// 1) Gear button, version label, new-version banner, one-click update and rollback.
{
  const { backend, project } = backendWithApi();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await attach(page, backend);
  await page.route(/version\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'newer01', time: new Date().toISOString() }) }));
  await login(page, BASE, backend);
  check('sidebar shows Settings', await page.locator('#nav-item-settings').isVisible(), '');
  check('version label in sidebar', /Version \d{2}-[A-Z][a-z]{2}-\d{2}/.test(await page.locator('#app-build-label').innerText()), await page.locator('#app-build-label').innerText());
  await page.locator('#footer-settings-btn').click();
  await page.locator('#backend-update-card').waitFor();
  check('gear opens Settings', await page.locator('h2:has-text("Settings")').isVisible(), '');
  await page.locator('#new-version-banner').waitFor({ timeout: 25000 }).catch(() => {});
  check('newer published build shows Reload banner', await page.locator('#new-version-banner').isVisible(), '');
  await page.locator('#backend-update-status').waitFor();
  check('status says update available', (await page.locator('#backend-update-status').innerText()) === 'Update available', await page.locator('#backend-update-status').innerText());
  await page.locator('#backend-update-card').screenshot({ path: SHOT + '/backend-update-available.png' });
  await page.locator('#backend-update-run').click();
  check('asks to confirm first', await page.locator('#backend-update-confirm').isVisible() && project.versions.length === 1, project.versions.length);
  await page.locator('#backend-update-confirm-yes').click();
  await page.locator('#backend-update-result').waitFor({ timeout: 30000 });
  check('update result shown', /version 8/.test(await page.locator('#backend-update-result').innerText()), await page.locator('#backend-update-result').innerText());
  check('deployment moved to v8', project.deployments[0].deploymentConfig.versionNumber === 8, project.deployments[0].deploymentConfig.versionNumber);
  await page.waitForFunction(() => document.querySelector('#backend-update-status')?.textContent === 'Up to date', null, { timeout: 15000 }).catch(() => {});
  check('status then says up to date', (await page.locator('#backend-update-status').innerText()) === 'Up to date', await page.locator('#backend-update-status').innerText());
  check('rollback offered', await page.locator('#backend-update-rollback').isVisible(), '');
  await page.screenshot({ path: SHOT + '/backend-updated.png', fullPage: true });
  await page.locator('#backend-update-rollback').click();
  await page.waitForFunction(() => /v7/.test(document.querySelector('#backend-update-result')?.textContent || '') || /7 again/.test(document.querySelector('#backend-update-result')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  check('rollback moved deployment back to v7', project.deployments[0].deploymentConfig.versionNumber === 7, project.deployments[0].deploymentConfig.versionNumber);
  // Up to date: the button stays usable as a reinstall.
  await page.locator('#backend-update-check').click();
  await page.waitForFunction(() => document.querySelector('#backend-update-status')?.textContent === 'Up to date', null, { timeout: 15000 }).catch(() => {});
  const runBtn = page.locator('#backend-update-run');
  check('up to date: button still enabled as Reinstall', (await runBtn.isEnabled()) && /Reinstall/.test(await runBtn.innerText()), await runBtn.innerText());
  await runBtn.click();
  await page.locator('#backend-update-confirm-yes').click();
  await page.waitForFunction(() => /version 9/.test(document.querySelector('#backend-update-result')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  check('reinstall saved a new version and deployed it', project.deployments[0].deploymentConfig.versionNumber === 9, project.deployments[0].deploymentConfig.versionNumber);
  // Backend functions.
  for (const a of ['setup', 'applyDateFormats', 'repairPlaybackUrls', 'applyConditionalFormatting']) {
    await page.locator(`#run-${a}`).click();
    await page.locator(`#run-${a}-yes`).click();
    await page.locator(`#run-${a}-result`).waitFor({ timeout: 60000 }).catch(() => {});
    const txt = await page.locator(`#run-${a}-result`).innerText().catch(() => '');
    const ok = await page.locator(`#run-${a}-result`).evaluate((el) => el.className.includes('emerald')).catch(() => false);
    check(`run ${a}`, ok, txt);
  }
  await page.locator('#backend-update-card').screenshot({ path: SHOT + '/backend-run-buttons.png' });
  await page.close();
}

// 2) Apps Script API switched off: clear setup message, button disabled.
{
  const { backend } = backendWithApi();
  const f = backend.rt.sandbox.UrlFetchApp.fetch;
  backend.rt.sandbox.UrlFetchApp.fetch = (url, o) => url.includes('script.googleapis.com')
    ? { getResponseCode: () => 403, getContentText: () => JSON.stringify({ error: { message: 'User has not enabled the Apps Script API.' } }) }
    : f(url, o);
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('vms_night_mode', 'true'));
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').click();
  await page.locator('#backend-update-api-help').waitFor({ timeout: 15000 }).catch(() => {});
  check('API off: setup help shown', /usersettings/.test(await page.locator('#backend-update-api-help').innerText().catch(() => '')), '');
  check('API off: update button disabled', await page.locator('#backend-update-run').isDisabled(), '');
  await page.locator('#backend-update-card').screenshot({ path: SHOT + '/backend-update-setup-dark.png' });
  await page.close();
}

// 3) Live backend older than this feature: says one manual update is needed.
{
  const backend = createMockBackend();
  const h = backend.handle.bind(backend);
  backend.handle = async (route) => {
    const body = route.request().postData() || '';
    if (body.includes('"getBackendUpdateStatus"')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Unknown action: getBackendUpdateStatus' }) });
    return h(route);
  };
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.locator('#nav-item-settings').click();
  await page.locator('#backend-update-status').waitFor({ timeout: 15000 }).catch(() => {});
  check('old backend: says one manual update needed', /manual/.test(await page.locator('#backend-update-status').innerText().catch(() => '')), '');
  await page.close();
}

await browser.close();
console.table(results);
process.exit(results.every((r) => r.pass) ? 0 : 1);
