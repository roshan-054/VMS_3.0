// E2E: the desktop sidebar has exactly one Clear Cache control, and it still works.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');
const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
const visible = await page.locator('[aria-label="Clear Cache"], #nav-clear-cache-btn, #footer-clear-cache-btn').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => e.id || e.getAttribute('aria-label')));
const results = [{ check: 'exactly one Clear Cache control visible', pass: visible.length === 1, detail: visible.join(',') }];
await page.locator('#nav-clear-cache-btn').click();
const modal = await page.getByRole('button', { name: /Clear Cache Now/ }).isVisible();
results.push({ check: 'it opens the Clear Cache dialog', pass: modal, detail: modal });
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
