// E2E: at common laptop/desktop widths the Order panel is wide enough to read a full
// Amazon order ID, and the camera stays the main area.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const backend = createMockBackend();
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => results.push({ check: name, pass: !!ok, detail: String(detail).slice(0, 110) });
const ORDER = '404-1234567-7654321';
for (const width of [1280, 1366, 1440, 1920]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await attach(page, backend);
  await login(page, BASE, backend);
  await page.fill('#orderIdInput', ORDER);
  const m = await page.evaluate(() => {
    const i = document.querySelector('#orderIdInput');
    const cam = document.querySelector('#camera-viewport-card').getBoundingClientRect();
    const panel = document.querySelector('#order-details-card').getBoundingClientRect();
    return { fits: i.scrollWidth <= i.clientWidth, input: i.clientWidth, panel: Math.round(panel.width), cam: Math.round(cam.width), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  check(`${width}px: full order ID visible`, m.fits, `input ${m.input}px, panel ${m.panel}px, camera ${m.cam}px`);
  check(`${width}px: camera is the main area, no sideways scroll`, m.cam > m.panel * 1.4 && !m.overflow, `camera ${m.cam}px vs panel ${m.panel}px`);
  if (width === 1440) await page.screenshot({ path: process.env.SHOT || '/tmp/claude-0/scan-layout-1440.png' });
  await page.close();
}
console.table(results);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
