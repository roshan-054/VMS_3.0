// E2E: in Night Mode, every visible piece of text on every tab is readable against what is
// behind it (WCAG contrast >= 3), and no large light panels are left over.
// Dev server on :5179, then node tests/e2e/dark-mode-contrast.mjs  (SHOTS=dir to save screenshots)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const SHOTS = process.env.SHOTS || '';
const backend = createMockBackend({ manifests: 80 });
const ul = backend.rt.sheets.get('UploadLog');
for (let i = 0; i < 6; i++) ul.appendRow([new Date(), `DM-${i}`, 'Amazon', 'admin@test.local', `DM-${i}.mp4`, '2 MB', `up-${i}`, i % 2 ? 'Upload failed' : 'Uploaded to Google Drive', i % 2 ? 20 : 100, i % 2 ? '' : `FILE_DM_${i}`, i % 2 ? 'Failed' : 'Completed', i % 2 ? 'Network lost' : '', 'Forward', 'UploadLog', `job-dm-${i}`]);

const TABS = ['Scan & Record', 'Order Processing', 'Upload Queue', 'Upload Logs', 'Search Videos', 'Reports', 'Analytics', 'Health & Diagnostics', 'Admin & Users'];
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await attach(page, backend);
await page.addInitScript(() => localStorage.setItem('vms_night_mode', 'true'));
await login(page, BASE, backend);

const scan = () => page.evaluate(() => {
  // Tailwind 4 uses oklch(); let a canvas turn any CSS colour into sRGB.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const parse = (c) => {
    if (!c || c === 'transparent') return null;
    if (cache.has(c)) return cache.get(c);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const out = a === 0 ? null : { r, g, b, a: a / 255 };
    cache.set(c, out);
    return out;
  };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) return null; // gradient: skip
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    let out = { r: 11, g: 15, b: 25, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  };
  const bad = [];
  const light = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.qr-code-white-card, video, canvas, svg')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 3) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) continue;
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    const bg = bgOf(el);
    if (!bg) continue;
    if (ownText && !el.closest('[disabled]') && !(el.matches('input, select, textarea'))) {
      const fg0 = parse(cs.color);
      if (fg0) {
        const fg = blend(fg0, bg);
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 3) {
          const key = el.className + '|' + ownText.slice(0, 30);
          if (!seen.has(key)) { seen.add(key); bad.push({ text: ownText.slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, cls: String(el.className).slice(0, 140) }); }
        }
      }
    }
    const own = parse(cs.backgroundColor);
    if (own && own.a > 0.5 && lum(own) > 0.5 && r.width * r.height > 4000 && !el.matches('button, a, [role="button"]') ) {
      light.push({ cls: String(el.className).slice(0, 140), bg: cs.backgroundColor, size: `${Math.round(r.width)}x${Math.round(r.height)}`, text: (el.textContent || '').trim().slice(0, 40) });
    }
  }
  return { bad, light };
});

const report = {};
for (const tab of TABS) {
  const btn = page.getByRole('button', { name: tab }).first();
  if (!(await btn.count())) { report[tab] = 'tab missing'; continue; }
  await btn.click();
  await page.waitForTimeout(2500);
  report[tab] = await scan();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${tab.replace(/[^a-z]+/gi, '-')}.png`, fullPage: false });
}
// Sub-pages and pop-ups
const extra = async (name, fn) => {
  try { await fn(); await page.waitForTimeout(1500); report[name] = await scan(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name.replace(/[^a-z]+/gi, '-')}.png` }); }
  catch (e) { report[name] = `could not open: ${String(e.message).split('\n')[0]}`; }
};
for (const sub of ['Logo & Favicon', 'Apps Script & Drive Settings']) {
  await extra(`Admin > ${sub}`, async () => { await page.getByRole('button', { name: 'Admin & Users' }).first().click(); await page.getByRole('button', { name: new RegExp(sub.replace('&', '.')) }).first().click(); });
}
await extra('Upload Logs > details', async () => {
  await page.getByRole('button', { name: 'Upload Logs' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('button[title="View Complete Log Metadata"]').first().click();
});
await page.keyboard.press('Escape');
await extra('Upload Logs > player', async () => {
  await page.locator('button[title="Play Video in Portal"]').first().click();
});
await page.keyboard.press('Escape');
await extra('Clear Cache dialog', async () => { await page.locator('#nav-clear-cache-btn').click(); });
await page.keyboard.press('Escape');
await browser.close();
let total = 0;
for (const [tab, r] of Object.entries(report)) {
  if (typeof r === 'string') { console.log(`## ${tab}: ${r}`); continue; }
  total += r.bad.length + r.light.length;
  console.log(`## ${tab}: ${r.bad.length} low-contrast, ${r.light.length} light panels`);
  for (const b of r.bad.slice(0, 40)) console.log(`  [${b.ratio}] "${b.text}" ${b.color} on ${b.bg} :: ${b.cls}`);
  for (const l of r.light.slice(0, 15)) console.log(`  LIGHT ${l.bg} ${l.size} "${l.text}" :: ${l.cls}`);
}
console.log(total ? `${total} PROBLEMS` : 'ALL READABLE');
process.exit(total ? 1 : 0);
