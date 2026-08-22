import { getStoredApiUrl, getStoredToken, dbGetAllQueue } from './storage';
import { User, VideoRecord, AnalyticsData } from '../types';

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
    if (text.toLowerCase().includes('version') || text.toLowerCase().includes('less than the existing version')) {
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

  return data;
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

export async function fetchUploadLogs(params: {
  status?: string;
  orderId?: string;
  platform?: string;
  recordingType?: string;
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
}> {
  try {
    const res = await requestApi<{ logs: import('../types').UploadLogItem[]; stats?: any }>('getUploadLogs', params);
    return {
      success: true,
      logs: res.logs || [],
      stats: res.stats,
    };
  } catch (err) {
    try {
      const localItems = await dbGetAllQueue();
      const logs = localItems.map((item): import('../types').UploadLogItem => ({
        timestamp: new Date(item.createdAt).toISOString(),
        orderId: item.orderId,
        platform: item.platform,
        recordingType: item.recordingType,
        fileName: item.fileName,
        fileSize: String(item.fileSize),
        status: item.status === 'completed' ? 'Completed' : item.status === 'failed' ? 'Failed' : 'Under Processing',
        stage: item.stage || item.status,
        progress: item.progress ?? (item.status === 'completed' ? 100 : 0),
        packerEmail: 'operator@vms.local',
        driveFileId: item.fileId || '',
        playbackUrl: item.webViewLink,
        uploadId: item.uploadId || item.id,
        queueJobId: item.id,
      }));

      const completed = logs.filter(l => l.status === 'Completed').length;
      const inProgress = logs.filter(l => l.status === 'Under Processing').length;
      const failed = logs.filter(l => l.status === 'Failed').length;

      return {
        success: true,
        logs,
        stats: {
          total: logs.length,
          completed,
          inProgress,
          pending: 0,
          failed,
        },
      };
    } catch (dbErr) {
      return {
        success: true,
        logs: [],
        stats: { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0 },
      };
    }
  }
}

export async function deleteLogEntry(params: {
  orderId?: string;
  uploadId?: string;
  driveFileId?: string;
  queueJobId?: string;
  deleteFromDrive?: boolean;
}): Promise<{
  success: boolean;
  message?: string;
  orderLogsRemoved?: number;
  uploadLogsRemoved?: number;
  driveTrashed?: boolean;
  notSupportedByBackend?: boolean;
}> {
  try {
    const res = await requestApi<{
      orderLogsRemoved?: number;
      uploadLogsRemoved?: number;
      driveTrashed?: boolean;
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
