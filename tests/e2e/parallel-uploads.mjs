// E2E: two stations finish recordings while 3 of the 4 shared upload slots are held by other
// stations. One station starts uploading straight away, the other shows "Waiting for a free
// upload slot" and starts as soon as a slot frees up. (Before: only 1 upload company-wide.)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const { rt } = backend;
const log = [];
const origPost = rt.sandbox.doPost;
rt.sandbox.doPost = (e) => {
  const out = origPost(e);
  try {
    const body = JSON.parse(e.postData.contents);
    if (/Upload|Chunk|Slot/i.test(body.action)) log.push(`${body.action} ${body.orderId || body.uploadId || ''} -> ${out.text.slice(0, 160)}`);
  } catch {}
  return out;
};
const busy = {};
for (let i = 1; i <= 3; i++) busy[`other-${i}`] = { uploadId: `other-${i}`, orderId: `OTHER-${i}`, packerEmail: `station${i}@x`, startedAt: Date.now(), lastHeartbeatAt: Date.now() };
const keepAlive = setInterval(() => {
  const slots = JSON.parse(rt.props.get('ACTIVE_UPLOAD_SLOTS') || '{}');
  Object.keys(busy).forEach((id) => { if (busy[id]) slots[id] = { ...busy[id], lastHeartbeatAt: Date.now() }; });
  rt.props.set('ACTIVE_UPLOAD_SLOTS', JSON.stringify(slots));
}, 500);

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30', '--autoplay-policy=no-user-gesture-required'] });
async function station(order) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  await page.fill('#orderIdInput', order);
  await page.waitForTimeout(500); if (!(await page.locator('#platformSelect').inputValue())) await page.selectOption('#platformSelect', 'Amazon'); // no default platform any more
  return page;
}
const a = await station('PAR-A-0001');
const b = await station('PAR-B-0002');
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 110) });
const slotOrders = () => Object.values(JSON.parse(rt.props.get('ACTIVE_UPLOAD_SLOTS') || '{}')).map((s) => s.orderId);

const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const done = (order) => log.some((l) => l.startsWith(`uploadChunk ${order}`) && l.includes('"complete":true'));
const queued = (order) => log.some((l) => l.startsWith(`startUpload ${order}`) && l.includes('"queuedInCloud":true'));
async function recordOn(page) {
  await page.getByRole('button', { name: /Start Recording/i }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Stop/i }).first().click();
}

// 3 of 4 slots busy: station A uploads straight away (before, it had to wait for all of them).
await recordOn(a);
check('3 slots busy: station A uploads without waiting', await waitFor(() => done('PAR-A-0001'), 20000) && !queued('PAR-A-0001'), log.filter((l) => l.includes('PAR-A')).length + ' calls');

// All 4 busy: station B waits and says so.
busy['other-4'] = { uploadId: 'other-4', orderId: 'OTHER-4', packerEmail: 'station4@x', startedAt: Date.now(), lastHeartbeatAt: Date.now() };
await a.waitForTimeout(800);
await recordOn(b);
check('4 slots busy: station B is told to wait', await waitFor(() => queued('PAR-B-0002'), 20000) && !done('PAR-B-0002'));
await b.getByRole('button', { name: /Upload Queue/ }).first().click();
const waiting = await b.waitForSelector('text=/Waiting for a free upload slot/', { timeout: 15000 }).then(() => true).catch(() => false);
check('station B shows "Waiting for a free upload slot"', waiting, waiting ? '' : (await b.locator('main').innerText()).slice(0, 110));

// Another station finishes: its slot frees and B uploads.
busy['other-1'] = null;
const slots = JSON.parse(rt.props.get('ACTIVE_UPLOAD_SLOTS') || '{}'); delete slots['other-1']; rt.props.set('ACTIVE_UPLOAD_SLOTS', JSON.stringify(slots));
check('station B uploads as soon as a slot frees up', await waitFor(() => done('PAR-B-0002'), 20000));

clearInterval(keepAlive);
if (process.env.DEBUG) console.log(log.join('\n'));
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
