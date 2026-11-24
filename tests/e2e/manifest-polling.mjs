// E2E: a station idling with a big order list (2,800 manifests) only downloads the list when it
// changes; an order added elsewhere still shows up on the next poll; hidden tabs don't poll.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend({ manifests: 2800 });
const { rt } = backend;
const polls = [];
const orig = rt.sandbox.doPost;
rt.sandbox.doPost = (e) => {
  const out = orig(e);
  try { if (JSON.parse(e.postData.contents).action === 'getOrderManifests') polls.push({ at: Date.now(), bytes: out.text.length, unchanged: out.text.includes('"unchanged":true') }); } catch {}
  return out;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 120) });

await page.waitForTimeout(50000);
const full = polls.filter((p) => !p.unchanged);
const cheap = polls.filter((p) => p.unchanged);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
check('idle 50 s: most polls are tiny "unchanged" answers', cheap.length >= 2 && full.length <= 2,
  `${polls.length} polls: ${full.length} full (${kb(full[0]?.bytes || 0)} each), ${cheap.length} unchanged (${cheap[0]?.bytes || 0} bytes each)`);
const before = polls.length * (full[0]?.bytes || 0);
const after = polls.reduce((n, p) => n + p.bytes, 0);
check('download over 50 s vs. always downloading the list', after < before / 2, `${kb(after)} instead of ${kb(before)}`);

const token = rt.call('login', { email: backend.ADMIN.email, password: backend.ADMIN.password }).token;
rt.call('saveOrderManifest', { token, manifest: { orderId: 'NEW-ORDER-777', platform: 'Amazon', assignedPackerEmail: backend.ADMIN.email, items: [], status: 'Pending' } });
const t0 = Date.now();
const seen = await page.waitForFunction(() => (localStorage.getItem('vms_order_manifests_v1') || '').includes('NEW-ORDER-777'), null, { timeout: 25000 }).then(() => true).catch(() => false);
check('order added on another station appears on the next poll', seen, `${((Date.now() - t0) / 1000).toFixed(1)} s`);

const n = polls.length;
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(35000);
check('hidden tab does not poll', polls.length === n, `${polls.length - n} polls while hidden`);

console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
