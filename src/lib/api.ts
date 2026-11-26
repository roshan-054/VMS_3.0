import { getStoredApiUrl, getStoredToken, setStoredToken, getStoredDriveFolderId, dbGetAllQueue } from './storage';
import { User, VideoRecord, AnalyticsData } from '../types';
import { computeLocalAnalyticsData, getLocalWorkstationLogs } from './localAnalytics';
import { trySupabase, isSupabaseAction } from './supabase/router';
import { applySupabaseConfigFromBranding } from './supabase/client';
import {
  localLogin,
  getLocalUsers,
  syncLocalUserWithRemote,
  syncAllLocalUsers,
  deleteLocalUserByEmail,
  rememberOfflineCredential,
} from './localAuth';

export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
}

export const SESSION_EXPIRED_EVENT = 'ops_session_expired';

let lastSessionExpiredNotice = 0;
function notifySessionExpired(message: string) {
  setStoredToken('');
  const now = Date.now();
  // Many background loops may hit the same expired token at once; notify only once.
  if (now - lastSessionExpiredNotice < 5000) return;
  lastSessionExpiredNotice = now;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
  } catch (_) {}
}

/**
 * How long to wait for Apps Script before giving up. Quick lookups keep a short limit so the UI
 * stays responsive, but calls that carry or produce megabytes of video (an upload chunk is 4–16 MB
 * of base64 that must first travel up the warehouse internet line, then on to Drive) get minutes.
 * A 12 s limit on uploadChunk cut off every attempt on slower lines, which left uploads at
 * "Session Created 0%" and later "Interrupted / Stale".
 */
const ACTION_TIMEOUT_MS: Record<string, number> = {
  uploadChunk: 300000,
  finishUpload: 120000,
  startUpload: 60000,
  getVideoChunk: 120000,
  getAnalyticsData: 90000,
  getReportData: 90000,
  getOrderRecordingReport: 90000,
  uploadLogs: 60000,
  getUploadLogs: 60000,
  advancedSearch: 60000,
  searchOrders: 60000,
  syncExternalGtinSheet: 120000,
  getGtinCatalog: 60000,
  saveGtinCatalogBatch: 120000,
  getOrderManifests: 60000,
  saveOrderManifestsBatch: 60000,
  uploadBrandingImage: 120000,
  cleanupStuckUploads: 90000,
  scanDuplicateRecords: 120000,
  removeDuplicateRecords: 120000,
  scanOlderVideos: 120000,
  deleteOlderVideos: 300000,
  getBackendUpdateStatus: 60000,
  updateBackend: 300000,
  rollbackBackend: 120000,
  scanSheetCleanup: 120000,
  runSheetCleanup: 300000,
  scanOrderIdFormat: 120000,
  fixOrderIdFormat: 300000,
  listCleanupArchive: 120000,
  restoreCleanupArchive: 120000,
  setup: 120000,
  applyDateFormats: 120000,
  repairPlaybackUrls: 120000,
  applyConditionalFormatting: 120000,
  supabaseImport: 300000,
  saveSupabaseConfig: 60000,
  getSupabaseConfig: 60000,
  supabaseSweep: 300000,
  syncSheetNow: 60000,
};
export const DEFAULT_API_TIMEOUT_MS = 20000;
export function apiTimeoutFor(action: string): number {
  return ACTION_TIMEOUT_MS[action] || DEFAULT_API_TIMEOUT_MS;
}

export async function requestApi<T = any>(
  action: string,
  payload: Record<string, any> = {},
  customUrl?: string
): Promise<ApiResponse<T>> {
  // Everyday data requests are answered from Supabase when it is set up (much faster). Anything
  // else, or any problem with Supabase, goes to Apps Script exactly as before.
  if (!customUrl && isSupabaseAction(action)) {
    const token = payload.token !== undefined ? payload.token : getStoredToken();
    const fast = await trySupabase(action, payload, token, (a, p, t) => requestAppsScript(a, p, undefined, t));
    if (fast) {
      if (!fast.success) {
        const serverErr: any = new Error(fast.error || 'Request failed.');
        serverErr.serverError = true;
        if (fast.code) serverErr.code = fast.code;
        throw serverErr;
      }
      return fast as ApiResponse<T>;
    }
  }
  return requestAppsScript<T>(action, payload, customUrl);
}

/** The original path: one request to the Apps Script web app. */
export async function requestAppsScript<T = any>(
  action: string,
  payload: Record<string, any> = {},
  customUrl?: string,
  timeoutOverrideMs?: number
): Promise<ApiResponse<T>> {
  const url = customUrl || getStoredApiUrl();
  const token = payload.token !== undefined ? payload.token : getStoredToken();

  const body = JSON.stringify({
    action,
    token,
    ...payload,
  });

  // Handle local fallback for authentication and user management when remote is offline
  const isAuthAction = action === 'login' || action === 'signup';

  try {
    let response: Response | null = null;
    let lastFetchErr: any = null;

    // Single attempt; the time limit depends on the action (see ACTION_TIMEOUT_MS) and covers the
    // whole exchange, including reading the reply.
    const timeoutMs = timeoutOverrideMs || apiTimeoutFor(action);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body,
      });
    } catch (fetchErr: any) {
      lastFetchErr = fetchErr;
    }

    if (!response) {
      clearTimeout(timeoutId);
      if (lastFetchErr && lastFetchErr.name === 'AbortError') {
        throw new Error(`Request timed out (${Math.round(timeoutMs / 1000)}s limit). Google Apps Script may be waking up or slow.`);
      }
      throw lastFetchErr || new Error('Network request failed. Please check your connection.');
    }

    let text: string;
    try {
      text = await response.text();
    } catch (readErr: any) {
      if (readErr?.name === 'AbortError') {
        throw new Error(`Request timed out (${Math.round(timeoutMs / 1000)}s limit) while reading the reply.`);
      }
      throw readErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404 || text.includes('找不到網頁') || text.includes('無法開啟這個檔案')) {
      throw new Error(
        'Apps Script deployment not found (HTTP 404). Please ensure the Web App URL in Settings is active and deployed with "Anyone" access.'
      );
    }

    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text);
    } catch (err) {
      if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
        throw new Error(
          'Google Apps Script returned an HTML page instead of JSON. Ensure the Web App is deployed as "Execute as: Me" and "Who has access: Anyone".'
        );
      }
      if (
        text.toLowerCase().includes('version') ||
        text.toLowerCase().includes('less than the existing version')
      ) {
        throw new Error(
          'Google Apps Script Version Mismatch: Please update your Apps Script Web App URL in "Drive & Script Config" to use the latest deployment endpoint ("/exec" without version numbers).'
        );
      }
      throw new Error(
        'Invalid Apps Script response. Please check that the Web App is deployed with "Anyone" access.'
      );
    }

    if (!data.success) {
      const errMsg = data.error || 'Request failed.';
      if ((data as any).code === 'AUTH_REQUIRED') {
        // Backend rejected the session token: sign the workstation out so the user logs in again.
        // Only sign out if we actually sent a session (background loops can run before login).
        if (!isAuthAction && token) notifySessionExpired(errMsg);
        const authErr: any = new Error(errMsg);
        authErr.code = 'AUTH_REQUIRED';
        throw authErr;
      }
      if (errMsg.toLowerCase().includes('version') && errMsg.toLowerCase().includes('less than')) {
        throw new Error(
          `Google Apps Script Version Error: ${errMsg}. Please update your Web App URL in "Drive & Script Config" to use the latest deployment endpoint ("/exec").`
        );
      }
      // Mark it so callers can tell "the server said no" from "the server could not be reached".
      const serverErr: any = new Error(errMsg);
      serverErr.serverError = true;
      if ((data as any).code) serverErr.code = (data as any).code;
      throw serverErr;
    }

    // If remote action succeeded, sync local cache
    if (isAuthAction && data.user) {
      syncLocalUserWithRemote(data.user);
      if (data.token && payload.password) {
        await rememberOfflineCredential(data.user, String(payload.password));
      }
    } else if (action === 'getBranding') {
      applySupabaseConfigFromBranding(data);
    } else if (action === 'getUsers' && Array.isArray((data as any).users)) {
      syncAllLocalUsers((data as any).users);
    } else if (action === 'adminDeleteUser') {
      const delEmail = payload.email || payload.userId || (data as any).email;
      if (delEmail) deleteLocalUserByEmail(delEmail);
    }

    return data;
  } catch (remoteError: any) {
    // Never hide an expired / missing session behind local fallback data.
    if (remoteError && remoteError.code === 'AUTH_REQUIRED') {
      throw remoteError;
    }

    // Server unreachable: allow offline sign-in only for accounts that already signed in online
    // on this device (cached salted hash). There are no built-in accounts and no offline sign-up.
    const errStr = remoteError?.message || '';
    const isConnectionIssue =
      errStr.includes('Failed to fetch') ||
      errStr.includes('NetworkError') ||
      errStr.includes('Load failed') ||
      errStr.includes('timed out') ||
      errStr.includes('Network request failed');

    if (isAuthAction && isConnectionIssue) {
      if (action === 'login') {
        return (await localLogin(
          payload.email || payload.userId || payload.identifier,
          payload.password
        )) as any;
      }
      throw new Error('Creating an account needs a connection to the server. Please try again when you are online.');
    }

    // User directory is read-only offline. Changes to users must go to the server.
    if (action === 'getUsers' && isConnectionIssue) {
      return { success: true, users: getLocalUsers(), isLocalFallback: true } as any;
    }

    // Analytics data local workstation fallback
    if (action === 'getAnalyticsData') {
      const fromDate = payload.fromDate || new Date().toISOString().slice(0, 10);
      const toDate = payload.toDate || fromDate;
      const localData = await computeLocalAnalyticsData(
        fromDate,
        toDate,
        payload.platform,
        payload.recordingType,
        payload.packer
      );
      return { success: true, ...localData } as any;
    }

    // Upload logs local workstation fallback
    if (action === 'getUploadLogs') {
      const logs = await getLocalWorkstationLogs(payload);
      return { success: true, logs } as any;
    }

    // Advanced search local workstation fallback
    if (action === 'advancedSearch') {
      const logs = await getLocalWorkstationLogs({
        searchQuery: payload.query || payload.orderId,
        platform: payload.platform,
        recordingType: payload.recordingType,
        fromDate: payload.fromDate,
        toDate: payload.toDate,
        limit: payload.limit || 500,
      });
      return { success: true, results: logs, rows: logs, total: logs.length } as any;
    }

    throw remoteError;
  }
}

export async function checkBackendHealth(customUrl?: string): Promise<{
  online: boolean;
  version?: string;
  service?: string;
  error?: string;
}> {
  const url = customUrl || getStoredApiUrl();
  // Try POST request via requestApi first
  try {
    const res = await requestApi<{ status?: string; version?: string; service?: string }>(
      'health',
      {},
      url
    );
    if (res && res.success) {
      return { online: true, version: res.version || '2.9.38', service: res.service || 'Order Packing Video System' };
    }
  } catch (err) {
    // Fall back to GET fetch
  }

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
    });
    const text = await res.text();
    const data = JSON.parse(text);
    if (data.success && data.status === 'online') {
      return { online: true, version: data.version, service: data.service };
    }
    return { online: false, error: data.error || 'Unexpected response status' };
  } catch (err: any) {
    return { online: false, error: err.message || 'Connection failed. Please ensure Web App is deployed with "Anyone" access.' };
  }
}

export function normalizeOrderId(id: string | null | undefined): string {
  if (!id) return '';
  let s = String(id).trim().toLowerCase();
  // Strip leading '#' (any number of them), 'no.', 'order#', 'order ', etc.
  s = s.replace(/^(?:order\s*#*|#+|no\.?\s*)/i, '');
  s = s.replace(/^[#\s]+/, '');
  // Strip trailing .0 or .00 from numeric cell exports
  s = s.replace(/\.0+$/, '');
  // Remove all whitespace
  return s.replace(/\s+/g, '');
}

/**
 * The one way an order ID is written anywhere (Sheet, Supabase, file names).
 * - Every space is removed (leading, trailing and in the middle).
 * - D2C orders always carry exactly one leading '#': "OD-10063", "##OD-10063", " # OD-10063 " -> "#OD-10063".
 *   When the platform is unknown, an "OD-" order is treated as D2C.
 * - Other platforms keep what was typed, except a run of leading '#' becomes one.
 * Keep in step with canonicalOrderId_ in backend/Code.gs.
 */
export function formatOrderId(id: string | null | undefined, platform?: string | null): string {
  if (id === null || id === undefined) return '';
  let s = String(id).replace(/[\s\u00a0\u200b\ufeff]+/g, '');
  if (!s) return '';
  const hadHash = /^#/.test(s);
  const bare = s.replace(/^#+/, '');
  if (!bare) return '';
  const pf = String(platform || '').trim().toLowerCase();
  if (pf === 'd2c' || (!pf && /^od-/i.test(bare))) return '#' + bare.toUpperCase();
  return (hadHash ? '#' : '') + bare;
}

/** Order ID for labels such as "Order #OD-10063": never shows two '#'. */
export function orderLabel(id: string | null | undefined): string {
  const bare = String(id || '').trim().replace(/^#+/, '');
  return bare ? '#' + bare : '';
}

export async function checkDuplicate(meta: {
  orderId: string;
  platform: string;
  recordingType: string;
}): Promise<VideoRecord | null> {
  const targetOrderId = normalizeOrderId(meta.orderId);
  const targetType = (meta.recordingType || 'Forward').trim().toLowerCase();
  if (!targetOrderId) return null;

  try {
    const res = await requestApi<{ isDuplicate?: boolean; existing?: any; results?: VideoRecord[] }>('checkDuplicateOrder', {
      orderId: meta.orderId,
      platform: meta.platform,
      recordingType: meta.recordingType || 'Forward',
    });
    if (res.isDuplicate && res.existing) {
      const existingType = String(res.existing.recordingType || '').trim().toLowerCase();
      // Only treat as duplicate if recordingType matches (Forward vs Return are separate)
      if (!existingType || existingType === targetType || targetType === 'all') {
        return res.existing;
      }
    }
    if (Array.isArray(res.results) && res.results.length > 0) {
      const matched = res.results.find(
        (r) =>
          normalizeOrderId(r.orderId) === targetOrderId &&
          String(r.recordingType || 'Forward').trim().toLowerCase() === targetType &&
          Boolean(r.fileId && r.fileId.length > 5)
      );
      if (matched) return matched;
    }
    return null;
  } catch (err) {
    // Fallback to advancedSearch query
    try {
      const fallbackRes = await requestApi<{ results: VideoRecord[] }>('advancedSearch', {
        orderId: meta.orderId,
        platform: meta.platform,
        recordingType: meta.recordingType || 'Forward',
        limit: 5,
      });
      if (Array.isArray(fallbackRes.results) && fallbackRes.results.length > 0) {
        const matched = fallbackRes.results.find(
          (r) =>
            normalizeOrderId(r.orderId) === targetOrderId &&
            String(r.recordingType || 'Forward').trim().toLowerCase() === targetType &&
            Boolean(r.fileId && r.fileId.length > 5)
        );
        if (matched) return matched;
      }
    } catch (fErr) {}
    return null;
  }
}

export async function applySheetConditionalFormatting(): Promise<ApiResponse> {
  return requestApi('applyConditionalFormatting', {});
}

export async function cleanupStuckUploads(options: { purgeInterrupted?: boolean } = {}): Promise<ApiResponse & { cleanedRows?: number; clearedProperties?: number; purged?: boolean }> {
  return requestApi('cleanupStuckUploads', {
    purgeInterrupted: !!options.purgeInterrupted,
    purgeStale: !!options.purgeInterrupted,
  });
}

export async function repairSheetPlaybackUrls(): Promise<ApiResponse & { fixedRows?: number }> {
  return requestApi('repairPlaybackUrls', {});
}

export async function migrateDriveMonthlyFolders(): Promise<ApiResponse & {
  movedDateFolders?: number;
  mergedDateFolders?: number;
  movedFiles?: number;
  sheetLinksVerified?: number;
  logs?: string[];
}> {
  return requestApi('migrateDriveFolders', {});
}

export async function runSystemSetup(): Promise<ApiResponse> {
  return requestApi('setup', {});
}

export async function fetchUploadLogs(params: {
  status?: string;
  orderId?: string;
  platform?: string;
  recordingType?: string;
  searchQuery?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}): Promise<{
  success: boolean;
  logs: import('../types').UploadLogItem[];
  stats?: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    failed: number;
  };
  error?: string;
  isLocalFallback?: boolean;
}> {
  try {
    const res = await requestApi<{ logs: import('../types').UploadLogItem[]; stats?: any }>('getUploadLogs', params);
    if (res && res.success && Array.isArray(res.logs) && res.logs.length > 0) {
      try {
        localStorage.setItem('vms_cached_cloud_logs', JSON.stringify(res.logs.slice(0, 500)));
      } catch (_) {}
      return {
        success: true,
        logs: res.logs,
        stats: res.stats,
      };
    }
  } catch (err: any) {
    console.warn('fetchUploadLogs remote request note, using local workstation store:', err?.message || err);
  }

  // Graceful local workstation fallback: Always return available logs without throwing errors
  const localLogs = await getLocalWorkstationLogs(params);
  let completed = 0, inProgress = 0, pending = 0, failed = 0;
  localLogs.forEach((l) => {
    const st = (l.status || '').toLowerCase();
    if (st === 'completed') completed++;
    else if (st === 'in progress' || st === 'uploading') inProgress++;
    else if (st === 'failed') failed++;
    else pending++;
  });

  return {
    success: true,
    logs: localLogs,
    stats: {
      total: localLogs.length,
      completed,
      inProgress,
      pending,
      failed,
    },
    isLocalFallback: true,
  };
}

export async function deleteLogEntry(params: {
  orderId?: string;
  uploadId?: string;
  driveFileId?: string;
  queueJobId?: string;
  timestamp?: string;
  recordingType?: string;
  platform?: string;
  fileName?: string;
  deleteAllForOrder?: boolean;
  deleteFromDrive?: boolean;
  deleteFromSheets?: boolean;
}): Promise<{
  success: boolean;
  message?: string;
  orderLogsRemoved?: number;
  uploadLogsRemoved?: number;
  driveTrashed?: boolean;
  driveTrashedCount?: number;
  notSupportedByBackend?: boolean;
}> {
  try {
    const res = await requestApi<{
      orderLogsRemoved?: number;
      uploadLogsRemoved?: number;
      driveTrashed?: boolean;
      driveTrashedCount?: number;
      message?: string;
    }>('deleteLogEntry', params);
    return {
      success: true,
      ...res,
    };
  } catch (err: any) {
    const errMsg = String(err?.message || err || '');
    if (errMsg.toLowerCase().includes('unknown action')) {
      return {
        success: false,
        notSupportedByBackend: true,
        message: 'Apps Script deployment does not yet support remote row deletion. Updated locally.',
      };
    }
    throw err;
  }
}

export interface DuplicateEntryDetail {
  sheet: string;
  row: number;
  timestamp: string;
  packerEmail: string;
  fileId: string;
  fileName?: string;
  playbackUrl: string;
  status: string;
  willMoveFileToTrash?: boolean;
}

export interface DuplicateGroupItem {
  orderId: string;
  platform: string;
  recordingType: string;
  totalEntries: number;
  keeper: DuplicateEntryDetail;
  duplicates: DuplicateEntryDetail[];
}

export interface ScanDuplicatesResult {
  success: boolean;
  totalDuplicateOrders: number;
  totalDuplicateSheetRows: number;
  totalDuplicateDriveVideos: number;
  groups: DuplicateGroupItem[];
  scannedTabs?: string[];
  tabSummary?: Record<string, number>;
  message?: string;
  error?: string;
}

export interface RemoveDuplicatesResult {
  success: boolean;
  cleanedOrdersCount: number;
  removedSheetRowsCount: number;
  movedDriveVideosCount: number;
  archivedCount: number;
  removedBySheet?: Record<string, number>;
  scannedTabs?: string[];
  movedFiles?: Array<{
    fileId: string;
    fileName: string;
    orderId: string;
    trashFolderName: string;
    parentFolderName: string;
    trashFolderUrl?: string;
  }>;
  message?: string;
  error?: string;
}

export async function scanDuplicateRecords(params?: {
  orderId?: string;
  driveFolderId?: string;
  keepPolicy?: 'latest' | 'first';
}): Promise<ScanDuplicatesResult> {
  const res = await requestApi<ScanDuplicatesResult>('scanDuplicates', params || {});
  return {
    success: true,
    totalDuplicateOrders: res.totalDuplicateOrders || 0,
    totalDuplicateSheetRows: res.totalDuplicateSheetRows || 0,
    totalDuplicateDriveVideos: res.totalDuplicateDriveVideos || 0,
    groups: res.groups || [],
    scannedTabs: res.scannedTabs || [],
    tabSummary: res.tabSummary || {},
    message: res.message,
  };
}

export async function removeDuplicateRecords(params: {
  keepPolicy?: 'latest' | 'first';
  moveDriveVideosToTrash?: boolean;
  moveDriveVideosToTrashFolder?: boolean;
  removeSheetEntries?: boolean;
  orderId?: string;
  driveFolderId?: string;
}): Promise<RemoveDuplicatesResult> {
  const res = await requestApi<RemoveDuplicatesResult>('removeDuplicates', {
    keepPolicy: params.keepPolicy || 'latest',
    moveDriveVideosToTrashFolder: params.moveDriveVideosToTrashFolder !== false,
    removeSheetEntries: params.removeSheetEntries !== false,
    orderId: params.orderId || '',
    driveFolderId: params.driveFolderId || '',
  });
  return {
    success: true,
    cleanedOrdersCount: res.cleanedOrdersCount || 0,
    removedSheetRowsCount: res.removedSheetRowsCount || 0,
    movedDriveVideosCount: res.movedDriveVideosCount || 0,
    archivedCount: res.archivedCount || 0,
    removedBySheet: res.removedBySheet || {},
    scannedTabs: res.scannedTabs || [],
    movedFiles: res.movedFiles || [],
    message: res.message,
  };
}

export interface OlderVideoItem {
  orderId: string;
  platform: string;
  recordingType: string;
  timestamp: string;
  dateStr?: string;
  ageDays: number;
  sheet: string;
  row?: number;
  fileId?: string;
  fileName?: string;
  playbackUrl?: string;
  fileSizeStr?: string;
  fileSizeBytes?: number;
}

export interface ScanOlderVideosResult {
  success: boolean;
  daysThreshold: number;
  cutoffDate: string;
  totalOlderOrders: number;
  totalOlderSheetRows: number;
  totalOlderDriveVideos: number;
  estimatedTotalSizeBytes?: number;
  items: OlderVideoItem[];
  scannedTabs?: string[];
  tabSummary?: Record<string, number>;
  message?: string;
  error?: string;
}

export interface DeleteOlderVideosResult {
  success: boolean;
  daysThreshold: number;
  cutoffDate: string;
  deletedOrdersCount: number;
  removedSheetRowsCount: number;
  movedDriveVideosCount: number;
  freedSizeBytes?: number;
  alreadyGoneCount?: number;
  failedCount?: number;
  errors?: string[];
  done?: boolean;
  removedBySheet?: Record<string, number>;
  scannedTabs?: string[];
  movedFiles?: Array<{
    fileId: string;
    fileName: string;
    orderId: string;
    trashFolderUrl?: string;
  }>;
  message?: string;
  error?: string;
}

export async function scanOlderVideos(params: {
  days?: number;
  platform?: string;
  recordingType?: string;
  driveFolderId?: string;
}): Promise<ScanOlderVideosResult> {
  const daysThreshold = Math.max(1, params.days || 90);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);
  cutoff.setHours(23, 59, 59, 999);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  let remoteRes: any = null;
  try {
    const res = await requestApi<ScanOlderVideosResult>('scanOlderVideos', {
      days: daysThreshold,
      platform: params.platform || '',
      recordingType: params.recordingType || '',
      driveFolderId: params.driveFolderId || getStoredDriveFolderId(),
    });

    if (res && res.success && Array.isArray(res.items)) {
      return {
        success: true,
        daysThreshold,
        cutoffDate: res.cutoffDate || cutoffStr,
        totalOlderOrders: res.totalOlderOrders || res.items.length,
        totalOlderSheetRows: res.totalOlderSheetRows || res.items.length,
        totalOlderDriveVideos: res.totalOlderDriveVideos || res.items.filter((i) => i.fileId).length,
        estimatedTotalSizeBytes: res.estimatedTotalSizeBytes || 0,
        items: res.items,
        scannedTabs: res.scannedTabs || [],
        tabSummary: res.tabSummary || {},
        message: res.message,
      };
    }
    remoteRes = res;
  } catch (err: any) {
    console.warn('Direct scanOlderVideos call failed or not supported by endpoint, using comprehensive fallback scan:', err);
  }

  // Comprehensive fallback scan: Query Google Sheets via advancedSearch, getUploadLogs, and local workstation cache
  const olderItems: OlderVideoItem[] = [];
  const seenKeys = new Set<string>();

  // 1. Search Google Sheets via advancedSearch (which handles OrderLog and ReturnLog)
  try {
    const searchRes = await requestApi('advancedSearch', {
      limit: 5000,
      fromDate: '2010-01-01',
      toDate: cutoffStr,
      platform: params.platform === 'ALL' ? '' : params.platform,
      recordingType: params.recordingType === 'ALL' ? '' : params.recordingType,
    });

    if (searchRes && Array.isArray((searchRes as any).results || (searchRes as any).orders)) {
      const records = ((searchRes as any).results || (searchRes as any).orders) as any[];
      records.forEach((rec) => {
        const tsRaw = rec.timestamp || rec.date || rec.Timestamp;
        if (!tsRaw) return;
        const recDate = new Date(tsRaw);
        if (isNaN(recDate.getTime()) || recDate >= cutoff) return;

        const pf = rec.platform || rec.Platform || 'D2C';
        const rt = rec.recordingType || rec.type || (rec.source === 'Return' ? 'Return' : 'Forward');

        if (params.platform && params.platform !== 'ALL' && pf.toLowerCase() !== params.platform.toLowerCase()) return;
        if (params.recordingType && params.recordingType !== 'ALL' && rt.toLowerCase() !== params.recordingType.toLowerCase()) return;

        const oid = rec.orderId || rec.orderIdRaw || rec['Order ID'] || 'UNKNOWN';
        const fid = rec.driveFileId || rec.fileId || rec['Drive File ID'];
        const key = `${oid}_${fid || recDate.toISOString()}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const diffDays = Math.floor((Date.now() - recDate.getTime()) / 86400000);
        olderItems.push({
          orderId: oid,
          platform: pf,
          recordingType: rt,
          timestamp: recDate.toISOString(),
          dateStr: recDate.toISOString().split('T')[0],
          ageDays: diffDays,
          sheet: rt === 'Return' ? 'ReturnLog' : 'OrderLog',
          fileId: fid,
          fileName: rec.fileName || (oid ? `${oid}_${pf}_${rt}.mp4` : ''),
          playbackUrl: rec.playbackUrl || rec.url || (fid ? `https://drive.google.com/file/d/${fid}/preview` : ''),
          fileSizeStr: rec.fileSize || rec.size,
        });
      });
    }
  } catch (searchErr) {
    console.warn('advancedSearch fallback scan warning:', searchErr);
  }

  // 2. Query Upload Logs
  try {
    const logsRes = await requestApi('getUploadLogs', { limit: 5000 });
    if (logsRes && Array.isArray((logsRes as any).logs)) {
      (logsRes as any).logs.forEach((log: any) => {
        const tsRaw = log.timestamp || log.Timestamp;
        if (!tsRaw) return;
        const logDate = new Date(tsRaw);
        if (isNaN(logDate.getTime()) || logDate >= cutoff) return;

        const pf = log.platform || log.Platform || 'D2C';
        const rt = log.recordingType || log.type || 'Forward';

        if (params.platform && params.platform !== 'ALL' && pf.toLowerCase() !== params.platform.toLowerCase()) return;
        if (params.recordingType && params.recordingType !== 'ALL' && rt.toLowerCase() !== params.recordingType.toLowerCase()) return;

        const oid = log.orderId || log['Order ID'] || 'UNKNOWN';
        const fid = log.driveFileId || log.fileId || log['Drive File ID'];
        const key = `${oid}_${fid || logDate.toISOString()}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const diffDays = Math.floor((Date.now() - logDate.getTime()) / 86400000);
        olderItems.push({
          orderId: oid,
          platform: pf,
          recordingType: rt,
          timestamp: logDate.toISOString(),
          dateStr: logDate.toISOString().split('T')[0],
          ageDays: diffDays,
          sheet: 'UploadLog',
          fileId: fid,
          fileName: log.fileName,
          playbackUrl: log.playbackUrl || (fid ? `https://drive.google.com/file/d/${fid}/preview` : ''),
          fileSizeStr: log.fileSize,
        });
      });
    }
  } catch (logErr) {
    console.warn('getUploadLogs fallback scan warning:', logErr);
  }

  // 3. Scan Local Workstation Logs
  try {
    const localLogs = await getLocalWorkstationLogs();
    localLogs.forEach((log) => {
      if (!log.timestamp) return;
      const logDate = new Date(log.timestamp);
      if (isNaN(logDate.getTime()) || logDate >= cutoff) return;

      const pf = log.platform || 'D2C';
      const rt = log.recordingType || 'Forward';

      if (params.platform && params.platform !== 'ALL' && pf.toLowerCase() !== params.platform.toLowerCase()) return;
      if (params.recordingType && params.recordingType !== 'ALL' && rt.toLowerCase() !== params.recordingType.toLowerCase()) return;

      const oid = log.orderId || 'UNKNOWN';
      const fid = log.driveFileId;
      const key = `${oid}_${fid || logDate.toISOString()}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const diffDays = Math.floor((Date.now() - logDate.getTime()) / 86400000);
      olderItems.push({
        orderId: oid,
        platform: pf,
        recordingType: rt,
        timestamp: logDate.toISOString(),
        dateStr: logDate.toISOString().split('T')[0],
        ageDays: diffDays,
        sheet: rt === 'Return' ? 'ReturnLog' : 'OrderLog',
        fileId: fid,
        fileName: log.fileName,
        playbackUrl: log.playbackUrl,
        fileSizeStr: log.fileSize,
      });
    });
  } catch (localErr) {
    console.warn('local workstation logs scan warning:', localErr);
  }

  return {
    success: true,
    daysThreshold,
    cutoffDate: cutoffStr,
    totalOlderOrders: olderItems.length,
    totalOlderSheetRows: olderItems.length,
    totalOlderDriveVideos: olderItems.filter((i) => i.fileId).length,
    estimatedTotalSizeBytes: 0,
    items: olderItems,
    scannedTabs: ['OrderLog', 'ReturnLog', 'UploadLog'],
    message: remoteRes?.message || `Scanned ${olderItems.length} record(s) older than ${daysThreshold} days across Google Sheets and workstation cache.`,
  };
}

export interface DeleteOlderProgress {
  round: number;
  movedDriveVideosCount: number;
  removedSheetRowsCount: number;
  remainingVideos: number;
  message?: string;
}

/**
 * Runs the server cleanup in rounds: each call works for up to ~4 minutes and returns
 * done:false with what is left, so thousands of videos finish without hitting the
 * Apps Script time limit. No per-row fallback: a failure is reported, never guessed around.
 */
export async function deleteOlderVideos(
  params: {
    days?: number;
    platform?: string;
    recordingType?: string;
    driveFolderId?: string;
    moveDriveVideosToTrash?: boolean;
    removeSheetEntries?: boolean;
  },
  onProgress?: (p: DeleteOlderProgress) => void
): Promise<DeleteOlderVideosResult> {
  const daysThreshold = params.days || 90;
  const total = {
    movedDriveVideosCount: 0,
    removedSheetRowsCount: 0,
    alreadyGoneCount: 0,
    failedCount: 0,
    errors: [] as string[],
    removedBySheet: {} as Record<string, number>,
  };
  let last: any = null;
  for (let round = 1; round <= 40; round++) {
    const res: any = await requestApi<DeleteOlderVideosResult>('deleteOlderVideos', {
      days: daysThreshold,
      platform: params.platform || '',
      recordingType: params.recordingType || '',
      moveDriveVideosToTrash: params.moveDriveVideosToTrash !== false,
      removeSheetEntries: false, // sheet rows are never deleted
    });
    if (!res || res.success === false) throw new Error(res?.error || 'The cleanup did not run.');
    last = res;
    total.movedDriveVideosCount += res.movedDriveVideosCount || 0;
    total.removedSheetRowsCount += res.removedSheetRowsCount || 0;
    total.alreadyGoneCount += res.alreadyGoneCount || 0;
    total.failedCount = res.failedCount || 0; // failures are retried each round; the last count is current
    total.errors = res.errors || [];
    Object.entries(res.removedBySheet || {}).forEach(([k, v]) => {
      total.removedBySheet[k] = (total.removedBySheet[k] || 0) + Number(v || 0);
    });
    onProgress?.({
      round,
      movedDriveVideosCount: total.movedDriveVideosCount,
      removedSheetRowsCount: total.removedSheetRowsCount,
      remainingVideos: res.remainingVideos || 0,
      message: res.message,
    });
    if (res.done !== false) break;
  }
  const doneMsg =
    `${total.movedDriveVideosCount} video(s) moved to Drive Trash, ${total.removedSheetRowsCount} log row(s) removed` +
    (total.alreadyGoneCount ? `, ${total.alreadyGoneCount} were already deleted` : '') +
    (total.failedCount ? `, ${total.failedCount} could not be deleted` : '') +
    '.';
  return {
    success: true,
    daysThreshold,
    cutoffDate: last?.cutoffDate || '',
    deletedOrdersCount: total.removedSheetRowsCount || total.movedDriveVideosCount,
    removedSheetRowsCount: total.removedSheetRowsCount,
    movedDriveVideosCount: total.movedDriveVideosCount,
    alreadyGoneCount: total.alreadyGoneCount,
    failedCount: total.failedCount,
    errors: total.errors,
    done: last?.done !== false,
    removedBySheet: total.removedBySheet,
    message: doneMsg,
  };
}

export function formatFileSize(bytes: number | string | undefined | null): string {
  if (bytes === undefined || bytes === null || bytes === '' || bytes === '—') return '—';

  if (typeof bytes === 'string') {
    const s = bytes.trim();
    if (
      !s ||
      s === '—' ||
      s === '0' ||
      s === '0 B' ||
      s === '0 KB' ||
      s === '0 MB' ||
      s === '0.0 MB' ||
      s === '0.00 MB' ||
      s === 'Unknown' ||
      s === 'Standard HD' ||
      s === 'Standard 1080p'
    ) {
      return '—';
    }
    if (s.endsWith('MB') || s.endsWith('KB') || s.endsWith('GB') || s.endsWith('B')) {
      return s;
    }
    const num = parseFloat(s);
    if (isNaN(num) || num <= 0) return '—';
    bytes = num;
  }

  if (typeof bytes === 'number') {
    if (isNaN(bytes) || bytes <= 0) return '—';
    const mb = bytes / (1024 * 1024);
    if (mb < 0.1) {
      const kb = bytes / 1024;
      return kb < 0.1 ? `${bytes} B` : `${kb.toFixed(1)} KB`;
    }
    return `${mb.toFixed(2)} MB`;
  }

  return String(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}

export async function fetchCloudBranding(): Promise<{
  logoUrl?: string;
  faviconUrl?: string;
  appName?: string;
  appSubtitle?: string;
  videoDriveFolderId?: string;
  maxVideoSizeMb?: number;
} | null> {
  try {
    const res = await requestApi<{
      logoUrl?: string;
      faviconUrl?: string;
      appName?: string;
      appSubtitle?: string;
      videoDriveFolderId?: string;
      maxVideoSizeMb?: number;
    }>('getBranding', {});
    if (res.success) {
      return {
        logoUrl: res.logoUrl || '',
        faviconUrl: res.faviconUrl || '',
        appName: res.appName || '',
        appSubtitle: res.appSubtitle || '',
        videoDriveFolderId: res.videoDriveFolderId || '',
        maxVideoSizeMb: typeof res.maxVideoSizeMb === 'number' ? res.maxVideoSizeMb : undefined,
      };
    }
  } catch (err) {}
  return null;
}

export async function saveCloudBranding(config: {
  logoUrl?: string;
  faviconUrl?: string;
  appName?: string;
  appSubtitle?: string;
  videoDriveFolderId?: string;
  maxVideoSizeMb?: number;
}): Promise<boolean> {
  try {
    const res = await requestApi('saveBranding', config);
    return !!res.success;
  } catch (err) {
    return false;
  }
}

export async function uploadBrandingImage(params: {
  type: 'logo' | 'favicon';
  fileName: string;
  mimeType: string;
  base64: string;
}): Promise<{
  success: boolean;
  url: string;
  fileId?: string;
  folderId?: string;
  message?: string;
}> {
  const res = await requestApi<{
    url: string;
    fileId?: string;
    folderId?: string;
    message?: string;
  }>('uploadBrandingImage', params);
  return {
    success: true,
    url: res.url,
    fileId: res.fileId,
    folderId: res.folderId,
    message: res.message,
  };
}

export async function fetchDriveFileSize(params: {
  driveFileId: string;
  orderId?: string;
}): Promise<string | null> {
  if (!params.driveFileId) return null;
  try {
    const res = await requestApi<{
      success: boolean;
      fileSize?: number | string;
      fileName?: string;
      error?: string;
    }>('getDriveFileSize', {
      driveFileId: params.driveFileId,
      orderId: params.orderId || '',
    });
    if (res && res.success && res.fileSize) {
      return formatFileSize(res.fileSize);
    }
  } catch (e) {
    console.warn('fetchDriveFileSize note:', e);
  }
  return null;
}


export interface SheetCleanupScan {
  success: boolean;
  sheets: { name: string; rows: number; duplicates: number; unusable: number; remove: number }[];
  reasons: Record<string, number>;
  totalRemove: number;
  totalDuplicates: number;
  totalUnusable: number;
  duplicateRecordings: number;
  extraVideos: number;
  topGroups: { sheet: string; orderId: string; recordingType: string; keepRow: number; removeRows: number }[];
  message: string;
}

export interface SheetCleanupResult {
  removedRowsCount: number;
  archivedRowsCount: number;
  removedBySheet: Record<string, number>;
  videosTrashedCount: number;
  videosFailedCount: number;
  done: boolean;
}

export interface OrderIdFormatResult {
  success: boolean;
  total: number;
  fixed?: number;
  sheets: { sheet: string; rows: number }[];
  examples: { sheet: string; row: number; from: string; to: string }[];
  manifestRepeats: number;
  message?: string;
  error?: string;
}

/** Settings: how many order IDs are not in the standard format (#OD-10063 for D2C, no spaces). */
export async function scanOrderIdFormat(): Promise<OrderIdFormatResult> {
  const res: any = await requestApi<OrderIdFormatResult>('scanOrderIdFormat', {});
  if (!res || res.success === false) throw new Error(res?.error || 'Could not check order IDs.');
  return res as OrderIdFormatResult;
}

/** Settings: rewrite those order ID cells in place. Never adds or removes rows. */
export async function fixOrderIdFormat(): Promise<OrderIdFormatResult> {
  const res: any = await requestApi<OrderIdFormatResult>('fixOrderIdFormat', {});
  if (!res || res.success === false) throw new Error(res?.error || 'Could not fix order IDs.');
  return res as OrderIdFormatResult;
}

export async function scanSheetCleanup(): Promise<SheetCleanupScan> {
  const res: any = await requestApi<SheetCleanupScan>('scanSheetCleanup', {});
  if (!res || res.success === false) throw new Error(res?.error || 'Could not scan the sheet.');
  return res as SheetCleanupScan;
}

export interface SheetCleanupLiveProgress {
  phase: 'videos' | 'rows' | 'done';
  videosDone: number;
  videosTotal: number;
  rowsDone: number;
  rowsTotal: number;
  at: number;
}

/** Progress of the cleanup round running right now (null when unknown or the backend is older). */
export async function getSheetCleanupProgress(): Promise<SheetCleanupLiveProgress | null> {
  try {
    const res: any = await requestApi('getSheetCleanupProgress', {});
    return res && res.success && res.progress ? (res.progress as SheetCleanupLiveProgress) : null;
  } catch {
    return null;
  }
}

/** Runs the cleanup in server rounds until everything planned is removed. */
export async function runSheetCleanup(
  opts: { trashExtraVideos: boolean },
  onProgress?: (removed: number, remaining: number) => void
): Promise<SheetCleanupResult> {
  const total: SheetCleanupResult = {
    removedRowsCount: 0, archivedRowsCount: 0, removedBySheet: {}, videosTrashedCount: 0, videosFailedCount: 0, done: false,
  };
  for (let round = 1; round <= 500; round++) {
    const res: any = await requestApi('runSheetCleanup', { trashExtraVideos: opts.trashExtraVideos && round === 1 });
    if (!res || res.success === false) throw new Error(res?.error || 'The cleanup did not run.');
    total.removedRowsCount += res.removedRowsCount || 0;
    total.archivedRowsCount += res.archivedRowsCount || 0;
    total.videosTrashedCount += res.videosTrashedCount || 0;
    total.videosFailedCount += res.videosFailedCount || 0;
    Object.entries(res.removedBySheet || {}).forEach(([k, v]) => {
      total.removedBySheet[k] = (total.removedBySheet[k] || 0) + Number(v || 0);
    });
    onProgress?.(total.removedRowsCount, res.remainingRows || 0);
    if (res.done !== false) {
      total.done = true;
      break;
    }
  }
  return total;
}
