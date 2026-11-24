// E2E: one order is recorded once. A quick extra click on Start while the last video is still
// saving, a re-scan of the same order, or a recording stopped right away must not create a second
// (near-empty) video for the order. Dev server on :5179, then node tests/e2e/no-duplicate-recordings.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend({ latencyByAction: { startUpload: 60000 } }); // keep uploads from finishing
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; });
const queued = (oid) => page.evaluate(async (o) => {
  const { dbGetAllQueue } = await import('/src/lib/storage.ts');
  return (await dbGetAllQueue()).filter((q) => q.orderId === o).map((q) => q.fileSize);
}, oid);
const startClick = () => page.evaluate(() => document.querySelector('#start-recording-btn')?.click());

// 1. Stop, then Start hammered while the video is still being saved.
await page.fill('#orderIdInput', '#OD-9592');
await page.waitForTimeout(800);
await page.locator('#start-recording-btn').click();
await page.waitForSelector('#stop-recording-btn');
await page.waitForTimeout(3000);
await page.locator('#stop-recording-btn').click();
for (let i = 0; i < 20; i++) { await startClick(); await page.waitForTimeout(50); }
await page.waitForTimeout(600);
if (await page.locator('#stop-recording-btn').count()) await page.locator('#stop-recording-btn').click(); // a second recording started
await page.waitForTimeout(4000);
let q = await queued('#OD-9592');
check('extra Start clicks while saving do not record the order again', q.length === 1, JSON.stringify(q));
check('the one queued video has real footage', q[0] > 64 * 1024, q[0]);

// 2. Same order scanned again on this computer right after.
await page.fill('#orderIdInput', '#OD-9592');
await page.waitForTimeout(1500);
await startClick();
await page.waitForTimeout(1200);
const started = await page.locator('#stop-recording-btn').count();
if (started) { await page.waitForTimeout(2500); await page.locator('#stop-recording-btn').click(); await page.waitForTimeout(3000); }
q = await queued('#OD-9592');
check('same order again on this computer is blocked', !started && q.length === 1, `started=${started} queued=${q.length}`);
const bypass = await page.getByText(/Re-record & Upload Anyway/i).count();
check('packer can still choose Re-record & Upload Anyway', bypass > 0, bypass);

// 3. A recording stopped right after it started is discarded.
await page.fill('#orderIdInput', 'SHORT-0001');
await page.waitForTimeout(1500);
await page.locator('#start-recording-btn').click();
await page.waitForSelector('#stop-recording-btn');
await page.waitForTimeout(400);
await page.locator('#stop-recording-btn').click();
await page.waitForTimeout(3000);
q = await queued('SHORT-0001');
check('a sub-2-second recording is not queued for upload', q.length === 0, JSON.stringify(q));

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
