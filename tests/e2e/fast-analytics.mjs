// E2E: Analytics shows numbers quickly. With Apps Script taking 3 s per analytics call and 4 s per
// search, the first open needs one call (no extra full searches), reopening shows the last numbers
// at once, and a new video still shows up. Dev server on :5179, then node tests/e2e/fast-analytics.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend({ latencyByAction: { getAnalyticsData: 3000, advancedSearch: 4000 } });
const ol = backend.rt.sheets.get('OrderLog');
const now = Date.now();
for (let i = 0; i < 3000; i++) ol.appendRow([new Date(now - (i % 30) * 86400000 - 3600000), `AN-${i}`, i % 3 ? 'Amazon' : 'D2C', 'admin@test.local', `FILE_AN_${i}_x`, '', '20 MB', 'Completed', 'Forward', `job-an-${i}`]);
const todayCount = 100;

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 120) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await attach(page, backend);
await login(page, BASE, backend);
const total = () => page.locator('#analytics-total-card .text-3xl').textContent().catch(() => '');
const openAnalytics = async () => {
  const before = backend.calls.length;
  const t0 = Date.now();
  await page.getByRole('button', { name: /^Analytics$/ }).first().click();
  await page.waitForSelector('#analytics-total-card');
  const cardMs = Date.now() - t0;
  for (;;) { if ((await total()) === String(todayCount)) break; await page.waitForTimeout(50); if (Date.now() - t0 > 60000) break; }
  const ms = Date.now() - t0;
  await page.waitForTimeout(4500); // let background refresh finish
  const calls = backend.calls.slice(before).map((c) => c.action).filter((a) => /Analytics|Search/.test(a));
  return { ms, calls, cardMs };
};

const first = await openAnalytics();
check('first open shows numbers in under 5 s', first.ms < 5000, `${first.ms} ms`);
check('first open makes no extra full searches', !first.calls.includes('advancedSearch'), first.calls.join());
await page.getByRole('button', { name: /Upload Logs/ }).first().click();
await page.waitForTimeout(500);
const again = await openAnalytics();
check('reopening shows the numbers at once', again.ms - again.cardMs < 300, `${again.ms} ms (tab drawn at ${again.cardMs} ms)`);
const r = backend.calls.filter((c) => c.action === 'getAnalyticsData');

// A new video is logged: the next view shows it.
backend.rt.call('finishUpload', { token: (await page.evaluate(() => localStorage.getItem('vms_session_token') || '')), uploadId: 'u-new', fileId: 'FILE_NEW_xyz', orderId: 'AN-NEW', platform: 'Amazon', recordingType: 'Forward', queueJobId: 'job-new' });
backend.rt.sandbox.bumpAnalyticsVersion_?.();
ol.appendRow([new Date(), 'AN-NEW2', 'Amazon', 'admin@test.local', 'FILE_NEW2_xyz', '', '20 MB', 'Completed', 'Forward', 'job-new2']);
backend.rt.sandbox.bumpAnalyticsVersion_?.();
await page.getByRole('button', { name: /Refresh Metrics/ }).click();
let latest = '';
for (let i = 0; i < 100; i++) { latest = await total(); if (Number(latest) > todayCount) break; await page.waitForTimeout(100); }
check('a newly logged video shows up after refresh', Number(latest) > todayCount, latest);

await browser.close();
console.table(results);
const failed = results.filter((x) => !x.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
