import { OrderManifest, ManifestItem, GtinCatalogProduct, PackVerificationLog, VideoRecord } from '../types';
import { requestApi, normalizeOrderId, checkDuplicate } from './api';
import { dbGetAllQueue } from './storage';
import { getDirectImageUrl } from './branding';

const STORAGE_KEY_MANIFESTS = 'vms_order_manifests_v1';
const STORAGE_KEY_GTIN_CATALOG = 'vms_gtin_catalog_v1';
const STORAGE_KEY_GTIN_CONFIG = 'vms_gtin_sheet_config_v1';
const STORAGE_KEY_VERIFICATION_LOGS = 'vms_pack_verification_logs_v1';
const STORAGE_KEY_VERIFICATION_SETTINGS = 'vms_pack_verification_settings_v1';
const STORAGE_KEY_DELETED_MANIFESTS = 'vms_deleted_manifest_ids_v1';
const STORAGE_KEY_DELETED_GTINS = 'vms_deleted_gtin_codes_v1';

export interface GtinSheetConfig {
  sheetIdOrUrl: string;
  tabName: string;
  autoSync: boolean;
  tagsFilter?: string; // Comma-separated list of tags e.g. "Active-online, retail"
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

// Legacy sample GTIN set to automatically purge
const SAMPLE_GTIN_SET = new Set([
  '8901030865412',
  '8901234567890',
  '8901234567891',
  '8909876543210',
  '8909876543211',
  '8904567890123',
  '0123456789012',
  '0890123456789',
  '8901122334455',
]);

// --- Deletion Tombstones Tracking (Prevents resurrecting deleted entries on background cloud polling) ---

export function getDeletedManifestIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DELETED_MANIFESTS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map((x: string) => String(x).toLowerCase().trim()) : []);
  } catch {
    return new Set();
  }
}

export function recordDeletedManifestId(orderId: string): void {
  const clean = String(orderId || '').toLowerCase().trim();
  if (!clean) return;
  const set = getDeletedManifestIds();
  set.add(clean);
  try {
    localStorage.setItem(STORAGE_KEY_DELETED_MANIFESTS, JSON.stringify(Array.from(set)));
  } catch {}
}

export function getDeletedGtinCodes(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DELETED_GTINS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map((x: string) => normalizeBarcode(x).toLowerCase()) : []);
  } catch {
    return new Set();
  }
}

export function recordDeletedGtinCode(gtin: string): void {
  const clean = normalizeBarcode(gtin).toLowerCase();
  if (!clean) return;
  const set = getDeletedGtinCodes();
  set.add(clean);
  try {
    localStorage.setItem(STORAGE_KEY_DELETED_GTINS, JSON.stringify(Array.from(set)));
  } catch {}
}

// --- Order Manifest Store ---

export function enrichManifestItems(items: ManifestItem[]): ManifestItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const found = findProductInCatalog(it.sku || it.productName || it.gtin);
    if (found) {
      return {
        ...it,
        gtin: it.gtin || found.gtin || '',
        sku: it.sku || found.sku || '',
        productName: it.productName || found.productName || '',
        shortName: it.shortName || found.shortName || found.productName || '',
        imageUrl: it.imageUrl || found.imageUrl || ''
      };
    }
    return it;
  });
}

export function getStoredManifests(): OrderManifest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MANIFESTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const deletedSet = getDeletedManifestIds();
    return parsed
      .filter((m) => {
        const id = String(m.orderId || '').toLowerCase().trim();
        return id && !deletedSet.has(id);
      })
      .map((m) => ({
        ...m,
        items: enrichManifestItems(m.items || [])
      }));
  } catch (e) {
    return [];
  }
}

export function saveStoredManifests(manifests: OrderManifest[]): void {
  try {
    const deletedSet = getDeletedManifestIds();
    const cleaned = manifests.filter((m) => {
      const id = String(m.orderId || '').toLowerCase().trim();
      return id && !deletedSet.has(id);
    });
    localStorage.setItem(STORAGE_KEY_MANIFESTS, JSON.stringify(cleaned));
    window.dispatchEvent(new CustomEvent('vms_manifests_updated', { detail: { count: cleaned.length } }));
  } catch (e) {
    console.warn('Could not save manifests to localStorage:', e);
  }
}

export function getManifestByOrderId(orderId: string): OrderManifest | null {
  if (!orderId) return null;
  const clean = orderId.trim().toLowerCase();
  const deletedSet = getDeletedManifestIds();
  if (deletedSet.has(clean)) return null;

  const list = getStoredManifests();
  return list.find((m) => m.orderId.trim().toLowerCase() === clean) || null;
}

export async function saveOrderManifest(manifest: OrderManifest): Promise<void> {
  const list = getStoredManifests();
  const cleanId = manifest.orderId.trim();

  // Clear any past deletion tombstone for this orderId so new entry saves clean
  const deletedSet = getDeletedManifestIds();
  if (deletedSet.has(cleanId.toLowerCase())) {
    deletedSet.delete(cleanId.toLowerCase());
    try {
      localStorage.setItem(STORAGE_KEY_DELETED_MANIFESTS, JSON.stringify(Array.from(deletedSet)));
    } catch {}
  }

  const index = list.findIndex((m) => m.orderId.trim().toLowerCase() === cleanId.toLowerCase());

  if (index >= 0) {
    list[index] = { ...manifest, orderId: cleanId };
  } else {
    list.unshift({ ...manifest, orderId: cleanId });
  }

  saveStoredManifests(list);

  // Sync to remote Apps Script backend if available
  try {
    requestApi('saveOrderManifest', { manifest: { ...manifest, orderId: cleanId } }).catch((err) => {
      console.warn('Remote manifest sync warning:', err);
    });
  } catch (_) {}
}

export async function saveMultipleManifests(manifests: OrderManifest[]): Promise<number> {
  const list = getStoredManifests();
  const map = new Map<string, OrderManifest>();
  list.forEach((m) => map.set(m.orderId.trim().toLowerCase(), m));

  const deletedSet = getDeletedManifestIds();
  let addedCount = 0;

  for (const item of manifests) {
    const cleanId = item.orderId.trim();
    if (!cleanId) continue;
    const lower = cleanId.toLowerCase();
    deletedSet.delete(lower);
    map.set(lower, { ...item, orderId: cleanId });
    addedCount++;
  }

  try {
    localStorage.setItem(STORAGE_KEY_DELETED_MANIFESTS, JSON.stringify(Array.from(deletedSet)));
  } catch {}

  const updated = Array.from(map.values());
  saveStoredManifests(updated);

  // Sync batch
  try {
    requestApi('saveOrderManifestsBatch', { manifests }).catch(() => {});
  } catch (_) {}

  return addedCount;
}

export interface ReconciledVideoMatch {
  orderId: string;
  source: 'local_queue' | 'remote_logs' | 'verification_log' | 'manual';
  fileName?: string;
  videoDriveUrl?: string;
  timestamp?: string;
  packerEmail?: string;
  packerName?: string;
  fileId?: string;
}

export async function updateManifestStatus(
  orderId: string,
  status: OrderManifest['status'],
  items?: ManifestItem[],
  packerDetails?: { name?: string; email?: string; videoDriveUrl?: string; packedAt?: string }
): Promise<void> {
  const list = getStoredManifests();
  const cleanId = orderId.trim();
  const target = list.find((m) => m.orderId.trim().toLowerCase() === cleanId.toLowerCase());

  if (target) {
    target.status = status;
    if (items) target.items = items;
    if (packerDetails) {
      if (packerDetails.name) target.packedByName = packerDetails.name;
      if (packerDetails.email) target.packedByEmail = packerDetails.email;
      if (packerDetails.videoDriveUrl) {
        target.videoDriveUrl = packerDetails.videoDriveUrl;
      }
      if (status === 'Packed') {
        target.packedAt = packerDetails.packedAt || target.packedAt || new Date().toISOString();
      }
    } else if (status === 'Packed' && !target.packedAt) {
      target.packedAt = new Date().toISOString();
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

/**
 * Searches local indexed upload queue, remote video logs, and verification logs
 * to find if a packing video was already recorded & uploaded for the given order ID.
 */
export async function findMatchingVideoForOrderId(orderId: string): Promise<ReconciledVideoMatch | null> {
  if (!orderId || !orderId.trim()) return null;
  const normTarget = normalizeOrderId(orderId);
  if (!normTarget) return null;

  // 1. Search local completed queue
  try {
    const queue = await dbGetAllQueue();
    const localMatch = queue.find(
      (item) =>
        normalizeOrderId(item.orderId) === normTarget &&
        (item.status === 'completed' || Boolean(item.fileId || item.webViewLink))
    );
    if (localMatch) {
      const url =
        localMatch.webViewLink ||
        (localMatch.fileId ? `https://drive.google.com/file/d/${localMatch.fileId}/preview` : '');
      return {
        orderId: localMatch.orderId,
        source: 'local_queue',
        fileName: localMatch.fileName,
        videoDriveUrl: url,
        timestamp: localMatch.createdAt ? new Date(localMatch.createdAt).toISOString() : new Date().toISOString(),
        packerEmail: localMatch.source || '',
        fileId: localMatch.fileId,
      };
    }
  } catch (e) {
    console.warn('Queue search check note:', e);
  }

  // 2. Search remote Google Sheet / Drive records via checkDuplicate
  try {
    const dup = await checkDuplicate({
      orderId: orderId,
      platform: '',
      recordingType: 'Forward',
    });
    if (dup && (dup.driveLink || dup.webViewLink || dup.playbackUrl || dup.fileId)) {
      const url =
        dup.webViewLink ||
        dup.driveLink ||
        dup.playbackUrl ||
        (dup.fileId ? `https://drive.google.com/file/d/${dup.fileId}/preview` : '');
      return {
        orderId: dup.orderId,
        source: 'remote_logs',
        fileName: dup.fileName,
        videoDriveUrl: url,
        timestamp: dup.timestamp,
        packerEmail: dup.packerEmail,
        fileId: dup.fileId,
      };
    }
  } catch (e) {}

  // 3. Fallback to advancedSearch query
  try {
    const res = await requestApi<{ results?: VideoRecord[] }>('advancedSearch', {
      orderId: orderId,
      limit: 5,
    });
    if (res && Array.isArray(res.results) && res.results.length > 0) {
      const match = res.results.find((r) => normalizeOrderId(r.orderId) === normTarget);
      if (match && (match.driveLink || match.webViewLink || match.playbackUrl || match.fileId)) {
        const url =
          match.webViewLink ||
          match.driveLink ||
          match.playbackUrl ||
          (match.fileId ? `https://drive.google.com/file/d/${match.fileId}/preview` : '');
        return {
          orderId: match.orderId,
          source: 'remote_logs',
          fileName: match.fileName,
          videoDriveUrl: url,
          timestamp: match.timestamp,
          packerEmail: match.packerEmail,
          fileId: match.fileId,
        };
      }
    }
  } catch (e) {}

  // 4. Check Pack Verification Logs
  try {
    const vLogs = getStoredVerificationLogs();
    const vMatch = vLogs.find((l) => normalizeOrderId(l.orderId) === normTarget && Boolean(l.videoDriveUrl));
    if (vMatch && vMatch.videoDriveUrl) {
      return {
        orderId: vMatch.orderId,
        source: 'verification_log',
        videoDriveUrl: vMatch.videoDriveUrl,
        timestamp: vMatch.timestamp,
        packerEmail: vMatch.packerEmail,
        packerName: vMatch.verifiedByPacker || vMatch.assignedPacker,
      };
    }
  } catch (e) {}

  return null;
}

/**
 * Batch-reconciles all pending manifests against recorded and uploaded videos.
 * Automatically marks matching manifests as 'Packed' and links their Google Drive video URL!
 */
export async function reconcilePendingManifests(): Promise<{
  reconciledCount: number;
  checkedCount: number;
  reconciledOrders: Array<{ orderId: string; videoDriveUrl: string }>;
}> {
  const manifests = getStoredManifests();
  const pending = manifests.filter((m) => m.status !== 'Packed' && !m.packedAt);
  const reconciledOrders: Array<{ orderId: string; videoDriveUrl: string }> = [];

  for (const item of pending) {
    try {
      const match = await findMatchingVideoForOrderId(item.orderId);
      if (match && (match.videoDriveUrl || match.fileId)) {
        const videoUrl =
          match.videoDriveUrl ||
          (match.fileId ? `https://drive.google.com/file/d/${match.fileId}/preview` : '');
        await updateManifestStatus(item.orderId, 'Packed', undefined, {
          name: match.packerName || match.packerEmail || item.assignedPackerName || 'Packer',
          email: match.packerEmail || item.assignedPackerEmail || '',
          videoDriveUrl: videoUrl,
          packedAt: match.timestamp || new Date().toISOString(),
        });
        reconciledOrders.push({ orderId: item.orderId, videoDriveUrl: videoUrl });
      }
    } catch (e) {
      console.warn(`Error auto-reconciling manifest order ${item.orderId}:`, e);
    }
  }

  return {
    reconciledCount: reconciledOrders.length,
    checkedCount: pending.length,
    reconciledOrders,
  };
}

export function deleteManifest(orderId: string): void {
  const cleanId = orderId.trim();
  if (!cleanId) return;

  recordDeletedManifestId(cleanId);
  const list = getStoredManifests().filter((m) => m.orderId.trim().toLowerCase() !== cleanId.toLowerCase());
  saveStoredManifests(list);

  try {
    requestApi('deleteOrderManifest', { orderId: cleanId }).catch(() => {});
  } catch (_) {}
}

// --- GTIN Product Catalog Store ---

/**
 * Robust Barcode / GTIN / GSIN Normalizer:
 * - Strips AIM symbology identifiers (e.g. "]C1", "]e0", "]d2", "]Q3", "]E0", "]A0", "]I0", "]G1")
 * - Strips GS1 parenthesized / raw application identifiers (e.g. "(01)08901234567890" or "0108901234567890")
 * - Fixes Excel scientific notation (e.g. "8.901234567890E+12" -> "8901234567890")
 * - Preserves leading zeros (e.g. "0123456789012")
 * - Strips quotes, whitespace, control characters, trailing ".0"
 */
export function normalizeBarcode(input: any): string {
  if (input === null || input === undefined) return '';
  let str = String(input).trim().replace(/^["']|["']$/g, '');

  // Strip AIM symbology identifiers (e.g. "]C1", "]e0", "]d2", "]Q3", "]E0", "]A0", "]I0", "]G1")
  str = str.replace(/^\][A-Za-z0-9]{2}/, '');

  // Strip GS1 parenthesized application identifier e.g. "(01)08901234567890"
  const gs1ParenMatch = str.match(/^\(01\)(\d{12,14})/);
  if (gs1ParenMatch) {
    str = gs1ParenMatch[1];
  }

  // Strip GS1 raw "01" application identifier if 16 digits e.g. "0108901234567890" -> "08901234567890"
  if (/^01\d{14}$/.test(str)) {
    str = str.substring(2);
  }

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

  // Remove any spaces, carriage returns, tabs, or invisible characters
  return str.replace(/[\s\u200B-\u200D\uFEFF\r\n\t]/g, '').trim();
}

/**
 * Compare two barcodes or SKUs with ultra-high tolerance:
 * - Exact match (case-insensitive)
 * - Match without leading zeros (e.g. 08901234567890 vs 8901234567890)
 * - Match without punctuation / hyphens (e.g. SKU-123 vs SKU123)
 * - UPC-A to EAN-13 padding (12 digits vs 13 digits with leading zero)
 */
export function isBarcodeEqual(codeA: any, codeB: any): boolean {
  if (!codeA || !codeB) return false;
  const a = normalizeBarcode(codeA).toUpperCase();
  const b = normalizeBarcode(codeB).toUpperCase();
  if (!a || !b) return false;

  // 1. Direct match
  if (a === b) return true;

  // 2. Ignore leading zeros (e.g. 08901234567890 vs 8901234567890)
  const aNoZero = a.replace(/^0+/, '');
  const bNoZero = b.replace(/^0+/, '');
  if (aNoZero && bNoZero && aNoZero === bNoZero) return true;

  // 3. UPC-A (12 digits) padded to EAN-13 (13 digits)
  if (a.length === 12 && '0' + a === b) return true;
  if (b.length === 12 && '0' + b === a) return true;

  // 4. Strip hyphens, underscores, slashes, spaces
  const aCleanAlpha = a.replace(/[-_.\s/\\#]/g, '');
  const bCleanAlpha = b.replace(/[-_.\s/\\#]/g, '');
  if (aCleanAlpha && bCleanAlpha && aCleanAlpha === bCleanAlpha) return true;

  return false;
}

export function isOrderCatalogRecord(item: { gtin?: string; sku?: string; productName?: string }): boolean {
  if (!item) return false;
  const gtin = (item.gtin || '').trim();
  const sku = (item.sku || '').trim().toUpperCase();
  const name = (item.productName || '').trim().toUpperCase();
  if (gtin.startsWith('#OD-') || gtin.startsWith('#') || /^\d{3}-\d{7}-\d{7}$/.test(gtin)) return true;
  if (sku === 'AMAZON' || sku === 'D2C' || sku === 'JIOMART' || sku === 'CUSTOM') return true;
  if (name === 'AMAZON' || name === 'D2C' || name === 'JIOMART' || name === 'CUSTOM') return true;
  return false;
}

export function getStoredGtinCatalog(): GtinCatalogProduct[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GTIN_CATALOG);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const deletedSet = getDeletedGtinCodes();
      // Filter out any deleted items, legacy dummy sample data, and accidental order log entries
      const cleaned = parsed.filter((p) => {
        const gtin = normalizeBarcode(p.gtin || p.sku);
        return gtin && !SAMPLE_GTIN_SET.has(gtin) && !deletedSet.has(gtin.toLowerCase()) && !isOrderCatalogRecord(p);
      });
      return cleaned;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function saveStoredGtinCatalog(catalog: GtinCatalogProduct[]): void {
  try {
    const deletedSet = getDeletedGtinCodes();
    const cleaned = catalog.filter((p) => {
      const gtin = normalizeBarcode(p.gtin || p.sku);
      return gtin && !SAMPLE_GTIN_SET.has(gtin) && !deletedSet.has(gtin.toLowerCase()) && !isOrderCatalogRecord(p);
    });
    localStorage.setItem(STORAGE_KEY_GTIN_CATALOG, JSON.stringify(cleaned));
    window.dispatchEvent(new CustomEvent('vms_gtin_catalog_updated', { detail: { count: cleaned.length } }));
  } catch (e) {
    console.warn('Could not save GTIN catalog:', e);
  }
}

export async function purgeOrderPollutionFromCatalog(): Promise<number> {
  let catalog: GtinCatalogProduct[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GTIN_CATALOG);
    if (raw) catalog = JSON.parse(raw) || [];
  } catch (e) {}

  const validProducts = catalog.filter((p) => !isOrderCatalogRecord(p));
  const pollutedGtins = catalog.filter((p) => isOrderCatalogRecord(p)).map((p) => p.gtin).filter(Boolean);
  const removedCount = catalog.length - validProducts.length;

  saveStoredGtinCatalog(validProducts);

  if (pollutedGtins.length > 0) {
    try {
      await requestApi('deleteGtinProductsBatch', { gtins: pollutedGtins });
    } catch (_) {}
  }

  return removedCount;
}

export function findProductInCatalog(query: string): GtinCatalogProduct | null {
  if (!query || !query.trim()) return null;
  const clean = query.trim().toUpperCase();
  const catalog = getStoredGtinCatalog();

  // 1. Exact or tolerant GTIN match
  const byGtin = catalog.find((p) => isBarcodeEqual(p.gtin, clean));
  if (byGtin) return byGtin;

  // 2. Exact or tolerant SKU match
  const bySku = catalog.find((p) => isBarcodeEqual(p.sku, clean) || p.sku.trim().toUpperCase() === clean);
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

export function searchCatalog(query: string, maxResults = 500, tagFilter?: string): GtinCatalogProduct[] {
  const catalog = getStoredGtinCatalog();
  const cleanTag = tagFilter ? tagFilter.trim().toLowerCase() : '';
  const clean = query ? query.trim().toUpperCase() : '';

  return catalog
    .filter((p) => {
      // If tagFilter is provided (and not 'ALL'), check if product matches the tag
      if (cleanTag && cleanTag !== 'all') {
        const prodTag = (p.tag || '').toLowerCase();
        const prodCat = (p.category || '').toLowerCase();
        if (!prodTag.includes(cleanTag) && !prodCat.includes(cleanTag)) {
          return false;
        }
      }

      if (!clean) return true;

      const gtin = (p.gtin || '').toUpperCase();
      const sku = (p.sku || '').toUpperCase();
      const name = (p.productName || '').toUpperCase();
      const short = (p.shortName || '').toUpperCase();
      const tag = (p.tag || '').toUpperCase();
      const cat = (p.category || '').toUpperCase();

      return (
        isBarcodeEqual(gtin, clean) ||
        isBarcodeEqual(sku, clean) ||
        gtin.includes(clean) ||
        sku.includes(clean) ||
        name.includes(clean) ||
        short.includes(clean) ||
        tag.includes(clean) ||
        cat.includes(clean)
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

  // Clear any past deletion tombstone for this GTIN
  const deletedSet = getDeletedGtinCodes();
  if (deletedSet.has(cleanGtin.toLowerCase())) {
    deletedSet.delete(cleanGtin.toLowerCase());
    try {
      localStorage.setItem(STORAGE_KEY_DELETED_GTINS, JSON.stringify(Array.from(deletedSet)));
    } catch {}
  }

  const normalizedProd: GtinCatalogProduct = {
    ...product,
    gtin: cleanGtin,
    sku: product.sku ? product.sku.trim() : cleanGtin,
    productName: product.productName ? product.productName.trim() : `Product ${cleanGtin}`,
    shortName: product.shortName ? product.shortName.trim() : product.productName || cleanGtin,
    category: product.category ? product.category.trim() : 'General',
    tag: product.tag ? product.tag.trim() : '',
    cogs: product.cogs,
    defaultQuantity: product.defaultQuantity || 1,
  };

  const index = catalog.findIndex((p) => isBarcodeEqual(p.gtin, cleanGtin));

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

  recordDeletedGtinCode(clean);
  const catalog = getStoredGtinCatalog();
  const filtered = catalog.filter((p) => !isBarcodeEqual(p.gtin, clean));
  saveStoredGtinCatalog(filtered);

  try {
    requestApi('deleteGtinProduct', { gtin: clean }).catch(() => {});
  } catch (_) {}

  return true;
}

export async function deleteMultipleGtinProducts(gtins: string[]): Promise<number> {
  if (!Array.isArray(gtins) || gtins.length === 0) return 0;
  const cleanList = gtins.map((g) => normalizeBarcode(g)).filter(Boolean);
  if (cleanList.length === 0) return 0;

  cleanList.forEach((g) => recordDeletedGtinCode(g));
  const cleanSet = new Set(cleanList);

  const catalog = getStoredGtinCatalog();
  const filtered = catalog.filter((p) => {
    const normalized = normalizeBarcode(p.gtin);
    return !cleanSet.has(normalized);
  });
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
  const deletedSet = getDeletedGtinCodes();

  for (const item of products) {
    const rawCode = item.gtin || item.sku || '';
    const cleanGtin = normalizeBarcode(rawCode);
    if (!cleanGtin) continue;

    // If item was previously deleted, un-tombstone it on explicit import/sync
    deletedSet.delete(cleanGtin.toLowerCase());

    const cleanImg = item.imageUrl ? getDirectImageUrl(item.imageUrl) : '';

    const normalizedItem: GtinCatalogProduct = {
      ...item,
      gtin: cleanGtin,
      sku: item.sku ? item.sku.trim() : cleanGtin,
      productName: item.productName ? item.productName.trim() : `Product ${cleanGtin}`,
      shortName: item.shortName ? item.shortName.trim() : item.productName || cleanGtin,
      category: item.category ? item.category.trim() : (item.tag || 'General'),
      tag: item.tag ? item.tag.trim() : '',
      imageUrl: cleanImg,
      cogs: item.cogs,
      defaultQuantity: Number(item.defaultQuantity) || 1,
    };

    cleanedProducts.push(normalizedItem);

    const index = catalog.findIndex((p) => isBarcodeEqual(p.gtin, cleanGtin) || (p.sku && p.sku.toLowerCase() === (normalizedItem.sku || '').toLowerCase()));
    if (index >= 0) {
      catalog[index] = { ...catalog[index], ...normalizedItem };
    } else {
      catalog.push(normalizedItem);
      newCount++;
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY_DELETED_GTINS, JSON.stringify(Array.from(deletedSet)));
  } catch {}

  saveStoredGtinCatalog(catalog);

  try {
    if (cleanedProducts.length > 0) {
      requestApi('saveGtinCatalogBatch', { products: cleanedProducts }).catch(() => {});
    }
  } catch (_) {}

  return newCount;
}

/**
 * Fetch and synchronize GTIN catalog from the master connected Google Sheet
 * Uses the Branding / master Google Sheet reference as the single source of truth.
 * Supports custom tab name (e.g. "UE", "Master UE", "GTINCatalog") and multi-tag filters.
 */
export async function syncGtinWithMasterSheet(
  tagsFilter?: string | string[],
  tabName?: string
): Promise<{
  success: boolean;
  count: number;
  message: string;
  items?: GtinCatalogProduct[];
}> {
  try {
    const config = getGtinSheetConfig();
    const effectiveTab = tabName || config.tabName || 'GTINCatalog';

    let appliedTags: string[] = [];
    if (tagsFilter) {
      if (Array.isArray(tagsFilter)) {
        appliedTags = tagsFilter.map((t) => t.trim().toLowerCase()).filter(Boolean);
      } else if (typeof tagsFilter === 'string' && tagsFilter.trim()) {
        appliedTags = tagsFilter.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      }
    } else if (config.tagsFilter) {
      appliedTags = config.tagsFilter.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    }

    const res = await requestApi<{ success: boolean; catalog?: GtinCatalogProduct[]; count?: number; tabName?: string; error?: string }>(
      'getGtinCatalog',
      {
        tabName: effectiveTab,
        tags: appliedTags,
        allowUntagged: true,
      }
    );

    if (res && res.success && Array.isArray(res.catalog)) {
      if (res.catalog.length > 0) {
        const deletedSet = getDeletedGtinCodes();

        // Process tag filters if provided
        let targetList = res.catalog;
        if (appliedTags.length > 0) {
          targetList = targetList.filter((item) => {
            const itemTag = (item.tag || '').toLowerCase();
            const itemCat = (item.category || '').toLowerCase();
            const hasMatchedTag = appliedTags.some((at) => itemTag.includes(at) || itemCat.includes(at));
            // Include newly added items with SKU or Image even if tag is not yet filled
            const isUntaggedNew = !itemTag && Boolean(item.sku || item.imageUrl);
            return hasMatchedTag || isUntaggedNew;
          });
        }

        // Merge with cloud catalog, un-tombstoning items freshly fetched from master sheet
        const catalog = getStoredGtinCatalog();
        const map = new Map<string, GtinCatalogProduct>();
        // Add existing local
        catalog.forEach((p) => {
          const code = normalizeBarcode(p.gtin || p.sku);
          if (code) map.set(code, p);
        });
        // Overwrite with master cloud sheet items
        targetList.forEach((p) => {
          const rawCode = p.gtin || p.sku || '';
          const g = normalizeBarcode(rawCode);
          if (g) {
            deletedSet.delete(g.toLowerCase());
            const cleanImg = p.imageUrl ? getDirectImageUrl(p.imageUrl) : '';
            map.set(g, {
              ...p,
              gtin: g,
              sku: p.sku ? p.sku.trim() : g,
              imageUrl: cleanImg || p.imageUrl,
            });
          }
        });

        try {
          localStorage.setItem(STORAGE_KEY_DELETED_GTINS, JSON.stringify(Array.from(deletedSet)));
        } catch {}

        const merged = Array.from(map.values());
        saveStoredGtinCatalog(merged);

        const activeTabDisplay = res.tabName || effectiveTab;
        const tagNotice = appliedTags.length > 0 ? ` (filtered by tags: ${appliedTags.join(', ')})` : ' (Full Data)';

        return {
          success: true,
          count: targetList.length,
          message: `Successfully synchronized ${targetList.length} products from Master tab "${activeTabDisplay}"${tagNotice}!`,
          items: merged,
        };
      } else {
        // Master tab is currently empty, push our local catalog to seed it!
        const local = getStoredGtinCatalog();
        if (local.length > 0) {
          await requestApi('saveGtinCatalogBatch', { products: local }).catch(() => {});
        }
        return {
          success: true,
          count: local.length,
          message: `Connected to Master Google Sheet tab "${effectiveTab}". Total: ${local.length} products.`,
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
    tabName: 'GTINCatalog',
    autoSync: true,
    tagsFilter: '',
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
 * Direct Google Sheet CSV parser fallback if Apps Script backend endpoint is unreachable or permissions restricted.
 */
async function fetchAndParseDirectGoogleSheetCsv(sheetId: string, tabName: string): Promise<GtinCatalogProduct[]> {
  const encTab = encodeURIComponent(tabName || 'GTINCatalog');
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encTab}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Direct CSV request returned HTTP ${resp.status}`);
  }
  const text = await resp.text();
  if (!text || text.trim().length === 0) return [];

  // Parse CSV rows handling quoted values
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      if (currentRow.some((f) => f.trim().length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.trim().length > 0)) {
      lines.push(currentRow);
    }
  }

  if (lines.length <= 1) return [];

  const headers = lines[0].map((h) => (h || '').trim().toLowerCase());
  let gtinIdx = -1, skuIdx = -1, nameIdx = -1, shortNameIdx = -1, imgIdx = -1, catIdx = -1, tagIdx = -1;

  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    if (gtinIdx === -1 && (h.includes('gtin') || h.includes('barcode') || h.includes('ean') || h.includes('upc') || h === 'code')) {
      gtinIdx = c;
    } else if (skuIdx === -1 && (h.includes('sku') || h.includes('item code') || h.includes('product code') || h.includes('style') || h.includes('model') || h === 'item')) {
      skuIdx = c;
    } else if (nameIdx === -1 && (h.includes('product name') || h.includes('product') || h.includes('title') || h.includes('item name') || h.includes('description'))) {
      nameIdx = c;
    } else if (shortNameIdx === -1 && (h.includes('short') || h.includes('display name') || h.includes('nickname'))) {
      shortNameIdx = c;
    } else if (imgIdx === -1 && (h.includes('image') || h.includes('photo') || h.includes('picture') || h.includes('img') || h.includes('drive') || h.includes('link') || h.includes('src') || h.includes('thumbnail'))) {
      imgIdx = c;
    } else if (tagIdx === -1 && (h.includes('tag') || h.includes('label') || h.includes('status'))) {
      tagIdx = c;
    } else if (catIdx === -1 && (h.includes('category') || h.includes('department') || h.includes('type'))) {
      catIdx = c;
    }
  }

  if (gtinIdx === -1 && skuIdx === -1) {
    gtinIdx = headers.length > 1 ? 1 : 0;
    skuIdx = headers.length > 2 ? 2 : gtinIdx;
  } else if (gtinIdx === -1) {
    gtinIdx = skuIdx;
  } else if (skuIdx === -1) {
    skuIdx = gtinIdx;
  }
  if (nameIdx === -1) nameIdx = headers.length > 2 ? 2 : skuIdx;
  if (imgIdx === -1 && headers.length > 6) imgIdx = 6;

  const items: GtinCatalogProduct[] = [];
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r];
    const rawGtin = gtinIdx >= 0 ? (row[gtinIdx] || '').trim() : '';
    const rawSku = skuIdx >= 0 ? (row[skuIdx] || '').trim() : '';

    if (!rawGtin && !rawSku) continue;
    const finalGtin = rawGtin || rawSku;
    const finalSku = rawSku || rawGtin;

    const rawName = nameIdx >= 0 && row[nameIdx] ? row[nameIdx].trim() : finalSku;
    const rawShort = shortNameIdx >= 0 && row[shortNameIdx] ? row[shortNameIdx].trim() : rawName;
    const rawImg = imgIdx >= 0 && row[imgIdx] ? getDirectImageUrl(row[imgIdx].trim()) : '';
    const rawTag = tagIdx >= 0 && row[tagIdx] ? row[tagIdx].trim() : '';
    const rawCat = catIdx >= 0 && row[catIdx] ? row[catIdx].trim() : (rawTag || 'General');

    items.push({
      gtin: finalGtin,
      sku: finalSku,
      productName: rawName,
      shortName: rawShort,
      category: rawCat,
      tag: rawTag,
      imageUrl: rawImg,
      defaultQuantity: 1,
    });
  }

  return items;
}

/**
 * Fetch and synchronize GTIN catalog from the user's separate or master Google Sheet
 * Supports multiple tags condition e.g. "Active-online, summer"
 */
export async function syncGtinFromGoogleSheet(
  sheetIdOrUrl?: string,
  tabName?: string,
  tagsFilter?: string | string[]
): Promise<{ success: boolean; count: number; message: string; items?: GtinCatalogProduct[] }> {
  const config = getGtinSheetConfig();
  const rawTarget = sheetIdOrUrl || config.sheetIdOrUrl;
  const targetId = extractSpreadsheetId(rawTarget);
  const targetTab = tabName || config.tabName || 'GTINCatalog';

  if (!targetId) {
    return {
      success: false,
      count: 0,
      message: 'Please provide a valid Google Sheet ID or URL.',
    };
  }

  // Parse tags
  let tagString = '';
  let tagList: string[] = [];
  if (tagsFilter) {
    if (Array.isArray(tagsFilter)) {
      tagList = tagsFilter.map((t) => t.trim()).filter(Boolean);
      tagString = tagList.join(', ');
    } else if (typeof tagsFilter === 'string') {
      tagString = tagsFilter.trim();
      tagList = tagString.split(',').map((t) => t.trim()).filter(Boolean);
    }
  } else if (config.tagsFilter) {
    tagString = config.tagsFilter.trim();
    tagList = tagString.split(',').map((t) => t.trim()).filter(Boolean);
  }

  let items: GtinCatalogProduct[] = [];

  try {
    // 1. First attempt: Request Apps Script backend to read the user's Google Sheet
    const res = await requestApi<{
      success: boolean;
      items: GtinCatalogProduct[];
      count: number;
      error?: string;
    }>('syncExternalGtinSheet', {
      gtinSheetId: targetId,
      tabName: targetTab,
      tags: tagList,
      tag: tagString,
    });

    if (res && res.success && Array.isArray(res.items)) {
      items = res.items;
    }
  } catch (err: any) {
    console.warn('Apps Script syncExternalGtinSheet notice, attempting direct CSV fallback:', err);
  }

  // 2. Fallback: If Apps Script returned empty or failed, fetch Google Sheet CSV directly
  if (!items || items.length === 0) {
    try {
      const csvItems = await fetchAndParseDirectGoogleSheetCsv(targetId, targetTab);
      if (csvItems.length > 0) {
        items = csvItems;
      }
    } catch (csvErr: any) {
      console.warn('Direct Google Sheet CSV fetch fallback error:', csvErr);
    }
  }

  if (items && items.length > 0) {
    // Apply tag condition if user configured tags
    if (tagList.length > 0) {
      const tagLower = tagList.map((t) => t.toLowerCase());
      items = items.filter((it) => {
        const itemTag = (it.tag || '').toLowerCase();
        const itemCat = (it.category || '').toLowerCase();
        const matched = tagLower.some((t) => itemTag.includes(t) || itemCat.includes(t));
        // Allow newly added items that have a SKU or image even if tag is empty
        const isUntaggedNew = !itemTag && Boolean(it.sku || it.imageUrl);
        return matched || isUntaggedNew;
      });
    }

    // Import items into local storage and mirror to Master GTIN catalog
    await importGtinCatalog(items);
    const updatedConfig: GtinSheetConfig = {
      sheetIdOrUrl: targetId,
      tabName: targetTab,
      autoSync: config.autoSync,
      tagsFilter: tagString,
      lastSyncTime: new Date().toISOString(),
      totalSyncedItems: items.length,
    };
    saveGtinSheetConfig(updatedConfig);

    const tagNotice = tagList.length > 0 ? ` with tag filter [${tagList.join(', ')}]` : ' (Full catalog)';

    return {
      success: true,
      count: items.length,
      message: `Successfully synchronized ${items.length} products from tab "${targetTab}"${tagNotice}!`,
      items,
    };
  }

  return {
    success: false,
    count: 0,
    message: `No products found in tab "${targetTab}". Ensure the tab contains columns for SKU, Product Name, and Image, and that Google Sheet sharing allows view access.`,
  };
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
      const deletedSet = getDeletedManifestIds();
      
      // The Google Sheet "Manifest_Orders" tab is the single source of truth for active orders
      const cloudManifests = res.manifests.filter((m) => m.orderId && !deletedSet.has(m.orderId.toLowerCase().trim()));
      
      const map = new Map<string, OrderManifest>();
      // Add all active cloud manifests from Google Sheet
      cloudManifests.forEach((m) => {
        map.set(m.orderId.toLowerCase().trim(), m);
      });

      // Keep only brand-new local entries added in the last 2 minutes that haven't landed in cloud yet
      const local = getStoredManifests();
      const twoMinsAgo = Date.now() - 2 * 60 * 1000;
      local.forEach((m) => {
        const id = m.orderId.toLowerCase().trim();
        if (!map.has(id) && !deletedSet.has(id)) {
          const createdAt = m.processedAt ? new Date(m.processedAt).getTime() : 0;
          if (createdAt > twoMinsAgo) {
            map.set(id, m);
          }
        }
      });

      const merged = Array.from(map.values());
      saveStoredManifests(merged);
      return { success: true, manifests: merged };
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
