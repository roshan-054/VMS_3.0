/**
 * Box dimensions & volumetric weight while packing.
 *
 * Volumetric weight (kg) = Length x Breadth x Height (cm) / divisor. The divisor is 5000 by
 * default (the usual courier value) and the Super Admin can change it in Settings. Chargeable
 * weight is the larger of actual and volumetric weight. The backend works the numbers out again
 * when it saves, so the report always matches the saved divisor.
 */
import { requestApi } from './api';

export interface BoxPreset {
  id: string;
  name: string;
  l: number;
  b: number;
  h: number;
  by?: string;
}

export interface BoxSettings {
  enabled: boolean;
  divisor: number;
  presets: BoxPreset[];
}

export interface PackageDetailsInput {
  orderId: string;
  platform: string;
  recordingType: string;
  boxName: string;
  l: number | null;
  b: number | null;
  h: number | null;
  actualWeight: number | null;
}

export const DEFAULT_VOLUMETRIC_DIVISOR = 5000;
const SETTINGS_KEY = 'vms_box_settings';
const PENDING_KEY = 'vms_box_pending';
export const BOX_SETTINGS_EVENT = 'vms_box_settings_updated';

/** A positive number from what was typed ("10", "10.5", "10,5"), or null when empty/invalid. */
export function parseBoxNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(',', '.').trim();
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function volumetricWeight(l: number | null, b: number | null, h: number | null, divisor = DEFAULT_VOLUMETRIC_DIVISOR): number | null {
  if (!(l && l > 0 && b && b > 0 && h && h > 0)) return null;
  const d = divisor > 0 ? divisor : DEFAULT_VOLUMETRIC_DIVISOR;
  return round2((l * b * h) / d);
}

export function chargeableWeight(actual: number | null, volumetric: number | null): number | null {
  if (actual && volumetric) return round2(Math.max(actual, volumetric));
  if (volumetric) return volumetric;
  if (actual) return round2(actual);
  return null;
}

/** "Box-1 10x10x3 cm" */
export function presetLabel(p: BoxPreset): string {
  return `${p.name} ${fmtNum(p.l)}x${fmtNum(p.b)}x${fmtNum(p.h)} cm`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return '';
  return String(round2(n));
}

function normalizeSettings(res: any): BoxSettings {
  const d = Number(res?.divisor);
  return {
    enabled: res?.enabled === true,
    divisor: isFinite(d) && d > 0 ? d : DEFAULT_VOLUMETRIC_DIVISOR,
    presets: Array.isArray(res?.presets) ? res.presets : [],
  };
}

export function getCachedBoxSettings(): BoxSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch (_) {}
  return { enabled: false, divisor: DEFAULT_VOLUMETRIC_DIVISOR, presets: [] };
}

function cacheSettings(s: BoxSettings): BoxSettings {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(BOX_SETTINGS_EVENT, { detail: s })); } catch (_) {}
  return s;
}

export async function fetchBoxSettings(): Promise<BoxSettings> {
  const res = await requestApi('getBoxSettings', {});
  return cacheSettings(normalizeSettings(res));
}

/** Super Admin only (the backend refuses everyone else). */
export async function setBoxFeature(change: { enabled?: boolean; divisor?: number }): Promise<BoxSettings> {
  const res = await requestApi('setBoxFeature', change);
  return cacheSettings(normalizeSettings(res));
}

export async function saveBoxPreset(p: { name: string; l: number; b: number; h: number }): Promise<{ settings: BoxSettings; preset: BoxPreset }> {
  const res: any = await requestApi('saveBoxPreset', p);
  return { settings: cacheSettings(normalizeSettings(res)), preset: res.preset };
}

export async function deleteBoxPreset(id: string): Promise<BoxSettings> {
  const res = await requestApi('deleteBoxPreset', { id });
  return cacheSettings(normalizeSettings(res));
}

function readPending(): PackageDetailsInput[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function writePending(list: PackageDetailsInput[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-200))); } catch (_) {}
}

const sameOrder = (a: PackageDetailsInput, b: PackageDetailsInput) =>
  a.orderId.trim().toLowerCase() === b.orderId.trim().toLowerCase() &&
  String(a.recordingType).toLowerCase() === String(b.recordingType).toLowerCase();

/**
 * Save one order's box details. If the backend cannot be reached, they are kept on this
 * computer and sent with the next save (or the next time the record screen opens).
 * Errors from the backend itself (for example "switched off") are thrown.
 */
export async function savePackageDetails(input: PackageDetailsInput): Promise<any> {
  try {
    const res = await requestApi('savePackageDetails', { ...input });
    writePending(readPending().filter((x) => !sameOrder(x, input)));
    flushPendingPackageDetails().catch(() => undefined);
    return res;
  } catch (e: any) {
    if (e?.serverError) throw e;
    writePending([...readPending().filter((x) => !sameOrder(x, input)), input]);
    const err: any = new Error('No connection: box details are kept on this computer and will be sent automatically.');
    err.queued = true;
    throw err;
  }
}

let flushing = false;
export async function flushPendingPackageDetails(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of readPending()) {
      try {
        await requestApi('savePackageDetails', { ...item });
        sent++;
        writePending(readPending().filter((x) => !sameOrder(x, item)));
      } catch (e: any) {
        if (!e?.serverError) break; // still offline: try again later
        writePending(readPending().filter((x) => !sameOrder(x, item))); // refused: drop it
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function pendingPackageDetailsCount(): number {
  return readPending().length;
}
