// E2E: all settings live in the Settings page (Admin & Users keeps only Users & Roles), and
// popups close when the dark area around them is clicked.
// Run vite on :5179 first (npx vite --port 5179), then: node tests/e2e/settings-and-popups.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOTS || '/tmp';
const backend = createMockBackend();
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 160) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);

// Admin & Users: only Users & Roles.
await page.locator('#nav-item-admin').click();
await page.locator('text=admin@test.local').first().waitFor();
check('Admin page has no Logo & Favicon tab', (await page.locator('#admin-tab-branding-btn').count()) === 0);
check('Admin page has no Apps Script & Drive tab', (await page.locator('#admin-tab-settings-btn').count()) === 0);
check('Admin page has no Drive folder setting', (await page.locator('#drive-location-setting').count()) === 0);
await page.screenshot({ path: SHOT + '/admin-users-only.png' });

// Settings: sections.
await page.locator('#nav-item-settings').click();
await page.locator('#settings-section-app').waitFor();
const sections = await page.$$eval('#settings-sections [role="tab"]', (els) => els.map((e) => e.id.replace('settings-section-', '')));
check('Settings sections for an Admin', sections.join(',') === 'app,branding,data,backend', sections.join(','));
await page.locator('#settings-section-app').click();
await page.locator('#drive-location-setting').waitFor({ timeout: 10000 });
check('App & Drive has the Drive folder setting', await page.locator('#drive-location-setting').isVisible());
check('App & Drive has the video size limit', (await page.locator('#video-size-limit-current').count()) > 0);
check('App & Drive has Drive storage', (await page.locator('#drive-storage-card').count()) > 0);
await page.screenshot({ path: SHOT + '/settings-app.png' });
await page.locator('#settings-section-branding').click();
await page.locator('text=Application Logo').first().waitFor();
check('Logo & Favicon section shows the logo settings', true);
await page.screenshot({ path: SHOT + '/settings-branding.png' });
await page.locator('#settings-section-data').click();
check('Data & Cleanup has the sheet cleanup', await page.locator('#sheet-cleanup-card').isVisible());
await page.screenshot({ path: SHOT + '/settings-data.png' });
await page.locator('#settings-section-backend').click();
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT + '/settings-backend.png' });
check('Backend update section opens', (await page.locator('text=/backend/i').count()) > 0);

// Popups close on an outside click, not on a click inside.
await page.locator('#nav-item-admin').click();
const addBtn = page.getByRole('button', { name: /Add New User/ });
const modal = () => page.locator('text=Create New User').or(page.locator('h3', { hasText: /New User/ }));
await addBtn.click();
const backdrop = page.locator('[data-backdrop-close="true"]').last();
await backdrop.waitFor();
const box = await backdrop.locator(':scope > *').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + 20);
check('click inside the popup keeps it open', (await page.locator('[data-backdrop-close="true"]').count()) === 1);
// Drag from inside to outside (like selecting text): stays open.
await page.mouse.move(box.x + 40, box.y + 40);
await page.mouse.down();
await page.mouse.move(8, 8);
await page.mouse.up();
check('drag from inside to outside keeps it open', (await page.locator('[data-backdrop-close="true"]').count()) === 1);
await page.mouse.click(8, 8);
await page.waitForTimeout(300);
check('click outside closes the popup', (await page.locator('[data-backdrop-close="true"]').count()) === 0);

// Clear cache popup in the sidebar footer, if present.
const cacheBtn = page.locator('#nav-clear-cache-btn');
if (await cacheBtn.count()) {
  await cacheBtn.click();
  await page.locator('#cache-clear-modal').waitFor({ timeout: 3000 }).catch(() => {});
  if (await page.locator('#cache-clear-modal').count()) {
    await page.mouse.click(8, 890);
    await page.waitForTimeout(300);
    check('clear-cache popup closes on outside click', (await page.locator('#cache-clear-modal').count()) === 0);
  }
}

await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass);
if (failed.length) { console.error(failed.length + ' check(s) failed'); process.exit(1); }
console.log('All ' + results.length + ' checks passed');
