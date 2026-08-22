import { getStoredApiUrl, getStoredToken } from './storage';
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
    throw new Error(
      'Invalid Apps Script response. Please check that the Web App is deployed with "Anyone" access.'
    );
  }

  if (!data.success) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

export async function checkBackendHealth(customUrl?: string): Promise<{
  online: boolean;
  version?: string;
  service?: string;
  error?: string;
}> {
  try {
    const url = customUrl || getStoredApiUrl();
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
    return { online: false, error: err.message || 'Connection failed' };
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
  const res = await requestApi<{ logs: import('../types').UploadLogItem[]; stats?: any }>('getUploadLogs', params);
  return {
    success: true,
    logs: res.logs || [],
    stats: res.stats,
  };
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
