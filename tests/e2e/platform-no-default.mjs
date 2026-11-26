// E2E: Scan & Record never preselects Amazon. The platform comes from the scanned order ID; when
// it can't be told, recording waits until the packer picks one.
// Dev server on :5179, then node tests/e2e/platform-no-default.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
const backend = createMockBackend({ latencyByAction: { startUpload: 60000 } });
const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.waitForSelector('#platformSelect');
const pf = () => page.locator('#platformSelect').inputValue();

check('nothing preselected on open', (await pf()) === '', await pf());
await page.locator('#platformSelect').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/platform-empty.png` });

await page.fill('#orderIdInput', '#OD-10063');
await page.waitForTimeout(800);
check('#OD-… is detected as D2C', (await pf()) === 'D2C', await pf());

await page.fill('#orderIdInput', '405-9801142-6317130');
await page.waitForTimeout(800);
check('3-7-7 digits is detected as Amazon', (await pf()) === 'Amazon', await pf());

await page.fill('#orderIdInput', 'XYZ-777');
await page.waitForTimeout(800);
check('unknown ID clears the detected platform', (await pf()) === '', await pf());

await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; });
await page.locator('#start-recording-btn').click();
await page.waitForTimeout(800);
check('recording does not start without a platform', (await page.locator('#stop-recording-btn').count()) === 0, '');
const msg = await page.locator('body').innerText();
check('packer is told to pick the platform', /Select the e-commerce platform/.test(msg), '');
await page.locator('#platformSelect').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/platform-required.png` });

await page.selectOption('#platformSelect', 'JioMart');
await page.locator('#start-recording-btn').click();
await page.waitForSelector('#stop-recording-btn', { timeout: 10000 });
check('picked platform lets recording start', true, '');
await page.waitForTimeout(2500);
await page.locator('#stop-recording-btn').click();
await page.waitForTimeout(3500);
const q = await page.evaluate(async () => {
  const { dbGetAllQueue } = await import('/src/lib/storage.ts');
  return (await dbGetAllQueue()).map((x) => `${x.orderId}|${x.platform}`);
});
check('video saved under the picked platform', q.includes('XYZ-777|JioMart'), q.join(', '));
check('platform cleared for the next order', (await pf()) === '', await pf());

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
