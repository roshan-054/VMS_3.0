/**
 * Return details recorded with a Return video: RTO or customer return, the logistics partner
 * that brought it back (a shared list anyone can add to), the condition, notes, whether the
 * customer said they never received it, and the customer's pincode / name / phone (filled in
 * from the order data when it has them). Used by the Return & RTO analytics.
 */
import { requestApi } from './api';

export interface LogisticsPartner {
  id: string;
  name: string;
  by?: string;
}

export interface ReturnSettings {
  partners: LogisticsPartner[];
  conditions: string[];
  returnTypes: string[];
}

export interface ReturnDetailsInput {
  orderId: string;
  platform: string;
  returnType: string;
  logisticsPartner: string;
  condition: string;
  notes: string;
  pincode: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notReceivedClaim: boolean;
}

export interface ReturnOrderInfo {
  returnType?: string;
  logisticsPartner?: string;
  condition?: string;
  notes?: string;
  pincode?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notReceivedClaim?: boolean;
  city?: string;
  state?: string;
}

export const DEFAULT_RETURN_CONDITIONS = ['Good / resellable', 'Opened / used', 'Damaged', 'Missing items', 'Wrong item', 'Empty box'];
export const RETURN_TYPES = ['RTO', 'Customer Return'];
const SETTINGS_KEY = 'vms_return_settings';
const PENDING_KEY = 'vms_return_pending';
export const RETURN_SETTINGS_EVENT = 'vms_return_settings_updated';

function normalizeSettings(res: any): ReturnSettings {
  return {
    partners: Array.isArray(res?.partners) ? res.partners : [],
    conditions: Array.isArray(res?.conditions) && res.conditions.length ? res.conditions : DEFAULT_RETURN_CONDITIONS,
    returnTypes: Array.isArray(res?.returnTypes) && res.returnTypes.length ? res.returnTypes : RETURN_TYPES,
  };
}

export function getCachedReturnSettings(): ReturnSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch (_) {}
  return normalizeSettings({});
}

function cacheSettings(s: ReturnSettings): ReturnSettings {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(RETURN_SETTINGS_EVENT, { detail: s })); } catch (_) {}
  return s;
}

export async function fetchReturnSettings(): Promise<ReturnSettings> {
  return cacheSettings(normalizeSettings(await requestApi('getReturnSettings', {})));
}

export async function saveLogisticsPartner(name: string): Promise<{ settings: ReturnSettings; partner: LogisticsPartner }> {
  const res: any = await requestApi('saveLogisticsPartner', { name });
  return { settings: cacheSettings(normalizeSettings(res)), partner: res.partner };
}

export async function deleteLogisticsPartner(id: string): Promise<ReturnSettings> {
  return cacheSettings(normalizeSettings(await requestApi('deleteLogisticsPartner', { id })));
}

export async function getReturnOrderInfo(orderId: string, platform: string): Promise<{ saved: ReturnOrderInfo | null; order: ReturnOrderInfo | null }> {
  const res: any = await requestApi('getReturnOrderInfo', { orderId, platform });
  return { saved: res?.saved || null, order: res?.order || null };
}

/** Digits only, at most 6. */
export const cleanPincode = (v: string) => String(v || '').replace(/\D+/g, '').slice(0, 6);

function readPending(): ReturnDetailsInput[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function writePending(list: ReturnDetailsInput[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-200))); } catch (_) {}
}

const sameOrder = (a: ReturnDetailsInput, b: ReturnDetailsInput) => a.orderId.trim().toLowerCase() === b.orderId.trim().toLowerCase();

/**
 * Save one order's return details. Offline, they are kept on this computer and sent with the next
 * save (or the next time the record screen opens). Errors from the backend itself are thrown.
 */
export async function saveReturnDetails(input: ReturnDetailsInput): Promise<any> {
  try {
    const res = await requestApi('saveReturnDetails', { ...input });
    writePending(readPending().filter((x) => !sameOrder(x, input)));
    flushPendingReturnDetails().catch(() => undefined);
    return res;
  } catch (e: any) {
    if (e?.serverError) throw e;
    writePending([...readPending().filter((x) => !sameOrder(x, input)), input]);
    const err: any = new Error('No connection: return details are kept on this computer and will be sent automatically.');
    err.queued = true;
    throw err;
  }
}

let flushing = false;
export async function flushPendingReturnDetails(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of readPending()) {
      try {
        await requestApi('saveReturnDetails', { ...item });
        sent++;
        writePending(readPending().filter((x) => !sameOrder(x, item)));
      } catch (e: any) {
        if (!e?.serverError) break;
        writePending(readPending().filter((x) => !sameOrder(x, item)));
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
