'use strict';
// Runs the real backend/Code.gs (via the Node GAS harness) behind Playwright's network
// interception, so browser tests exercise the real app against the real backend logic.
const crypto = require('crypto');
const { createRuntime } = require('../../backend/tests/gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const ADMIN = { email: 'admin@test.local', password: 'AdminPass1', name: 'Test Admin' };

function seedManifests(rt, count, packerEmail) {
  const sh = rt.sheets.get('OrderManifest');
  for (let i = 0; i < count; i++) {
    const items = JSON.stringify([
      { id: 'i1', productName: `Product ${i % 40}`, shortName: `P${i % 40}`, sku: `SKU-${i % 40}`, gtin: `890000000${String(i % 40).padStart(4, '0')}`, quantity: 1 },
    ]);
    sh.appendRow([new Date().toISOString(), `404-${String(1000000 + i)}-${String(2000000 + i)}`, 'Amazon', 'Test Admin', packerEmail, 'Test Admin', packerEmail, '', items, i < count - 60 ? 'Packed' : 'Pending', '', '', '', '']);
  }
}

function createMockBackend({ manifests = 0, latencyMs = 0, latencyByAction = {} } = {}) {
  const rt = createRuntime({ users: [[new Date(), ADMIN.name, ADMIN.email, sha(ADMIN.password), 'Admin', 'Approved']] });
  if (manifests) seedManifests(rt, manifests, ADMIN.email);
  const calls = [];
  async function handle(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch { /* ignore */ }
    calls.push({ action: body.action, at: Date.now() });
    let out;
    try {
      const res = rt.sandbox.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} });
      out = res.text;
    } catch (e) {
      out = JSON.stringify({ success: false, error: String(e.message || e) });
    }
    const delay = latencyByAction[body.action] ?? latencyMs;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
  }
  return { rt, calls, handle, ADMIN };
}

async function attach(page, backend) {
  await page.route(/script\.google(usercontent)?\.com/, (route) => backend.handle(route));
}

async function login(page, baseUrl, backend) {
  await page.goto(baseUrl);
  await page.getByPlaceholder(/email/i).first().fill(backend.ADMIN.email);
  await page.locator('input[type="password"]').first().fill(backend.ADMIN.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
  await page.waitForSelector('text=Scan & Record', { timeout: 20000 });
}

module.exports = { createMockBackend, attach, login };
