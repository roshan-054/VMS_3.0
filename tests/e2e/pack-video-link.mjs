// E2E: Pack Verification Audit Logs links each check to the order's uploaded video, and says
// "No video yet" (not "Recording") when there is none.
// Dev server on :5179, then node tests/e2e/pack-video-link.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOT = process.env.SHOT || '/tmp/claude-0/shots/pack-video-link.png';
const backend = createMockBackend();
const d = new Date();
backend.rt.sheets.get('OrderLog').appendRow([d, '#OD-9844', 'D2C', 'admin@test.local', 'FWD_FILE_9844_abcdef', '', '', 'Completed', 'Forward']);
const pv = backend.rt.sheets.get('PackVerificationLog');
pv.appendRow([d, '#OD-9844', 'D2C', 'vineet', 'vineet', 'v@x.com', '', 'MATCHED', 6, 6, '', '["8906191690896"]', 30, '']);
pv.appendRow([d, '#OD-9999', 'D2C', 'vineet', 'vineet', 'v@x.com', '', 'MATCHED', 1, 1, '', '["8906191692012"]', 10, '']);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 140) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Order Processing/ }).first().click();
await page.getByRole('button', { name: /Pack Verification Audit Logs/ }).first().click();
await page.waitForSelector('text=#OD-9999', { timeout: 20000 });
const row = (oid) => page.locator('tr', { hasText: oid }).first();
const href = await row('#OD-9844').locator('a', { hasText: 'View Video' }).getAttribute('href').catch(() => null);
check('order with an uploaded video links to it', href === 'https://drive.google.com/file/d/FWD_FILE_9844_abcdef/view', href);
const noVid = await row('#OD-9999').innerText();
check('order without a video says "No video yet"', /No video yet/.test(noVid), noVid.replace(/\s+/g, ' '));
check('no row says "Recording"', !/\bRecording\b/.test(await page.locator('table').last().innerText()), '');
await page.screenshot({ path: SHOT });
await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
