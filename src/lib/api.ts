import { getStoredApiUrl, getStoredToken, getStoredDriveFolderId, dbGetAllQueue } from './storage';
import { User, VideoRecord, AnalyticsData } from '../types';
import { computeLocalAnalyticsData, getLocalWorkstationLogs } from './localAnalytics';
import {
  localLogin,
  localSignup,
  getLocalUsers,
  syncLocalUserWithRemote,
  syncAllLocalUsers,
  saveLocalUsers,
  deleteLocalUserByEmail,
  recordDeletedUserEmail,
  StoredLocalUser,
} from './localAuth';

export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
}

export async function requestApi<T = any>(
  action: string,
  payload: Record<string, any> = {},
  customUrl?: string
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
  const isUserMgmtAction =
    action === 'getUsers' ||
    action === 'adminCreateUser' ||
    action === 'adminManageUser' ||
    action === 'adminResetPassword' ||
    action === 'adminDeleteUser';

  try {
    let response: Response | null = null;
    let lastFetchErr: any = null;

    // Single attempt for fast responsiveness, with 12s abort limit
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
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
      clearTimeout(timeoutId);
    } catch (fetchErr: any) {
      lastFetchErr = fetchErr;
    }

    if (!response) {
      if (lastFetchErr && lastFetchErr.name === 'AbortError') {
        throw new Error('Request timed out (12s limit). Google Apps Script may be waking up or slow.');
      }
      throw lastFetchErr || new Error('Network request failed. Please check your connection.');
    }

    const text = await response.text();

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
      if (errMsg.toLowerCase().includes('version') && errMsg.toLowerCase().includes('less than')) {
        throw new Error(
          `Google Apps Script Version Error: ${errMsg}. Please update your Web App URL in "Drive & Script Config" to use the latest deployment endpoint ("/exec").`
        );
      }
      throw new Error(errMsg);
    }

    // If remote action succeeded, sync local cache
    if (isAuthAction && data.user) {
      syncLocalUserWithRemote(data.user);
    } else if (action === 'getUsers' && Array.isArray((data as any).users)) {
      syncAllLocalUsers((data as any).users);
    } else if (action === 'adminDeleteUser') {
      const delEmail = payload.email || payload.userId || (data as any).email;
      if (delEmail) deleteLocalUserByEmail(delEmail);
    }

    return data;
  } catch (remoteError: any) {
    // If it's an authentication action and remote is unavailable or invalid Apps Script response,
    // seamlessly fall back to the verified local workstation store
    if (isAuthAction) {
      const errStr = remoteError?.message || '';
      const isConnectionIssue =
        errStr.includes('Invalid Apps Script') ||
        errStr.includes('Failed to fetch') ||
        errStr.includes('NetworkError') ||
        errStr.includes('Version');

      if (isConnectionIssue) {
        if (action === 'login') {
          return (await localLogin(
            payload.email || payload.userId || payload.identifier,
            payload.password
          )) as any;
        }
        if (action === 'signup') {
          return (await localSignup(payload.fullName, payload.email, payload.password)) as any;
        }
      }
    }

    // If it's user management action and remote is unavailable or throws error, fall back to local store
    if (isUserMgmtAction) {
      if (action === 'getUsers') {
        return { success: true, users: getLocalUsers() } as any;
      }
      if (action === 'adminCreateUser') {
        const users = getLocalUsers();
        const cleanEmail = (payload.email || '').trim().toLowerCase();
        const cleanName = (payload.name || '').trim();
        const existing = users.find((u) => u.email.toLowerCase() === cleanEmail);
        if (existing) throw new Error('A user with this email already exists.');
        const newUser: StoredLocalUser = {
          name: cleanName,
          email: cleanEmail,
          role: payload.role || 'User',
          status: payload.status || 'Approved',
          created: new Date().toISOString(),
          passwordHash: payload.password || 'Admin@123',
        };
        users.push(newUser);
        saveLocalUsers(users);
        return { success: true, user: newUser } as any;
      }
      if (action === 'adminManageUser') {
        const users = getLocalUsers();
        const cleanEmail = (payload.email || '').trim().toLowerCase();
        const index = users.findIndex((u) => u.email.toLowerCase() === cleanEmail);
        if (index >= 0) {
          if (payload.name) users[index].name = payload.name;
          if (payload.role) users[index].role = payload.role;
          if (payload.status) users[index].status = payload.status;
          if (payload.password) users[index].passwordHash = payload.password;
          saveLocalUsers(users);
        }
        return { success: true } as any;
      }
      if (action === 'adminResetPassword') {
        const users = getLocalUsers();
        const cleanEmail = (payload.email || '').trim().toLowerCase();
        const index = users.findIndex((u) => u.email.toLowerCase() === cleanEmail);
        if (index >= 0) {
          users[index].passwordHash = payload.newPassword || payload.password || 'Admin@123';
          saveLocalUsers(users);
        }
        return { success: true, message: 'Password reset successfully in local store.' } as any;
      }
      if (action === 'adminDeleteUser') {
        let users = getLocalUsers();
        const cleanEmail = (payload.email || '').trim().toLowerCase();
        users = users.filter((u) => u.email.toLowerCase() !== cleanEmail);
        saveLocalUsers(users);
        return { success: true } as any;
      }
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
  // Strip leading '#', 'no.', 'order#', 'order ', etc.
  s = s.replace(/^(?:order\s*#?|#|no\.?\s*)/i, '');
  // Strip trailing .0 or .00 from numeric cell exports
  s = s.replace(/\.0+$/, '');
  // Remove all whitespace
  return s.replace(/\s+/g, '');
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

    if (res && res.success && Array.isArray(res.items) && res.items.length > 0) {
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

export async function deleteOlderVideos(params: {
  days?: number;
  platform?: string;
  recordingType?: string;
  driveFolderId?: string;
  moveDriveVideosToTrash?: boolean;
  removeSheetEntries?: boolean;
}): Promise<DeleteOlderVideosResult> {
  const daysThreshold = params.days || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysThreshold);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  try {
    const res = await requestApi<DeleteOlderVideosResult>('deleteOlderVideos', {
      days: daysThreshold,
      platform: params.platform || '',
      recordingType: params.recordingType || '',
      driveFolderId: params.driveFolderId || getStoredDriveFolderId(),
      moveDriveVideosToTrash: params.moveDriveVideosToTrash !== false,
      removeSheetEntries: params.removeSheetEntries !== false,
    });

    if (res && res.success && ((res.deletedOrdersCount || 0) > 0 || (res.removedSheetRowsCount || 0) > 0 || (res.movedDriveVideosCount || 0) > 0)) {
      return {
        success: true,
        daysThreshold,
        cutoffDate: res.cutoffDate || cutoffStr,
        deletedOrdersCount: res.deletedOrdersCount || 0,
        removedSheetRowsCount: res.removedSheetRowsCount || 0,
        movedDriveVideosCount: res.movedDriveVideosCount || 0,
        freedSizeBytes: res.freedSizeBytes || 0,
        removedBySheet: res.removedBySheet || {},
        scannedTabs: res.scannedTabs || [],
        movedFiles: res.movedFiles || [],
        message: res.message,
      };
    }
  } catch (err: any) {
    console.warn('deleteOlderVideos direct endpoint call failed, executing fallback individual log deletions:', err);
  }

  // Fallback deletion: Scan older items and remove entries via deleteLogEntry
  let deletedOrdersCount = 0;
  let removedSheetRowsCount = 0;
  let movedDriveVideosCount = 0;

  try {
    const scanRes = await scanOlderVideos({
      days: daysThreshold,
      platform: params.platform,
      recordingType: params.recordingType,
    });

    if (scanRes.items && scanRes.items.length > 0) {
      for (const item of scanRes.items) {
        try {
          await requestApi('deleteLogEntry', {
            orderId: item.orderId,
            sheet: item.sheet,
            driveFileId: item.fileId,
          });
          deletedOrdersCount++;
          removedSheetRowsCount++;
          if (item.fileId) movedDriveVideosCount++;
        } catch (delErr) {
          console.warn(`Could not delete log entry for order ${item.orderId}:`, delErr);
        }
      }
    }
  } catch (fallbackErr) {
    console.warn('Fallback deletion process error:', fallbackErr);
  }

  return {
    success: true,
    daysThreshold,
    cutoffDate: cutoffStr,
    deletedOrdersCount,
    removedSheetRowsCount,
    movedDriveVideosCount,
    message: `Cleaned ${deletedOrdersCount} record(s) older than ${daysThreshold} days.`,
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
} | null> {
  try {
    const res = await requestApi<{
      logoUrl?: string;
      faviconUrl?: string;
      appName?: string;
      appSubtitle?: string;
      videoDriveFolderId?: string;
    }>('getBranding', {});
    if (res.success) {
      return {
        logoUrl: res.logoUrl || '',
        faviconUrl: res.faviconUrl || '',
        appName: res.appName || '',
        appSubtitle: res.appSubtitle || '',
        videoDriveFolderId: res.videoDriveFolderId || '',
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

