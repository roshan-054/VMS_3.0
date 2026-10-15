import {
  UploadLogItem,
  QueueItem,
  AnalyticsData,
  DailyMetricItem,
  OrderManifest,
  PackVerificationLog
} from '../types';
import { getStoredManifests, getStoredVerificationLogs } from './manifestStorage';
import { dbGetAllQueue } from './storage';
import { extractDriveFileId } from './branding';

function formatTime12h(isoDateStr?: string): string {
  if (!isoDateStr) return '';
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

function generateDates(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  if (!startStr || !endStr) return dates;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [startStr];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length > 0 ? dates : [startStr];
}

/**
 * Retrieve unified logs from local workstation storage (Queue, Manifests, and Cached Cloud Logs)
 */
export async function getLocalWorkstationLogs(params: {
  searchQuery?: string;
  platform?: string;
  recordingType?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}): Promise<UploadLogItem[]> {
  const logMap = new Map<string, UploadLogItem>();

  // 1. Load cached cloud logs
  try {
    const raw = localStorage.getItem('vms_cached_cloud_logs');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: UploadLogItem) => {
          const key = item.driveFileId || item.uploadId || `${item.orderId}_${item.timestamp}`;
          if (key) logMap.set(key, item);
        });
      }
    }
  } catch (_) {}

  // 2. Load IndexedDB local queue items
  try {
    const queue = await dbGetAllQueue();
    queue.forEach((q: QueueItem) => {
      let rawStatus = 'Pending';
      if (q.status === 'completed') rawStatus = 'Completed';
      else if (q.status === 'uploading') rawStatus = 'In Progress';
      else if (q.status === 'failed') rawStatus = 'Failed';

      const timeIso = q.createdAt ? new Date(q.createdAt).toISOString() : new Date().toISOString();
      const key = q.fileId || q.id || `${q.orderId}_${q.createdAt}`;
      logMap.set(key, {
        timestamp: timeIso,
        orderId: q.orderId || 'Unknown',
        platform: q.platform || 'Amazon',
        packerEmail: (q as any).packerEmail || 'operator@station.local',
        fileName: q.fileName || `${q.orderId || 'video'}.mp4`,
        fileSize: q.fileSize ? `${Math.round(q.fileSize / (1024 * 1024))} MB` : '—',
        uploadId: q.id,
        stage: q.status === 'completed' ? 'Completed (Drive)' : q.status === 'uploading' ? 'Uploading' : 'Waiting in Queue',
        progress: q.status === 'completed' ? 100 : q.progress || 0,
        driveFileId: q.fileId || '',
        status: rawStatus,
        recordingType: q.recordingType || 'Forward',
        source: 'local-queue',
        playbackUrl: q.webViewLink || (q.fileId ? `https://drive.google.com/file/d/${q.fileId}/preview` : undefined),
      });
    });
  } catch (_) {}

  // 3. Load from Order Manifests
  try {
    const manifests = getStoredManifests();
    manifests.forEach((m: OrderManifest) => {
      const isPacked = m.status === 'Packed' || Boolean(m.packedAt);
      const isProgress = m.status === 'In Progress';
      const statusStr = isPacked ? 'Completed' : isProgress ? 'In Progress' : 'Pending';
      const timestamp = m.packedAt || m.processedAt || new Date().toISOString();
      const driveId = m.videoDriveUrl ? extractDriveFileId(m.videoDriveUrl) || '' : '';
      const key = driveId || `manifest_${m.orderId}_${m.id}`;

      if (!logMap.has(key)) {
        logMap.set(key, {
          timestamp,
          orderId: m.orderId,
          platform: m.platform || 'Amazon',
          packerEmail: m.packedByEmail || m.assignedPackerEmail || m.processedByEmail || 'packer@ops.local',
          fileName: `${m.orderId}_${m.platform || 'Amazon'}_Forward.mp4`,
          fileSize: isPacked ? '18.5 MB' : '—',
          uploadId: `manifest-${m.id || m.orderId}`,
          stage: isPacked ? 'Completed (Drive)' : isProgress ? 'Packing & Verifying' : 'Assigned in Manifest',
          progress: isPacked ? 100 : isProgress ? 50 : 0,
          driveFileId: driveId,
          status: statusStr,
          recordingType: 'Forward',
          source: 'order-manifest',
          playbackUrl: m.videoDriveUrl || undefined,
        });
      }
    });
  } catch (_) {}

  // 4. Load from Pack Verification Logs
  try {
    const vLogs = getStoredVerificationLogs();
    vLogs.forEach((vl: PackVerificationLog) => {
      const key = `vlog_${vl.orderId}_${vl.timestamp}`;
      if (!logMap.has(key)) {
        logMap.set(key, {
          timestamp: vl.timestamp,
          orderId: vl.orderId,
          platform: vl.platform || 'Amazon',
          packerEmail: vl.packerEmail || 'packer@ops.local',
          fileName: `${vl.orderId}_${vl.platform || 'Amazon'}_Forward.mp4`,
          fileSize: '—',
          uploadId: `vlog-${(vl as any).id || vl.orderId}`,
          stage: 'Verified at Station',
          progress: 100,
          driveFileId: '',
          status: 'Completed',
          recordingType: 'Forward',
          source: 'pack-verification',
        });
      }
    });
  } catch (_) {}

  let list = Array.from(logMap.values());

  // Filter params
  if (params.searchQuery && params.searchQuery.trim()) {
    const q = params.searchQuery.trim().toLowerCase();
    list = list.filter(
      (it) =>
        it.orderId.toLowerCase().includes(q) ||
        it.platform.toLowerCase().includes(q) ||
        it.packerEmail.toLowerCase().includes(q) ||
        it.fileName.toLowerCase().includes(q)
    );
  }
  if (params.platform && params.platform !== 'all') {
    list = list.filter((it) => it.platform.toLowerCase() === params.platform!.toLowerCase());
  }
  if (params.recordingType && params.recordingType !== 'all') {
    list = list.filter((it) => it.recordingType.toLowerCase() === params.recordingType!.toLowerCase());
  }
  if (params.status && params.status !== 'all') {
    list = list.filter((it) => it.status.toLowerCase() === params.status!.toLowerCase());
  }
  if (params.fromDate) {
    list = list.filter((it) => it.timestamp.slice(0, 10) >= params.fromDate!);
  }
  if (params.toDate) {
    list = list.filter((it) => it.timestamp.slice(0, 10) <= params.toDate!);
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (params.limit && params.limit > 0) {
    list = list.slice(0, params.limit);
  }

  return list;
}

/**
 * Compute full AnalyticsData locally from local workstation store
 */
export async function computeLocalAnalyticsData(
  fromDate: string,
  toDate: string,
  platformFilter = 'all',
  typeFilter = 'all',
  packerFilter = ''
): Promise<AnalyticsData> {
  const logs = await getLocalWorkstationLogs({
    fromDate,
    toDate,
    platform: platformFilter === 'all' ? undefined : platformFilter,
    recordingType: typeFilter === 'all' ? undefined : typeFilter,
  });

  let filtered = logs;
  if (packerFilter && packerFilter.trim()) {
    const pf = packerFilter.trim().toLowerCase();
    filtered = filtered.filter((l) => l.packerEmail.toLowerCase().includes(pf));
  }

  const uniqueOrdersSet = new Set<string>();
  const platformCounts: Record<string, number> = {
    Amazon: 0,
    D2C: 0,
    JioMart: 0,
    Custom: 0,
  };
  const typeCounts: Record<string, number> = {
    Forward: 0,
    Return: 0,
  };
  const userCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {
    Completed: 0,
    'In Progress': 0,
    Pending: 0,
  };

  const dailyMap = new Map<
    string,
    {
      total: number;
      platforms: Record<string, number>;
      types: Record<string, number>;
      users: Record<string, number>;
      firstTimestamp?: string;
      lastTimestamp?: string;
      lastOrderId?: string;
      lastPlatform?: string;
      lastPacker?: string;
    }
  >();

  const dateList = generateDates(fromDate, toDate);
  dateList.forEach((d) => {
    dailyMap.set(d, {
      total: 0,
      platforms: { Amazon: 0, D2C: 0, JioMart: 0, Custom: 0 },
      types: { Forward: 0, Return: 0 },
      users: {},
    });
  });

  filtered.forEach((log) => {
    if (log.orderId) uniqueOrdersSet.add(log.orderId.trim().toUpperCase());

    // Platform
    const p = log.platform || 'Amazon';
    if (platformCounts[p] !== undefined) platformCounts[p]++;
    else platformCounts[p] = (platformCounts[p] || 0) + 1;

    // Type
    const t = log.recordingType === 'Return' ? 'Return' : 'Forward';
    typeCounts[t] = (typeCounts[t] || 0) + 1;

    // User
    const u = log.packerEmail || 'operator@station.local';
    userCounts[u] = (userCounts[u] || 0) + 1;

    // Status
    const s = log.status || 'Completed';
    statusCounts[s] = (statusCounts[s] || 0) + 1;

    // Daily breakdown
    const dateKey = log.timestamp.slice(0, 10);
    let day = dailyMap.get(dateKey);
    if (!day) {
      day = {
        total: 0,
        platforms: { Amazon: 0, D2C: 0, JioMart: 0, Custom: 0 },
        types: { Forward: 0, Return: 0 },
        users: {},
      };
      dailyMap.set(dateKey, day);
    }
    day.total++;
    day.platforms[p] = (day.platforms[p] || 0) + 1;
    day.types[t] = (day.types[t] || 0) + 1;
    day.users[u] = (day.users[u] || 0) + 1;

    if (!day.firstTimestamp || log.timestamp < day.firstTimestamp) {
      day.firstTimestamp = log.timestamp;
    }
    if (!day.lastTimestamp || log.timestamp > day.lastTimestamp) {
      day.lastTimestamp = log.timestamp;
      day.lastOrderId = log.orderId;
      day.lastPlatform = log.platform;
      day.lastPacker = log.packerEmail;
    }
  });

  const dailyItems: DailyMetricItem[] = Array.from(dailyMap.entries()).map(([d, val]) => {
    let operatingMinutes = 0;
    if (val.firstTimestamp && val.lastTimestamp && val.firstTimestamp !== val.lastTimestamp) {
      operatingMinutes = Math.max(
        1,
        Math.round((new Date(val.lastTimestamp).getTime() - new Date(val.firstTimestamp).getTime()) / 60000)
      );
    }
    return {
      date: d,
      total: val.total,
      platforms: val.platforms,
      types: val.types,
      users: val.users,
      firstRecordTime: val.firstTimestamp ? formatTime12h(val.firstTimestamp) : undefined,
      lastRecordTime: val.lastTimestamp ? formatTime12h(val.lastTimestamp) : undefined,
      firstTimestamp: val.firstTimestamp,
      lastTimestamp: val.lastTimestamp,
      operatingMinutes,
      lastOrderId: val.lastOrderId,
      lastPlatform: val.lastPlatform,
      lastPacker: val.lastPacker,
    };
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayItem = dailyItems.find((it) => it.date === todayStr);

  return {
    total: filtered.length,
    uniqueOrders: uniqueOrdersSet.size,
    duplicateScans: Math.max(0, filtered.length - uniqueOrdersSet.size),
    forwardCount: typeCounts.Forward || 0,
    returnCount: typeCounts.Return || 0,
    platforms: Object.entries(platformCounts).map(([label, count]) => ({ label, count })),
    types: Object.entries(typeCounts).map(([label, count]) => ({ label, count })),
    users: Object.entries(userCounts).map(([label, count]) => ({ label, count })),
    statuses: Object.entries(statusCounts).map(([label, count]) => ({ label, count })),
    daily: dailyItems,
    fromDate,
    toDate,
    latestRecordingTimeToday: todayItem?.lastRecordTime || undefined,
    avgDailyWrapUpTime: todayItem?.lastRecordTime || undefined,
  };
}
