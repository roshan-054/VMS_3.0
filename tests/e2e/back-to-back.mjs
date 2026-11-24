// E2E: five recordings in a row on one camera session must all use the worker encoder and all
// contain video (guards against the camera feed dying after a few orders).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createMockBackend, attach, login } = require('./mockBackend.cjs');

const BASE = process.env.APP_URL || 'http://localhost:5179/';
const dir = mkdtempSync(join(tmpdir(), 'b2b-'));
const backend = createMockBackend();
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=fps=30'] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await attach(page, backend);
await login(page, BASE, backend);
await page.getByRole('button', { name: /Scan & Record/ }).first().click();
await page.getByRole('button', { name: /Open Camera Feed/ }).first().click();
await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0; });
const rows = [];
for (let i = 0; i < 5; i++) {
  await page.fill('#orderIdInput', `B2B-${i}`);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Start Recording/i }).first().click();
  await page.waitForSelector('text=/Recording \\(/');
  const engine = await page.evaluate(() => window.__vmsRecorderMode);
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Stop/i }).first().click();
  const d = await dl;
  const f = join(dir, d.suggestedFilename());
  await d.saveAs(f);
  const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim());
  rows.push({ order: `B2B-${i}`, engine, frames, pass: engine.startsWith('webcodecs') && frames > 45 });
  await page.waitForTimeout(500);
}
console.table(rows);
await browser.close();
process.exit(rows.every((r) => r.pass) ? 0 : 1);
