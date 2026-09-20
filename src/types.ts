export type PlatformType = 'Amazon' | 'D2C' | 'JioMart' | 'Custom';
export type RecordingType = 'Forward' | 'Return';
export type UserRole = 'Master Admin' | 'Admin' | 'User';
export type UserStatus = 'Approved' | 'Pending' | 'Rejected' | 'Disabled';

export interface AdminPermissions {
  canDeleteData: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canManageBranding: boolean;
  canAccessSearch: boolean;
  canAccessReports: boolean;
  canAccessAnalytics: boolean;
  canAccessHealth: boolean;
}

export interface User {
  row?: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created?: string;
  permissions?: AdminPermissions;
}

export interface VideoRecord {
  timestamp: string;
  orderId: string;
  platform: string;
  recordingType: string;
  fileName: string;
  fileSize: string;
  driveLink?: string;
  webViewLink?: string;
  playbackUrl?: string;
  fileId?: string;
  packerEmail: string;
  status: string;
  source: string;
  sheet?: string;
  queueJobId?: string;
  uploadId?: string;
}

export interface QueueItem {
  id: string;
  createdAt: number;
  orderId: string;
  platform: string;
  recordingType: string;
  fileName: string;
  fileSize?: number;
  mimeType: string;
  source: string;
  blob?: Blob;
  isInMemory?: boolean;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'paused';
  progress: number;
  stage?: string;
  error?: string;
  uploadId?: string;
  chunkSize?: number;
  currentChunk?: number;
  totalChunks?: number;
  uploadedBytes?: number;
  driveFolderId?: string;
  recordingDate?: string;
  token?: string;
  webViewLink?: string;
  fileId?: string;
  isDuplicate?: boolean;
  duplicateReason?: string;
  bypassDuplicate?: boolean;
}

export interface UploadLogItem {
  timestamp: string;
  orderId: string;
  platform: string;
  packerEmail: string;
  fileName: string;
  fileSize: string;
  uploadId: string;
  stage: string;
  progress: string | number;
  driveFileId: string;
  status: string;
  error?: string;
  recordingType: string;
  source?: string;
  queueJobId?: string;
  playbackUrl?: string;
  downloadUrl?: string;
}

export interface DailyMetricItem {
  date: string;
  total: number;
  platforms: Record<string, number>;
  types: Record<string, number>;
  users: Record<string, number>;
  firstRecordTime?: string;
  lastRecordTime?: string; // Daily shift conclusion / till what time recording is done
  firstTimestamp?: string;
  lastTimestamp?: string;
  operatingMinutes?: number;
  lastOrderId?: string;
  lastPlatform?: string;
  lastPacker?: string;
}

export interface AnalyticsData {
  total: number;
  uniqueOrders: number;
  duplicateScans?: number;
  forwardCount?: number;
  returnCount?: number;
  platforms: { label: string; count: number }[];
  types: { label: string; count: number }[];
  users: { label: string; count: number }[];
  statuses: { label: string; count: number }[];
  daily: DailyMetricItem[];
  fromDate?: string;
  toDate?: string;
  latestRecordingTimeToday?: string;
  avgDailyWrapUpTime?: string;
}
