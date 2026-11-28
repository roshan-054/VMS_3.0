// E2E: Super Admin switches Box & Weight on in Settings and sets up a box; a packer records an
// order, picks the box, types the weight after stopping, scans the next order (details saved);
// adds a custom box; the report download carries the box columns. Admins cannot see the switch.
// Dev server on :5179, then node tests/e2e/box-dimensions.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const crypto = require('crypto');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots/box';
mkdirSync(SHOTS, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const backend = createMockBackend();
const users = backend.rt.sheets.get('Users');
users.rows[1][4] = 'Super Admin';
users.appendRow([new Date(), 'Pat Packer', 'pat@test.local', sha('PackerPass1'), 'User', 'Approved']);
users.appendRow([new Date(), 'Alice Admin', 'alice@test.local', sha('AdminPass2'), 'Admin', 'Approved']);

const results = [];
const check = (name, ok, detail) => results.push({ check: name, pass: !!ok, detail: String(detail ?? '').slice(0, 160) });
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const open = async (who) => {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await attach(page, backend);
  await login(page, BASE, { ADMIN: who });
  return page;
};

// 1. Super Admin: Settings > Packing box.
const sa = await open(backend.ADMIN);
await sa.getByRole('button', { name: /^Settings$/ }).first().click();
await sa.locator('#settings-section-packing').click();
await sa.waitForSelector('#box-settings-card');
check('feature is off at first', (await sa.locator('#box-feature-toggle').getAttribute('aria-checked')) === 'false');
await sa.screenshot({ path: `${SHOTS}/settings-off.png` });
await sa.locator('#box-feature-toggle').click();
await sa.waitForSelector('#box-feature-toggle[aria-checked="true"]');
await sa.fill('#box-settings-name', 'Box-1');
await sa.fill('#box-settings-l', '10');
await sa.fill('#box-settings-b', '10');
await sa.fill('#box-settings-h', '3');
await sa.locator('#box-settings-add').click();
await sa.waitForSelector('#box-settings-presets >> text=Box-1 10x10x3 cm');
check('Super Admin added Box-1', true);
await sa.screenshot({ path: `${SHOTS}/settings-on.png` });

// 2. An Admin does not get the switch.
const al = await open({ email: 'alice@test.local', password: 'AdminPass2' });
await al.getByRole('button', { name: /^Settings$/ }).first().click();
await al.waitForSelector('#settings-sections');
check('Admin has no Packing box section', (await al.locator('#settings-section-packing').count()) === 0);
await al.context().close();

// 3. Packer records with Box-1, types the weight after stopping, then scans the next order.
const pk = await open({ email: 'pat@test.local', password: 'PackerPass1' });
await pk.getByRole('button', { name: /Scan & Record/ }).first().click();
await pk.waitForSelector('#box-details-card', { timeout: 15000 });
await pk.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await pk.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
await pk.fill('#orderIdInput', 'BOX-ORDER-1');
await pk.waitForTimeout(500);
await pk.selectOption('#platformSelect', 'Amazon');
check('panel follows the order', (await pk.locator('#box-details-order').innerText()).includes('BOX-ORDER-1'));
await pk.screenshot({ path: `${SHOTS}/before-start.png` });
await pk.getByRole('button', { name: /Start Recording/i }).first().click();
await pk.waitForSelector('text=/Recording \\(/', { timeout: 10000 });
const boxId = await pk.locator('#boxPresetSelect option', { hasText: 'Box-1' }).getAttribute('value');
await pk.selectOption('#boxPresetSelect', boxId);
check('preset fills L B H', (await pk.inputValue('#box-l')) === '10' && (await pk.inputValue('#box-h')) === '3');
check('volumetric shown live', (await pk.locator('#box-volumetric').innerText()).includes('0.06'), await pk.locator('#box-volumetric').innerText());
await pk.screenshot({ path: `${SHOTS}/recording-box.png` });
await pk.waitForTimeout(3000);
await pk.getByRole('button', { name: /Stop/i }).first().click();
await pk.waitForSelector('text=/saved & queued|queued for/i', { timeout: 30000 });
await pk.waitForTimeout(1500);
let rows = backend.rt.sheets.get('PackageDetails')?.rows || [];
check('saved at stop (box, no weight yet)', rows.length === 2 && rows[1][1] === 'BOX-ORDER-1' && rows[1][2] === 'Amazon' && rows[1][4] === 'Box-1' && rows[1][8] === '', JSON.stringify(rows[1] || []));
check('panel still shows the recorded order', (await pk.locator('#box-details-order').innerText()).includes('BOX-ORDER-1'));
await pk.fill('#box-weight', '0.4');
check('chargeable = actual when heavier', (await pk.locator('#box-chargeable').innerText()).includes('0.4'), await pk.locator('#box-chargeable').innerText());
// Next order scanned with a hardware scanner (fast keys + Enter) while the weight box still has focus.
await pk.locator('#box-weight').focus();
await pk.keyboard.type('BOX-ORDER-2', { delay: 5 });
await pk.keyboard.press('Enter');
await pk.waitForTimeout(2000);
// The usual "not in pre-pack manifest" prompt for an unknown order.
if (await pk.getByRole('button', { name: 'Proceed Unverified' }).count()) await pk.getByRole('button', { name: 'Proceed Unverified' }).click();
check('scan went to the order, not the weight box', (await pk.inputValue('#orderIdInput')) === 'BOX-ORDER-2', await pk.inputValue('#orderIdInput'));
rows = backend.rt.sheets.get('PackageDetails').rows;
const r1 = rows.find((r) => r[1] === 'BOX-ORDER-1');
check('weight typed after stop saved for order 1', r1 && r1[2] === 'Amazon' && r1[8] === 0.4 && r1[9] === 0.06 && r1[10] === 0.4, JSON.stringify(r1));
check('one row for order 1', rows.filter((r) => r[1] === 'BOX-ORDER-1').length === 1);
check('fields empty for the next order', (await pk.inputValue('#box-l')) === '' && (await pk.inputValue('#box-weight')) === '');

// 4. Custom size for order 2 saved as a new box, then Save.
await pk.selectOption('#platformSelect', 'Amazon');
await pk.fill('#box-l', '30');
await pk.fill('#box-b', '25');
await pk.fill('#box-h', '20');
await pk.fill('#box-weight', '1.5');
check('volumetric 3 kg for 30x25x20', (await pk.locator('#box-volumetric').innerText()).includes('3 kg'), await pk.locator('#box-volumetric').innerText());
await pk.locator('#box-add-preset').click();
await pk.fill('#box-preset-name', 'Box-2');
await pk.locator('#box-preset-save').click();
await pk.waitForSelector('#boxPresetSelect >> option:has-text("Box-2 30x25x20 cm")', { state: 'attached' });
await pk.screenshot({ path: `${SHOTS}/custom-box.png` });
await pk.locator('#box-details-save').click();
await pk.waitForSelector('#box-details-saved');
rows = backend.rt.sheets.get('PackageDetails').rows;
const r2 = rows.find((r) => r[1] === 'BOX-ORDER-2');
check('order 2 saved with Box-2', r2 && r2[4] === 'Box-2' && r2[9] === 3 && r2[10] === 3, JSON.stringify(r2));
await pk.screenshot({ path: `${SHOTS}/saved.png` });
await pk.context().close();

// 5. Report download (Super Admin) has the columns.
backend.rt.sheets.get('OrderLog').appendRow([new Date(), 'BOX-ORDER-1', 'Amazon', 'pat@test.local', 'FILE_BOX1', '', '1 MB', 'Completed', 'Forward', 'j1', 'video/mp4', 'READY']);
await sa.getByRole('button', { name: /^Reports$/ }).first().click();
await sa.locator('#preview-report-btn').click();
await sa.waitForSelector('text=BOX-ORDER-1', { timeout: 20000 });
const head = await sa.locator('thead').first().innerText();
check('report table has the box columns', /Volumetric Weight \(kg\)/.test(head) && /Chargeable Weight/.test(head), head.replace(/\s+/g, ' '));
await sa.screenshot({ path: `${SHOTS}/report.png`, fullPage: false });
const dl = sa.waitForEvent('download');
await sa.getByRole('button', { name: /Export CSV/ }).first().click();
const file = await (await dl).path();
const csv = readFileSync(file, 'utf8');
const [hdr, ...lines] = csv.split('\n');
const line = lines.find((l) => l.includes('BOX-ORDER-1')) || '';
check('CSV has box columns', hdr.includes('"Box"') || hdr.includes('Box,') || /Box/.test(hdr), hdr);
check('CSV row has Box-1 and weights', line.includes('"Box-1"') && line.includes('"0.06"') && line.includes('"0.4"'), line);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.table(results);
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
