'use strict';
// Admin > Settings > Backend code: pull Code.gs from GitHub, write it with the Apps Script API,
// save a version and move the web-app deployment to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const REAL_CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const REAL_MANIFEST = fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8');
const DEP = 'AKfycbDEPLOYMENTid';
const WEB_URL = `https://script.google.com/macros/s/${DEP}/exec`;

function setup({ apiEnabled = true, liveScopes, latestCode = REAL_CODE + '\n// newer\n', deployments } = {}) {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  ] });
  const manifest = JSON.parse(REAL_MANIFEST);
  if (liveScopes) manifest.oauthScopes = liveScopes;
  manifest.webapp = { executeAs: 'USER_DEPLOYING', access: 'ANYONE' };
  manifest.timeZone = 'Asia/Kolkata';
  const project = {
    files: [
      { name: 'appsscript', type: 'JSON', source: JSON.stringify(manifest) },
      { name: 'Code', type: 'SERVER_JS', source: REAL_CODE },
      { name: 'Notes', type: 'SERVER_JS', source: '// other file' },
    ],
    versions: [1, 2, 3],
    deployments: deployments || [
      { deploymentId: 'HEADid', deploymentConfig: { manifestFileName: 'appsscript' }, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'x/dev' } }] },
      { deploymentId: DEP, deploymentConfig: { versionNumber: 3, manifestFileName: 'appsscript' }, entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: WEB_URL } }] },
    ],
  };
  const calls = [];
  const reply = (code, obj) => ({ getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  rt.sandbox.ScriptApp = { getScriptId: () => 'SCRIPT1', getOAuthToken: () => 'tok' };
  rt.sandbox.UrlFetchApp = {
    fetch: (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      calls.push(method + ' ' + url.replace(/\?t=\d+/, ''));
      if (url.startsWith('https://raw.githubusercontent.com/roshan-054/VMS_3.0/main/backend/Code.gs')) return reply(200, latestCode);
      if (url.startsWith('https://raw.githubusercontent.com/roshan-054/VMS_3.0/main/backend/appsscript.json')) return reply(200, REAL_MANIFEST);
      assert.ok(url.startsWith('https://script.googleapis.com/v1/projects/SCRIPT1'), url);
      assert.equal(opts.headers.Authorization, 'Bearer tok');
      if (!apiEnabled) return reply(403, { error: { code: 403, message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' } });
      const rest = url.replace('https://script.googleapis.com/v1/projects/SCRIPT1', '');
      if (rest === '/content' && method === 'GET') return reply(200, { scriptId: 'SCRIPT1', files: project.files });
      if (rest === '/content' && method === 'PUT') { project.files = JSON.parse(opts.payload).files; return reply(200, { files: project.files }); }
      if (rest === '/versions' && method === 'POST') { const n = Math.max(...project.versions) + 1; project.versions.push(n); return reply(200, { versionNumber: n }); }
      if (rest.startsWith('/deployments?') && method === 'GET') return reply(200, { deployments: project.deployments });
      const m = rest.match(/^\/deployments\/([^?]+)$/);
      if (m && method === 'PUT') {
        const d = project.deployments.find((x) => x.deploymentId === decodeURIComponent(m[1]));
        d.deploymentConfig = { ...d.deploymentConfig, ...JSON.parse(opts.payload).deploymentConfig };
        return reply(200, d);
      }
      return reply(404, { error: { message: 'not mocked ' + method + ' ' + rest } });
    },
  };
  const admin = rt.call('login', { email: 'alice@example.com', password: 'AdminPass1' }).token;
  const packer = rt.call('login', { email: 'pat@example.com', password: 'PackerPass1' }).token;
  return { rt, admin, packer, project, calls };
}

test('only administrators can see or run the backend update', () => {
  const { rt, packer } = setup();
  for (const a of ['getBackendUpdateStatus', 'updateBackend', 'rollbackBackend']) {
    const r = rt.call(a, { token: packer });
    assert.equal(r.success, false, a);
    assert.match(r.error, /Administrator/);
  }
});

test('status shows live vs latest and that the API is ready', () => {
  const { rt, admin } = setup();
  const r = rt.call('getBackendUpdateStatus', { token: admin });
  assert.equal(r.success, true, r.error);
  assert.equal(r.api.ready, true);
  assert.ok(r.live.sha && r.latest.sha && r.live.sha !== r.latest.sha);
  assert.equal(r.upToDate, false);
});

test('update writes the new code, keeps other files, saves a version and moves the deployment', () => {
  const { rt, admin, project, calls } = setup();
  const r = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(r.success, true, r.error + ' ' + (r.help || ''));
  assert.equal(r.versionNumber, 4);
  assert.equal(r.previousVersion, 3);
  assert.equal(r.deploymentId, DEP);
  assert.ok(project.files.find((f) => f.name === 'Code').source.endsWith('// newer\n'));
  assert.equal(project.files.find((f) => f.name === 'Notes').source, '// other file');
  const man = JSON.parse(project.files.find((f) => f.name === 'appsscript').source);
  assert.deepEqual(man.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE' }, 'web app settings kept');
  assert.equal(project.deployments[1].deploymentConfig.versionNumber, 4);
  assert.equal(project.deployments[0].deploymentConfig.versionNumber, undefined, 'HEAD deployment untouched');
  assert.ok(calls.every((c) => !/\/content$/.test(c) || c.startsWith('GET') || c.startsWith('PUT')));
  const st = rt.call('getBackendUpdateStatus', { token: admin });
  assert.equal(st.upToDate, true);
  assert.equal(st.live.version, 4);
  // A second click does nothing.
  const again = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(again.upToDate, true);
  assert.equal(project.versions.length, 4);
});

test('rollback points the deployment back at the previous version', () => {
  const { rt, admin, project } = setup();
  rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  const r = rt.call('rollbackBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(r.success, true, r.error);
  assert.equal(project.deployments[1].deploymentConfig.versionNumber, 3);
});

test('explains how to turn on the Apps Script API when it is off', () => {
  const { rt, admin, project } = setup({ apiEnabled: false });
  const st = rt.call('getBackendUpdateStatus', { token: admin });
  assert.equal(st.api.ready, false);
  assert.match(st.api.help, /usersettings/);
  const r = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(r.success, false);
  assert.match(r.help, /usersettings/);
  assert.equal(project.versions.length, 3);
});

test('stops before changing anything when the new code needs new permissions', () => {
  const live = JSON.parse(REAL_MANIFEST).oauthScopes.filter((s) => !/drive$/.test(s));
  const { rt, admin, project } = setup({ liveScopes: live });
  const r = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(r.success, false);
  assert.equal(r.step, 'permissions');
  assert.equal(project.files.find((f) => f.name === 'Code').source, REAL_CODE);
});

test('refuses a broken or partial Code.gs from GitHub', () => {
  const { rt, admin, project } = setup({ latestCode: '<html>404</html>' });
  const r = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  assert.equal(r.success, false);
  assert.match(r.error, /complete VMS backend/);
  assert.equal(project.files.find((f) => f.name === 'Code').source, REAL_CODE);
});

test('does not guess between several deployments that do not match the app URL', () => {
  const d = (id, v) => ({ deploymentId: id, deploymentConfig: { versionNumber: v }, entryPoints: [{ entryPointType: 'WEB_APP' }] });
  const { rt, admin, project } = setup({ deployments: [d('A', 1), d('B', 2)] });
  const r = rt.call('updateBackend', { token: admin, webAppUrl: 'https://script.google.com/macros/s/OTHER/exec' });
  assert.equal(r.success, false);
  assert.match(r.error, /2 web app deployments/);
  assert.equal(project.versions.length, 3, 'no version saved');
  assert.equal(project.files.find((f) => f.name === 'Code').source, REAL_CODE, 'code untouched');
});

test('force reinstalls the same code as a new version', () => {
  const { rt, admin, project } = setup();
  rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL });
  const r = rt.call('updateBackend', { token: admin, webAppUrl: WEB_URL, force: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.versionNumber, 5);
  assert.equal(project.deployments[1].deploymentConfig.versionNumber, 5);
});
