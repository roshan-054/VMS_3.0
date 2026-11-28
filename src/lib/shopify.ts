/**
 * Shopify orders in VMS.
 *
 * The backend fetches new and changed Shopify orders every 5 minutes into the ShopifyOrders tab
 * (copied to Supabase like every other tab). Order Processing reads them here: typing or picking a
 * Shopify order fills in its products, SKUs and quantities, and each SKU gets its barcode from the
 * GTIN catalog, so the packer can scan-verify every item.
 */
import { requestApi, normalizeOrderId } from './api';
import { findProductInCatalog, isBarcodeEqual } from './manifestStorage';
import type { ManifestItem } from '../types';

export interface ShopifyOrderItem {
  id: string;
  sku: string;
  productName: string;
  shortName: string;
  shopifyName: string;
  gtin: string;
  quantity: number;
  imageUrl: string;
  inCatalog: boolean;
}

export interface ShopifyOrder {
  orderId: string;
  orderDate: string;
  payment: string;
  fulfillment: string;
  status: 'Open' | 'Cancelled' | 'Fulfilled' | string;
  /** 'COD' or 'Prepaid' */
  paymentMode: string;
  tags: string;
  totalItems: number;
  items: ShopifyOrderItem[];
  missingGtin: number;
  syncedAt: string;
}

export interface ShopifyOrdersResult {
  enabled: boolean;
  orders: ShopifyOrder[];
  lastSync: string | null;
}

export interface ShopifySyncResult {
  success: boolean;
  at: string;
  error?: string;
  fetched?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  skipped?: number;
  cancelledManifests?: number;
  more?: boolean;
  firstRun?: boolean;
  source?: string;
  /** false when Shopify did not allow reading customer details (orders still arrive). */
  customerData?: boolean;
  note?: string;
}

export interface ShopifySettings {
  enabled: boolean;
  shop: string;
  clientId: string;
  hasClientSecret: boolean;
  hasAdminToken: boolean;
  connectedWith: '' | 'clientCredentials' | 'adminToken';
  backfillDays: number;
  autoSync: boolean;
  cursor: string;
  lastResult: ShopifySyncResult | null;
}

export const SHOPIFY_ORDERS_EVENT = 'vms_shopify_orders_updated';
const CACHE_KEY = 'vms_shopify_orders';
let memo: ShopifyOrdersResult | null = null;

export function getCachedShopifyOrders(): ShopifyOrdersResult {
  if (memo) return memo;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) memo = JSON.parse(raw);
  } catch (_) {}
  return memo || { enabled: false, orders: [], lastSync: null };
}

function cache(r: ShopifyOrdersResult) {
  memo = r;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(r)); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(SHOPIFY_ORDERS_EVENT)); } catch (_) {}
  return r;
}

/** Open Shopify orders (not cancelled, not shipped) with their products. */
export async function fetchShopifyOrders(): Promise<ShopifyOrdersResult> {
  const res: any = await requestApi('getShopifyOrders', { status: 'open' });
  return cache({ enabled: !!res.enabled, orders: Array.isArray(res.orders) ? res.orders : [], lastSync: res.lastSync || null });
}

/** One Shopify order by any form of its ID (#OD-10360, OD-10360, od 10360), from the last list. */
export function findShopifyOrder(orderId: string, list?: ShopifyOrder[]): ShopifyOrder | null {
  const key = normalizeOrderId(orderId);
  if (!key) return null;
  return (list || getCachedShopifyOrders().orders).find((o) => normalizeOrderId(o.orderId) === key) || null;
}

/** Look one order up on the backend (also finds cancelled or shipped orders). */
export async function lookupShopifyOrder(orderId: string): Promise<ShopifyOrder | null> {
  const res: any = await requestApi('getShopifyOrders', { orderId });
  return (Array.isArray(res.orders) && res.orders[0]) || null;
}

/** Any member: fetch new orders from Shopify now. */
export async function syncShopifyNow(): Promise<ShopifySyncResult> {
  const res: any = await requestApi('shopifySyncNow', {});
  return res as ShopifySyncResult;
}

export async function fetchShopifySettings(): Promise<ShopifySettings> {
  return (await requestApi('getShopifySettings', {})) as any;
}

export async function saveShopifySettings(change: {
  shop?: string; clientId?: string; clientSecret?: string; adminToken?: string;
  clearClientSecret?: boolean; clearAdminToken?: boolean; enabled?: boolean; backfillDays?: number;
}): Promise<ShopifySettings> {
  return (await requestApi('saveShopifySettings', change)) as any;
}

export async function testShopifyConnection(): Promise<{ shopName: string; shop: string; latestOrder: string; latestOrderAt: string }> {
  return (await requestApi('testShopifyConnection', {})) as any;
}

/**
 * The order's products as manifest items. The barcode comes from the backend's catalog match by
 * SKU; when that is empty this station's catalog copy is tried too (it may be newer).
 */
export function shopifyItemsToManifest(order: ShopifyOrder): ManifestItem[] {
  const stamp = Date.now();
  return order.items.map((it, i) => {
    let gtin = it.gtin || '';
    let productName = it.productName || it.shopifyName;
    let shortName = it.shortName || productName;
    let imageUrl = it.imageUrl || '';
    if (!gtin && it.sku) {
      const p = findProductInCatalog(it.sku);
      if (p && p.gtin && isBarcodeEqual(p.sku, it.sku)) {
        gtin = p.gtin;
        productName = p.productName || productName;
        shortName = p.shortName || p.productName || shortName;
        imageUrl = p.imageUrl || imageUrl;
      }
    }
    return {
      id: 'item-' + (i + 1) + '-' + stamp,
      sku: (it.sku || '').trim().toUpperCase(),
      productName,
      shortName,
      gtin: gtin.trim().toUpperCase(),
      quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
      scannedCount: 0,
      imageUrl: imageUrl || undefined,
    };
  });
}

/** Items still without a barcode (their SKU is not in the GTIN catalog). */
export function itemsMissingGtin(items: ManifestItem[]): ManifestItem[] {
  return items.filter((it) => !String(it.gtin || '').trim());
}
