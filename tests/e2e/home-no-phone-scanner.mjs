// E2E: the home screen has no Live Sync / Phone Scanner controls, the old phone-scanner link
// opens the normal app, and the USB scanner still fills the Order ID.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await attach(page, backend);
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 100) });

await page.goto(BASE + '?scanner=mobile&pin=1234');
await page.waitForTimeout(1500);
check('old phone-scanner link shows the normal sign-in', (await page.locator('input[type="password"]').count()) > 0);

await login(page, BASE, backend);
const text = await page.locator('#scan-record-container').innerText();
check('no "Live Sync" button', !/Live Sync/i.test(text), text.match(/.{0,20}Live Sync.{0,20}/i)?.[0] || '');
check('no phone scanner controls', !/Phone (Barcode )?Scanner|Pair \(QR\)|Phone Linked/i.test(text), text.match(/.{0,20}Phone.{0,20}/i)?.[0] || '');
check('USB scanner label still shown', /USB Scanner/.test(text));

await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.type('404-1111111-2222222', { delay: 8 });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('USB scanner burst fills Order ID', (await page.locator('#orderIdInput').inputValue()) === '404-1111111-2222222', await page.locator('#orderIdInput').inputValue());

const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /peerjs|phoneScanner|PhoneScanner/i.test(n)));
check('no phone-scanner code loaded', scripts.length === 0, scripts.join(','));
check('no page errors', errors.length === 0, errors.join(' | '));

console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
