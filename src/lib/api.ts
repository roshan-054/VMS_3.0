import { getStoredApiUrl, getStoredToken, dbGetAllQueue } from './storage';
import { User, VideoRecord, AnalyticsData } from '../types';
import {
  localLogin,
  localSignup,
  getLocalUsers,
  syncLocalUserWithRemote,
  syncAllLocalUsers,
  saveLocalUsers,
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
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      credentials: 'omit',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body,
    });

    const text = await response.text();
    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text);
    } catch (err) {
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
  s = s.replace(/^[#_-\s]+/, '').replace(/[\s_-]+/g, '');
  return s;
}

export async function checkDuplicate(meta: {
  orderId: string;
  platform: string;
  recordingType: string;
}): Promise<VideoRecord | null> {
  const token = getStoredToken();

  try {
    const res = await requestApi<{ isDuplicate?: boolean; existing?: any; results?: VideoRecord[] }>('checkDuplicateOrder', {
      orderId: meta.orderId,
      platform: meta.platform,
      recordingType: meta.recordingType,
    });
    if (res.isDuplicate && res.existing) {
      return res.existing;
    }
    if (Array.isArray(res.results) && res.results.length > 0) {
      return res.results[0];
    }
    return null;
  } catch (err) {
    // Fallback to advancedSearch query
    try {
      const fallbackRes = await requestApi<{ results: VideoRecord[] }>('advancedSearch', {
        orderId: meta.orderId,
        platform: meta.platform,
        recordingType: meta.recordingType,
        limit: 1,
      });
      if (Array.isArray(fallbackRes.results) && fallbackRes.results.length > 0) {
        return fallbackRes.results[0];
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
}> {
  try {
    const res = await requestApi<{ logs: import('../types').UploadLogItem[]; stats?: any }>('getUploadLogs', params);
    return {
      success: true,
      logs: res.logs || [],
      stats: res.stats,
    };
  } catch (err: any) {
    console.warn('fetchUploadLogs remote request failed:', err?.message || err);
    return {
      success: false,
      logs: [],
      error: err?.message || 'Failed to fetch logs from Google Sheets',
    };
  }
}

export async function deleteLogEntry(params: {
  orderId?: string;
  uploadId?: string;
  driveFileId?: string;
  queueJobId?: string;
  timestamp?: string;
  recordingType?: string;
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

export function formatFileSize(bytes: number | string | undefined | null): string {
  if (bytes === undefined || bytes === null || bytes === '') return '—';

  if (typeof bytes === 'string') {
    const s = bytes.trim();
    if (!s || s === '—' || s === 'Unknown' || s === 'Standard HD' || s === 'Standard 1080p') return s || '—';
    if (s.endsWith('MB') || s.endsWith('KB') || s.endsWith('GB') || s.endsWith('B')) {
      return s;
    }
    const num = parseFloat(s);
    if (isNaN(num)) return s;
    bytes = num;
  }

  if (typeof bytes === 'number') {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 0.1) {
      return `${(bytes / 1024).toFixed(1)} KB`;
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
} | null> {
  try {
    const res = await requestApi<{
      logoUrl?: string;
      faviconUrl?: string;
      appName?: string;
      appSubtitle?: string;
    }>('getBranding', {});
    if (res.success) {
      return {
        logoUrl: res.logoUrl || '',
        faviconUrl: res.faviconUrl || '',
        appName: res.appName || '',
        appSubtitle: res.appSubtitle || '',
      };
    }
  } catch (err) {}
  return null;
}

export async function saveCloudBranding(config: {
  logoUrl: string;
  faviconUrl: string;
  appName: string;
  appSubtitle: string;
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
