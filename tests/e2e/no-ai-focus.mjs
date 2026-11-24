// E2E: the AI auto-focus feature is gone from Scan & Record (no AI Focus button, no reticle, no
// "AI Auto-Focus" bar with Focus Label/Invoice/Product), while the camera's own auto-focus button stays.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
await page.waitForTimeout(1500);
const text = await page.locator('body').innerText();
const results = [
  { check: 'no AI Focus button', pass: !/AI Focus/i.test(text) && (await page.locator('#toggle-ai-focus-btn').count()) === 0 },
  { check: 'no AI Auto-Focus bar / focus modes', pass: !/AI Auto-Focus|Focus Label|Focus Invoice|Focus Product|Smart AI/.test(text) },
  { check: 'no AUTO-FOCUSED reticle', pass: !/AUTO-FOCUSED/.test(text) },
  { check: 'camera auto-focus button kept', pass: (await page.locator('#trigger-autofocus-btn').count()) === 1 },
  { check: 'recording button present', pass: /Start Recording/.test(text) },
];
await page.screenshot({ path: process.env.SHOT || '/tmp/no-ai.png' });
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
