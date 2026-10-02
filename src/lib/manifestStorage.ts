import { OrderManifest, ManifestItem, GtinCatalogProduct, PackVerificationLog } from '../types';
import { requestApi } from './api';

const STORAGE_KEY_MANIFESTS = 'vms_order_manifests_v1';
const STORAGE_KEY_GTIN_CATALOG = 'vms_gtin_catalog_v1';
const STORAGE_KEY_GTIN_CONFIG = 'vms_gtin_sheet_config_v1';
const STORAGE_KEY_VERIFICATION_LOGS = 'vms_pack_verification_logs_v1';
const STORAGE_KEY_VERIFICATION_SETTINGS = 'vms_pack_verification_settings_v1';

export interface GtinSheetConfig {
  sheetIdOrUrl: string;
  tabName: string;
  autoSync: boolean;
  lastSyncTime?: string;
  totalSyncedItems?: number;
}

export interface VerificationSettings {
  enforceManifestCheck: boolean; // Must be in manifest before packing
  enforceGtinVerification: boolean; // Must scan all GTIN barcodes before video starts
  allowSupervisorOverride: boolean; // Allow supervisor PIN to bypass if barcode is missing/damaged
}

export const DEFAULT_VERIFICATION_SETTINGS: VerificationSettings = {
  enforceManifestCheck: true,
  enforceGtinVerification: true,
  allowSupervisorOverride: true,
};

// Seed sample GTIN catalog items so the system is immediately usable out of the box
const DEFAULT_GTIN_CATALOG: GtinCatalogProduct[] = [
  {
    gtin: '8901234567890',
    sku: 'SKU-SHIRT-BLUE-L',
    productName: 'Premium Cotton Oxford Shirt - Navy Blue (Size L)',
    shortName: 'Navy Oxford Shirt (L)',
    category: 'Apparel',
    imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=300&q=80',
    notes: 'Standard Polybag Packing'
  },
  {
    gtin: '8901234567891',
    sku: 'SKU-SHIRT-WHITE-M',
    productName: 'Crisp Formal White Shirt - Classic Fit (Size M)',
    shortName: 'White Formal Shirt (M)',
    category: 'Apparel',
    imageUrl: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=300&q=80',
    notes: 'Delicate Collar Protection'
  },
  {
    gtin: '8909876543210',
    sku: 'SKU-EARBUDS-PRO',
    productName: 'Wireless Active Noise Cancelling Earbuds Pro - Matte Black',
    shortName: 'ANC Earbuds Pro',
    category: 'Electronics',
    imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=300&q=80',
    notes: 'Fragile - Bubble Wrap Required'
  },
  {
    gtin: '8909876543211',
    sku: 'SKU-CABLE-65W-2M',
    productName: 'Braided Fast Charging Type-C to Type-C Cable 65W (2m)',
    shortName: 'Type-C Cable 65W',
    category: 'Accessories',
    imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300&q=80',
    notes: 'Check Hologram Seal'
  },
  {
    gtin: '8904567890123',
    sku: 'SKU-WATER-BOTTLE-1L',
    productName: 'Insulated Stainless Steel Vacuum Flask 1000ml (Steel Finish)',
    shortName: 'Insulated Flask 1L',
    category: 'Home & Kitchen',
    imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300&q=80',
    notes: 'Box Packaging with Fragile Sticker'
  }
];

// --- Order Manifest Store ---

export function getStoredManifests(): OrderManifest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANIFESTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveStoredManifests(manifests: OrderManifest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_MANIFESTS, JSON.stringify(manifests));
    window.dispatchEvent(new CustomEvent('vms_manifests_updated', { detail: { count: manifests.length } }));
  } catch (e) {
    console.warn('Could not save manifests to localStorage:', e);
  }
}

export function getManifestByOrderId(orderId: string): OrderManifest | null {
  if (!orderId) return null;
  const clean = orderId.trim().toUpperCase();
  const list = getStoredManifests();
  return list.find((m) => m.orderId.trim().toUpperCase() === clean) || null;
}

export async function saveOrderManifest(manifest: OrderManifest): Promise<void> {
  const list = getStoredManifests();
  const cleanId = manifest.orderId.trim().toUpperCase();
  const index = list.findIndex((m) => m.orderId.trim().toUpperCase() === cleanId);

  if (index >= 0) {
    list[index] = { ...manifest, orderId: cleanId };
  } else {
    list.unshift({ ...manifest, orderId: cleanId });
  }

  saveStoredManifests(list);

  // Sync to remote Apps Script backend if available
  try {
    requestApi('saveOrderManifest', { manifest }).catch((err) => {
      console.warn('Remote manifest sync warning:', err);
    });
  } catch (_) {}
}

export async function saveMultipleManifests(manifests: OrderManifest[]): Promise<number> {
  const list = getStoredManifests();
  let addedCount = 0;

  for (const item of manifests) {
    const cleanId = item.orderId.trim().toUpperCase();
    const index = list.findIndex((m) => m.orderId.trim().toUpperCase() === cleanId);
    if (index >= 0) {
      list[index] = { ...item, orderId: cleanId };
    } else {
      list.push({ ...item, orderId: cleanId });
      addedCount++;
    }
  }

  saveStoredManifests(list);

  // Sync batch
  try {
    requestApi('saveOrderManifestsBatch', { manifests }).catch(() => {});
  } catch (_) {}

  return addedCount;
}

export async function updateManifestStatus(
  orderId: string,
  status: OrderManifest['status'],
  items?: ManifestItem[],
  packerDetails?: { name: string; email: string; videoDriveUrl?: string }
): Promise<void> {
  const list = getStoredManifests();
  const cleanId = orderId.trim().toUpperCase();
  const target = list.find((m) => m.orderId.trim().toUpperCase() === cleanId);

  if (target) {
    target.status = status;
    if (items) target.items = items;
    if (packerDetails) {
      target.packedByName = packerDetails.name;
      target.packedByEmail = packerDetails.email;
      if (packerDetails.videoDriveUrl) {
        target.videoDriveUrl = packerDetails.videoDriveUrl;
      }
      if (status === 'Packed') {
        target.packedAt = new Date().toISOString();
      }
    }
    saveStoredManifests(list);

    // Sync to backend
    try {
      requestApi('updateManifestStatus', {
        orderId: cleanId,
        status,
        items,
        packerDetails,
      }).catch(() => {});
    } catch (_) {}
  }
}

export function deleteManifest(orderId: string): void {
  const cleanId = orderId.trim().toUpperCase();
  const list = getStoredManifests().filter((m) => m.orderId.trim().toUpperCase() !== cleanId);
  saveStoredManifests(list);

  try {
    requestApi('deleteOrderManifest', { orderId: cleanId }).catch(() => {});
  } catch (_) {}
}

// --- GTIN Product Catalog Store ---

/**
 * Robust Barcode / GTIN / GSIN Normalizer:
 * - Fixes Excel scientific notation (e.g. "8.901234567890E+12" -> "8901234567890")
 * - Preserves leading zeros (e.g. "0123456789012")
 * - Strips quotes, whitespace, control characters, trailing ".0"
 */
export function normalizeBarcode(input: any): string {
  if (input === null || input === undefined) return '';
  let str = String(input).trim().replace(/^["']|["']$/g, '');

  // Strip trailing .0 from float conversion
  if (/\.0+$/.test(str)) {
    str = str.replace(/\.0+$/, '');
  }

  // Handle scientific notation e.g. 8.90123456789E+12 or 8.90123456789e12
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(str)) {
    try {
      const num = Number(str);
      if (!isNaN(num) && isFinite(num)) {
        str = BigInt(Math.round(num)).toString();
      }
    } catch (_) {}
  }

  // Remove any spaces or invisible characters
  return str.replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim();
}

export function getStoredGtinCatalog(): GtinCatalogProduct[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GTIN_CATALOG);
    if (!raw) {
      // Seed default items initially
      localStorage.setItem(STORAGE_KEY_GTIN_CATALOG, JSON.stringify(DEFAULT_GTIN_CATALOG));
      return DEFAULT_GTIN_CATALOG;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_GTIN_CATALOG;
  } catch (e) {
    return DEFAULT_GTIN_CATALOG;
  }
}

export function saveStoredGtinCatalog(catalog: GtinCatalogProduct[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_GTIN_CATALOG, JSON.stringify(catalog));
    window.dispatchEvent(new CustomEvent('vms_gtin_catalog_updated', { detail: { count: catalog.length } }));
  } catch (e) {
    console.warn('Could not save GTIN catalog:', e);
  }
}

export function findProductInCatalog(query: string): GtinCatalogProduct | null {
  if (!query || !query.trim()) return null;
  const clean = query.trim().toUpperCase();
  const catalog = getStoredGtinCatalog();

  // 1. Exact GTIN match
  const byGtin = catalog.find((p) => p.gtin.trim().toUpperCase() === clean);
  if (byGtin) return byGtin;

  // 2. Exact SKU match
  const bySku = catalog.find((p) => p.sku.trim().toUpperCase() === clean);
  if (bySku) return bySku;

  // 3. Exact Product Name match
  const byName = catalog.find((p) => (p.productName || '').trim().toUpperCase() === clean);
  if (byName) return byName;

  // 4. Exact Short Name match
  const byShortName = catalog.find((p) => (p.shortName || '').trim().toUpperCase() === clean);
  if (byShortName) return byShortName;

  // 5. Fallback: match GTIN without leading zeros
  const noLeadingZero = clean.replace(/^0+/, '');
  if (noLeadingZero.length >= 4) {
    const altMatch = catalog.find((p) => p.gtin.replace(/^0+/, '') === noLeadingZero);
    if (altMatch) return altMatch;
  }

  // 6. Substring / Prefix match on Product Name or Short Name if query length >= 3
  if (clean.length >= 3) {
    const prefixMatch = catalog.find((p) => {
      const name = (p.productName || '').toUpperCase();
      const short = (p.shortName || '').toUpperCase();
      const sku = (p.sku || '').toUpperCase();
      return name.startsWith(clean) || short.startsWith(clean) || sku.startsWith(clean);
    });
    if (prefixMatch) return prefixMatch;

    const containsMatch = catalog.find((p) => {
      const name = (p.productName || '').toUpperCase();
      const short = (p.shortName || '').toUpperCase();
      return name.includes(clean) || short.includes(clean);
    });
    if (containsMatch) return containsMatch;
  }

  return null;
}

export function searchCatalog(query: string, maxResults = 8): GtinCatalogProduct[] {
  if (!query || !query.trim()) return [];
  const clean = query.trim().toUpperCase();
  const catalog = getStoredGtinCatalog();

  return catalog
    .filter((p) => {
      const gtin = (p.gtin || '').toUpperCase();
      const sku = (p.sku || '').toUpperCase();
      const name = (p.productName || '').toUpperCase();
      const short = (p.shortName || '').toUpperCase();
      return (
        gtin.includes(clean) ||
        sku.includes(clean) ||
        name.includes(clean) ||
        short.includes(clean)
      );
    })
    .slice(0, maxResults);
}

export function findProductByGtin(gtinOrSkuOrName: string): GtinCatalogProduct | null {
  return findProductInCatalog(gtinOrSkuOrName);
}

export async function addOrUpdateGtinProduct(product: GtinCatalogProduct): Promise<void> {
  const catalog = getStoredGtinCatalog();
  const cleanGtin = normalizeBarcode(product.gtin);
  if (!cleanGtin) return;

  const normalizedProd: GtinCatalogProduct = {
    ...product,
    gtin: cleanGtin,
    sku: product.sku ? product.sku.trim() : cleanGtin,
    productName: product.productName ? product.productName.trim() : `Product ${cleanGtin}`,
    shortName: product.shortName ? product.shortName.trim() : product.productName || cleanGtin,
  };

  const index = catalog.findIndex((p) => normalizeBarcode(p.gtin) === cleanGtin);

  if (index >= 0) {
    catalog[index] = { ...catalog[index], ...normalizedProd };
  } else {
    catalog.unshift(normalizedProd);
  }

  saveStoredGtinCatalog(catalog);

  try {
    requestApi('saveGtinProduct', { product: normalizedProd }).catch(() => {});
  } catch (_) {}
}

export async function deleteGtinProduct(gtin: string): Promise<boolean> {
  const clean = normalizeBarcode(gtin);
  if (!clean) return false;

  const catalog = getStoredGtinCatalog();
  const filtered = catalog.filter((p) => normalizeBarcode(p.gtin) !== clean);
  saveStoredGtinCatalog(filtered);

  try {
    requestApi('deleteGtinProduct', { gtin: clean }).catch(() => {});
  } catch (_) {}

  return true;
}

export async function deleteMultipleGtinProducts(gtins: string[]): Promise<number> {
  if (!Array.isArray(gtins) || gtins.length === 0) return 0;
  const cleanSet = new Set(gtins.map((g) => normalizeBarcode(g)).filter(Boolean));
  if (cleanSet.size === 0) return 0;

  const catalog = getStoredGtinCatalog();
  const filtered = catalog.filter((p) => !cleanSet.has(normalizeBarcode(p.gtin)));
  const removedCount = catalog.length - filtered.length;
  saveStoredGtinCatalog(filtered);

  try {
    requestApi('deleteGtinProductsBatch', { gtins: Array.from(cleanSet) }).catch(() => {});
  } catch (_) {}

  return removedCount;
}

export async function importGtinCatalog(products: GtinCatalogProduct[]): Promise<number> {
  const catalog = getStoredGtinCatalog();
  let newCount = 0;
  const cleanedProducts: GtinCatalogProduct[] = [];

  for (const item of products) {
    const cleanGtin = normalizeBarcode(item.gtin);
    if (!cleanGtin) continue;

    const normalizedItem: GtinCatalogProduct = {
      ...item,
      gtin: cleanGtin,
      sku: item.sku ? item.sku.trim() : cleanGtin,
      productName: item.productName ? item.productName.trim() : `Product ${cleanGtin}`,
      shortName: item.shortName ? item.shortName.trim() : item.productName || cleanGtin,
    };

    cleanedProducts.push(normalizedItem);

    const index = catalog.findIndex((p) => normalizeBarcode(p.gtin) === cleanGtin);
    if (index >= 0) {
      catalog[index] = { ...catalog[index], ...normalizedItem };
    } else {
      catalog.push(normalizedItem);
      newCount++;
    }
  }

  saveStoredGtinCatalog(catalog);

  try {
    if (cleanedProducts.length > 0) {
      requestApi('saveGtinCatalogBatch', { products: cleanedProducts }).catch(() => {});
    }
  } catch (_) {}

  return newCount;
}

/**
 * Fetch and synchronize GTIN catalog from the master connected Google Sheet ("GTINCatalog" tab)
 * Uses the Branding / master Google Sheet reference as the single source of truth.
 */
export async function syncGtinWithMasterSheet(): Promise<{
  success: boolean;
  count: number;
  message: string;
  items?: GtinCatalogProduct[];
}> {
  try {
    const res = await requestApi<{ success: boolean; catalog?: GtinCatalogProduct[]; error?: string }>(
      'getGtinCatalog',
      {}
    );

    if (res && res.success && Array.isArray(res.catalog)) {
      if (res.catalog.length > 0) {
        // Merge or replace with cloud catalog
        const catalog = getStoredGtinCatalog();
        const map = new Map<string, GtinCatalogProduct>();
        // Add existing local
        catalog.forEach((p) => map.set(normalizeBarcode(p.gtin), p));
        // Overwrite with master cloud sheet
        res.catalog.forEach((p) => {
          const g = normalizeBarcode(p.gtin);
          if (g) map.set(g, { ...p, gtin: g });
        });
        const merged = Array.from(map.values());
        saveStoredGtinCatalog(merged);

        return {
          success: true,
          count: res.catalog.length,
          message: `Successfully synchronized ${res.catalog.length} products from your Master Google Sheet ("GTINCatalog" tab)!`,
          items: merged,
        };
      } else {
        // Master tab is currently empty, push our local catalog to seed it!
        const local = getStoredGtinCatalog();
        if (local.length > 0) {
          await requestApi('saveGtinCatalogBatch', { products: local });
        }
        return {
          success: true,
          count: local.length,
          message: `Connected to Master Google Sheet. Initialized "GTINCatalog" tab with ${local.length} products!`,
          items: local,
        };
      }
    } else {
      throw new Error(res.error || 'Could not fetch GTIN catalog from Google Sheet.');
    }
  } catch (err: any) {
    console.warn('Master Sheet GTIN Sync notice:', err);
    return {
      success: false,
      count: 0,
      message: err.message || 'Failed to sync with master Google Sheet.',
    };
  }
}

// --- Separate GTIN Google Sheet Configuration ---

export function getGtinSheetConfig(): GtinSheetConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GTIN_CONFIG);
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  return {
    sheetIdOrUrl: '',
    tabName: 'Sheet1',
    autoSync: true,
  };
}

export function saveGtinSheetConfig(cfg: GtinSheetConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_GTIN_CONFIG, JSON.stringify(cfg));
    window.dispatchEvent(new CustomEvent('vms_gtin_config_updated', { detail: cfg }));
  } catch (e) {}
}

/**
 * Clean and extract a Google Sheet ID from either a raw ID or full Google Sheets link
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Fetch and synchronize GTIN catalog from the user's separate Google Sheet
 */
export async function syncGtinFromGoogleSheet(
  sheetIdOrUrl?: string,
  tabName?: string
): Promise<{ success: boolean; count: number; message: string; items?: GtinCatalogProduct[] }> {
  const config = getGtinSheetConfig();
  const rawTarget = sheetIdOrUrl || config.sheetIdOrUrl;
  const targetId = extractSpreadsheetId(rawTarget);
  const targetTab = tabName || config.tabName || 'Sheet1';

  if (!targetId) {
    return {
      success: false,
      count: 0,
      message: 'Please provide a valid Google Sheet ID or URL.',
    };
  }

  try {
    // 1. Request Apps Script backend to read the user's separate Google Sheet
    const res = await requestApi<{
      success: boolean;
      items: GtinCatalogProduct[];
      count: number;
      error?: string;
    }>('syncExternalGtinSheet', {
      gtinSheetId: targetId,
      tabName: targetTab,
    });

    if (res && res.success && Array.isArray(res.items)) {
      const imported = await importGtinCatalog(res.items);
      const updatedConfig: GtinSheetConfig = {
        sheetIdOrUrl: targetId,
        tabName: targetTab,
        autoSync: config.autoSync,
        lastSyncTime: new Date().toISOString(),
        totalSyncedItems: res.items.length,
      };
      saveGtinSheetConfig(updatedConfig);

      return {
        success: true,
        count: res.items.length,
        message: `Successfully synchronized ${res.items.length} products from your Google Sheet!`,
        items: res.items,
      };
    } else {
      throw new Error(res.error || 'Could not load products from Google Sheet.');
    }
  } catch (err: any) {
    console.error('Google Sheet GTIN Sync error:', err);
    return {
      success: false,
      count: 0,
      message: err.message || 'Failed to sync with Google Sheet. Ensure the Apps Script has access.',
    };
  }
}

// --- Pack Verification Logs Store ---

export function getStoredVerificationLogs(): PackVerificationLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VERIFICATION_LOGS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveStoredVerificationLogs(logs: PackVerificationLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_VERIFICATION_LOGS, JSON.stringify(logs.slice(0, 500)));
    window.dispatchEvent(new CustomEvent('vms_verification_logs_updated'));
  } catch (e) {}
}

export async function logPackVerification(log: PackVerificationLog): Promise<void> {
  const logs = getStoredVerificationLogs();
  logs.unshift(log);
  saveStoredVerificationLogs(logs);

  // Send to Apps Script backend for Google Sheet logging into PackVerificationLog tab
  try {
    requestApi('logPackVerification', { log }).catch((e) => {
      console.warn('Pack verification sheet logging notice:', e);
    });
  } catch (_) {}
}

/**
 * Real-Time Cloud Sync: Fetch live manifest orders from Google Sheet ("Manifest_Orders" tab)
 * Allows Admin and Packers to see real-time order creation, status changes, and completion.
 */
export async function syncManifestsWithCloud(): Promise<{ success: boolean; manifests?: OrderManifest[]; error?: string }> {
  try {
    const res = await requestApi<{ success: boolean; manifests?: OrderManifest[]; error?: string }>('getOrderManifests', {});
    if (res && res.success && Array.isArray(res.manifests)) {
      if (res.manifests.length > 0) {
        // Merge cloud manifests with local manifests
        const local = getStoredManifests();
        const map = new Map<string, OrderManifest>();
        local.forEach((m) => map.set(m.orderId.toUpperCase(), m));
        res.manifests.forEach((m) => {
          if (m.orderId) {
            map.set(m.orderId.toUpperCase(), m);
          }
        });
        const merged = Array.from(map.values());
        saveStoredManifests(merged);
        return { success: true, manifests: merged };
      }
    }
    return { success: true, manifests: getStoredManifests() };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Manifest cloud sync error' };
  }
}

/**
 * Real-Time Cloud Sync: Fetch live pack verification logs from Google Sheet ("PackVerificationLog" tab)
 */
export async function syncVerificationLogsWithCloud(): Promise<{ success: boolean; logs?: PackVerificationLog[]; error?: string }> {
  try {
    const res = await requestApi<{ success: boolean; logs?: PackVerificationLog[]; error?: string }>('getPackVerificationLogs', {});
    if (res && res.success && Array.isArray(res.logs)) {
      if (res.logs.length > 0) {
        const local = getStoredVerificationLogs();
        const map = new Map<string, PackVerificationLog>();
        local.forEach((l) => map.set(`${l.orderId}_${l.timestamp}`, l));
        res.logs.forEach((l) => {
          if (l.orderId) {
            map.set(`${l.orderId}_${l.timestamp}`, l);
          }
        });
        const merged = Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        saveStoredVerificationLogs(merged);
        return { success: true, logs: merged };
      }
    }
    return { success: true, logs: getStoredVerificationLogs() };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Verification logs cloud sync error' };
  }
}

// --- Verification Station Settings ---

export function getVerificationSettings(): VerificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VERIFICATION_SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return DEFAULT_VERIFICATION_SETTINGS;
}

export function saveVerificationSettings(settings: VerificationSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_VERIFICATION_SETTINGS, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('vms_verification_settings_updated', { detail: settings }));
  } catch (e) {}
}
