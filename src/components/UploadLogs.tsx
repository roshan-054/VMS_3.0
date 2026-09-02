import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileClock,
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Download,
  Copy,
  Check,
  Calendar,
  Layers,
  HardDrive,
  FileSpreadsheet,
  ArrowUpDown,
  FileVideo,
  User as UserIcon,
  Shield,
  Play,
  RotateCw,
  Info,
  ChevronDown,
  ChevronRight,
  Database,
  Trash2,
  Maximize2,
  Film,
  X,
  Radio,
  Share2
} from 'lucide-react';
import { User, UploadLogItem, QueueItem, PlatformType, RecordingType } from '../types';
import { fetchUploadLogs, deleteLogEntry, formatFileSize } from '../lib/api';
import { dbGetAllQueue, dbPutQueue, dbDeleteQueueItem, getStoredDriveFolderId } from '../lib/storage';
import { canUserDeleteData } from '../lib/permissions';
import { retryUploadItem, fixAndCleanAllStuckUploads } from '../lib/uploadWorker';

interface UploadLogsProps {
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onNavigateToQueue?: () => void;
  currentUser: User | null;
}

type StatusFilter = 'all' | 'completed' | 'processing' | 'pending' | 'failed';
type LogSourceView = 'cloud' | 'local' | 'unified';

// Storage key for deleted log IDs to prevent re-appearing before Google Sheets propagates
const DELETED_LOGS_STORAGE_KEY = 'vms_deleted_log_ids_v1';

function getStoredDeletedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_LOGS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    // Only accept genuine unique specific IDs (e.g. Drive IDs, UUIDs with length >= 15), never order IDs
    const valid = (Array.isArray(arr) ? arr : []).filter((k: string) => typeof k === 'string' && k.trim().length >= 15);
    return new Set(valid);
  } catch (e) {
    return new Set();
  }
}

function saveDeletedKey(keys: string[]) {
  try {
    const current = getStoredDeletedKeys();
    keys.forEach((k) => {
      // Strictly prevent saving generic short order IDs into deleted key set
      if (k && typeof k === 'string' && k.trim().length >= 15) {
        current.add(k.trim().toLowerCase());
      }
    });
    // Keep max 500 keys to avoid unlimited storage growth
    const arr = Array.from(current).slice(-500);
    localStorage.setItem(DELETED_LOGS_STORAGE_KEY, JSON.stringify(arr));
  } catch (e) {}
}

// Robust helper to extract YYYY-MM-DD from any timestamp representation (ISO string, Date object, or localized string)
function extractDateStr(ts: string | Date | undefined | null): string {
  if (!ts) return '';
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}

  // Fallback string matching for YYYY-MM-DD or DD/MM/YYYY
  const s = String(ts).trim();
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const slashMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
  }
  return '';
}

// Get today's local date string in YYYY-MM-DD
function getLocalDateString(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const UploadLogs: React.FC<UploadLogsProps> = ({ onShowToast, onNavigateToQueue, currentUser }) => {
  const [cloudLogs, setCloudLogs] = useState<UploadLogItem[]>([]);
  const [localQueue, setLocalQueue] = useState<QueueItem[]>([]);
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(() => getStoredDeletedKeys());
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedLog, setSelectedLog] = useState<UploadLogItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Playback Modal State
  const [playbackLog, setPlaybackLog] = useState<UploadLogItem | null>(null);
  const [playerMode, setPlayerMode] = useState<'drive-embed' | 'direct-stream'>('drive-embed');
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);

  // Deletion Confirmation Modal State
  const [logToDelete, setLogToDelete] = useState<UploadLogItem | null>(null);
  const [deleteDriveFileOption, setDeleteDriveFileOption] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filters State
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sourceView, setSourceView] = useState<LogSourceView>('unified');
  const [fromDate, setFromDate] = useState<string>(getLocalDateString(0));
  const [toDate, setToDate] = useState<string>(getLocalDateString(0));
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortField, setSortField] = useState<'timestamp' | 'orderId' | 'progress'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const refreshTimerRef = useRef<any>(null);

  const [isSearchingCloud, setIsSearchingCloud] = useState(false);

  const loadData = async (showLoadingSpinner = false, customQuery?: string) => {
    if (showLoadingSpinner) setIsLoading(true);

    try {
      // 1. Fetch Local Queue items
      const localItems = await dbGetAllQueue();
      setLocalQueue(localItems);

      const queryToUse = customQuery !== undefined ? customQuery : searchQuery;
      const isSearchActive = !!queryToUse.trim();

      // 2. Fetch Cloud Logs from Google Sheet
      // If user is actively searching an Order ID, query with limit 5000 so all historical records are retrieved!
      // Otherwise default to 500 for lightning fast startup.
      const res = await fetchUploadLogs({
        limit: isSearchActive ? 5000 : 500,
        searchQuery: queryToUse.trim() || undefined,
      });

      if (res.success && res.logs) {
        // Filter out any logs that have been deleted locally
        const currentDeleted = getStoredDeletedKeys();
        const cleanedLogs = res.logs.filter((log) => {
          const up = String(log.uploadId || '').trim().toLowerCase();
          const drv = String(log.driveFileId || '').trim().toLowerCase();
          const qj = String(log.queueJobId || '').trim().toLowerCase();
          if (up && currentDeleted.has(up)) return false;
          if (drv && currentDeleted.has(drv)) return false;
          if (qj && currentDeleted.has(qj)) return false;
          return true;
        });
        setCloudLogs(cleanedLogs);
      }
    } catch (err: any) {
      console.warn('Failed to load upload logs:', err);
    } finally {
      if (showLoadingSpinner) setIsLoading(false);
      setIsSearchingCloud(false);
    }
  };

  // Debounced deep search when user enters an Order ID or search term
  useEffect(() => {
    if (!searchQuery.trim()) {
      // If search query is cleared, revert to default 500 logs view
      loadData(false, '');
      return;
    }

    setIsSearchingCloud(true);
    const timer = setTimeout(() => {
      loadData(false, searchQuery);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadData(true);
  }, []);

  // Handle auto-refresh interval
  useEffect(() => {
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => {
        // Only run auto-refresh when not actively typing/searching
        if (!searchQuery.trim()) {
          loadData(false, '');
        }
      }, 10000);
    } else {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [autoRefresh, searchQuery]);

  const [isCleaningStuck, setIsCleaningStuck] = useState(false);
  const [isPurgingInterrupted, setIsPurgingInterrupted] = useState(false);

  const handleCleanStuckUploads = async () => {
    setIsCleaningStuck(true);
    try {
      const result = await fixAndCleanAllStuckUploads();
      onShowToast(`🧹 ${result.message || 'Cleaned up stuck upload sessions.'}`, 'success');
      await loadData(true);
    } catch (e: any) {
      onShowToast(`Failed to clean stuck uploads: ${e?.message || e}`, 'error');
    } finally {
      setIsCleaningStuck(false);
    }
  };

  const handlePurgeInterrupted = async () => {
    if (!window.confirm('Are you sure you want to permanently remove all interrupted/failed upload session rows from Google Sheet? This will clear stale interrupted rows from the table.')) {
      return;
    }
    setIsPurgingInterrupted(true);
    try {
      const result = await fixAndCleanAllStuckUploads({ purgeInterrupted: true });
      onShowToast(`🧹 ${result.message || 'Purged interrupted upload records.'}`, 'success');
      await loadData(true);
    } catch (e: any) {
      onShowToast(`Failed to purge interrupted records: ${e?.message || e}`, 'error');
    } finally {
      setIsPurgingInterrupted(false);
    }
  };

  const copyToClipboard = (text: string, label: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    onShowToast(`Copied ${label} to clipboard`, 'info');
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  // Keyboard shortcut listener for Esc key to close open modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (playbackLog) handleClosePlayback();
        if (logToDelete) setLogToDelete(null);
        if (selectedLog) setSelectedLog(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playbackLog, logToDelete, selectedLog]);

  const handleOpenPlayback = (log: UploadLogItem) => {
    // Check if there is a local blob in the local queue
    const localMatch = localQueue.find(
      (q) => (log.queueJobId && q.id === log.queueJobId) || (log.orderId && q.orderId === log.orderId)
    );
    if (localMatch && localMatch.blob) {
      try {
        const url = URL.createObjectURL(localMatch.blob);
        setLocalBlobUrl(url);
      } catch(e) {
        setLocalBlobUrl(null);
      }
    } else {
      setLocalBlobUrl(null);
    }

    setPlaybackLog(log);
    setPlayerMode('drive-embed');
  };

  const handleOpenDeleteModal = (log: UploadLogItem) => {
    let drvId = log.driveFileId || '';
    if (!drvId && log.playbackUrl) {
      const match = log.playbackUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || log.playbackUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) drvId = match[1];
    }
    if (!drvId && log.downloadUrl) {
      const match = log.downloadUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) drvId = match[1];
    }
    if (!drvId) {
      const localMatch = localQueue.find(
        (q) => (log.queueJobId && q.id === log.queueJobId) || (log.orderId && q.orderId === log.orderId)
      );
      if (localMatch && localMatch.fileId) drvId = localMatch.fileId;
    }

    setLogToDelete({
      ...log,
      driveFileId: drvId,
    });
    // Default to true so removing data removes from both Google Sheets AND Google Drive
    setDeleteDriveFileOption(true);
  };

  const handleClosePlayback = () => {
    if (localBlobUrl) {
      try {
        URL.revokeObjectURL(localBlobUrl);
      } catch(e){}
      setLocalBlobUrl(null);
    }
    setPlaybackLog(null);
  };

  const handleConfirmDelete = async () => {
    if (!logToDelete) return;
    setIsDeleting(true);

    const targetOrderId = logToDelete.orderId;
    const targetUploadId = logToDelete.uploadId;
    let targetDriveId = logToDelete.driveFileId;
    const targetQueueId = logToDelete.queueJobId;

    if (!targetDriveId && logToDelete.playbackUrl) {
      const match = logToDelete.playbackUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || logToDelete.playbackUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) targetDriveId = match[1];
    }

    try {
      // 1. Remove matching item from local IndexedDB queue
      if (targetQueueId) {
        await dbDeleteQueueItem(targetQueueId).catch(() => {});
      }
      const localMatches = localQueue.filter(
        (q) =>
          (targetDriveId && q.fileId === targetDriveId) ||
          (targetUploadId && (q.uploadId === targetUploadId || q.id === targetUploadId)) ||
          (targetQueueId && q.id === targetQueueId) ||
          (!targetDriveId && !targetUploadId && !targetQueueId && targetOrderId && q.orderId === targetOrderId)
      );
      for (const m of localMatches) {
        await dbDeleteQueueItem(m.id).catch(() => {});
      }

      // 2. Persist deleted specific unique IDs (do NOT store generic orderId so other duplicates remain intact)
      const specificKey = targetDriveId || targetUploadId || targetQueueId;
      if (specificKey && specificKey.length >= 15) {
        saveDeletedKey([specificKey]);
        setDeletedKeys(getStoredDeletedKeys());
      }

      // 3. Optimistically update local states immediately for ONLY the target item
      setCloudLogs((prev) =>
        prev.filter((l) => {
          if (targetDriveId && (l.driveFileId === targetDriveId || (l.playbackUrl && l.playbackUrl.includes(targetDriveId)))) return false;
          if (targetUploadId && l.uploadId === targetUploadId) return false;
          if (targetQueueId && l.queueJobId === targetQueueId) return false;
          if (!targetDriveId && !targetUploadId && !targetQueueId && targetOrderId && l.orderId === targetOrderId) {
            if (logToDelete.timestamp && l.timestamp && l.timestamp !== logToDelete.timestamp) return true;
            return false;
          }
          return true;
        })
      );
      setLocalQueue((prev) =>
        prev.filter((q) => {
          if (targetDriveId && q.fileId === targetDriveId) return false;
          if (targetUploadId && (q.uploadId === targetUploadId || q.id === targetUploadId)) return false;
          if (targetQueueId && q.id === targetQueueId) return false;
          if (!targetDriveId && !targetUploadId && !targetQueueId && targetOrderId && q.orderId === targetOrderId) return false;
          return true;
        })
      );

      // Close modals if active for this specific log
      if (playbackLog && (
        (targetDriveId && playbackLog.driveFileId === targetDriveId) ||
        (targetUploadId && playbackLog.uploadId === targetUploadId) ||
        (targetQueueId && playbackLog.queueJobId === targetQueueId) ||
        (!targetDriveId && !targetUploadId && !targetQueueId && playbackLog.orderId === targetOrderId)
      )) {
        handleClosePlayback();
      }
      if (selectedLog && (
        (targetDriveId && selectedLog.driveFileId === targetDriveId) ||
        (targetUploadId && selectedLog.uploadId === targetUploadId) ||
        (targetQueueId && selectedLog.queueJobId === targetQueueId) ||
        (!targetDriveId && !targetUploadId && !targetQueueId && selectedLog.orderId === targetOrderId)
      )) {
        setSelectedLog(null);
      }

      // 4. Call Backend API to delete entry from Google Sheet OrderLog, ReturnLog, UploadLog, DownloadLog, and Google Drive
      let backendRes: any = null;
      try {
        backendRes = await deleteLogEntry({
          orderId: targetOrderId,
          uploadId: targetUploadId,
          driveFileId: targetDriveId,
          queueJobId: targetQueueId,
          timestamp: logToDelete.timestamp,
          recordingType: logToDelete.recordingType,
          deleteFromDrive: deleteDriveFileOption,
        });
      } catch (apiErr: any) {
        console.warn('Backend delete note:', apiErr);
      }

      if (backendRes && backendRes.success) {
        const driveNote = backendRes.driveTrashed || backendRes.driveTrashedCount > 0 ? ' and video moved to Drive Trash' : '';
        onShowToast(
          backendRes.message || `Deleted Order ${targetOrderId || 'item'} from Google Sheet logs${driveNote}.`,
          'success'
        );
      } else if (backendRes && backendRes.notSupportedByBackend) {
        onShowToast(
          `Removed Order ${targetOrderId || 'item'} from local log view. (To clear rows from Google Sheet & Drive, please update Apps Script deployment with latest Code.gs)`,
          'info'
        );
      } else {
        onShowToast(`Removed Order ${targetOrderId || 'item'} from log view.`, 'success');
      }

      setLogToDelete(null);
      setDeleteDriveFileOption(true);
      // Reload in background
      await loadData(false);
    } catch (err: any) {
      console.error('Delete log failed:', err);
      onShowToast(err.message || 'Removed from local view.', 'info');
      setLogToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Convert local queue items into UploadLogItem format for unified view
  const localAsLogs = useMemo<UploadLogItem[]>(() => {
    return localQueue.map((item) => {
      let rawStatus = 'Pending';
      if (item.status === 'completed') rawStatus = 'Completed';
      else if (item.status === 'uploading') rawStatus = 'In Progress';
      else if (item.status === 'failed') rawStatus = 'Failed';
      else if (item.status === 'paused') rawStatus = 'Paused';

      return {
        timestamp: new Date(item.createdAt).toISOString(),
        orderId: item.orderId,
        platform: item.platform,
        packerEmail: 'Local Station Packer',
        fileName: item.fileName,
        fileSize: formatFileSize(item.fileSize || item.blob?.size),
        uploadId: item.uploadId || item.id,
        stage: item.stage || (item.status === 'completed' ? 'Uploaded to Google Drive' : 'Queued in Station Storage'),
        progress: item.progress || 0,
        driveFileId: item.fileId || '',
        status: rawStatus,
        error: item.error,
        recordingType: item.recordingType,
        source: item.source || 'Station Queue',
        queueJobId: item.id,
        playbackUrl: item.webViewLink || (item.fileId ? `https://drive.google.com/file/d/${item.fileId}/preview` : ''),
        downloadUrl: item.fileId ? `https://drive.google.com/uc?export=download&id=${item.fileId}` : ''
      };
    });
  }, [localQueue]);

  // Combine or select logs based on sourceView
  const mergedLogs = useMemo<UploadLogItem[]>(() => {
    if (sourceView === 'cloud') {
      return cloudLogs;
    }
    if (sourceView === 'local') {
      return localAsLogs;
    }

    // Unified: Combine cloud logs with active local logs that aren't logged in cloud yet
    const cloudUploadIds = new Set(cloudLogs.map((l) => String(l.uploadId || '').trim().toLowerCase()).filter(Boolean));
    const cloudDriveIds = new Set(cloudLogs.map((l) => String(l.driveFileId || '').trim().toLowerCase()).filter(Boolean));
    const cloudJobIds = new Set(cloudLogs.map((l) => String(l.queueJobId || '').trim().toLowerCase()).filter(Boolean));

    const uniqueLocal = localAsLogs.filter((loc) => {
      const up = String(loc.uploadId || '').trim().toLowerCase();
      const drv = String(loc.driveFileId || '').trim().toLowerCase();
      const qj = String(loc.queueJobId || '').trim().toLowerCase();

      if (up && cloudUploadIds.has(up)) return false;
      if (drv && cloudDriveIds.has(drv)) return false;
      if (qj && cloudJobIds.has(qj)) return false;

      // If local queue item is marked Completed, but not present in cloud logs (e.g. deleted from cloud/sheet), don't resurrect it
      if (loc.status === 'Completed') return false;

      return true;
    });

    return [...uniqueLocal, ...cloudLogs];
  }, [sourceView, cloudLogs, localAsLogs]);

  // Compute Overall Stats from merged logs
  const stats = useMemo(() => {
    let total = mergedLogs.length;
    let completed = 0;
    let processing = 0;
    let pending = 0;
    let failed = 0;

    for (const log of mergedLogs) {
      const st = String(log.status || '').toLowerCase();
      if (st === 'completed') {
        completed++;
      } else if (st === 'in progress' || st === 'uploading' || st === 'processing') {
        processing++;
      } else if (st === 'pending' || st === 'queued' || st === 'initiated') {
        pending++;
      } else if (st === 'failed' || st === 'paused' || st === 'error') {
        failed++;
      } else {
        pending++;
      }
    }

    const successRate = total > 0 ? Math.round((completed / total) * 100) : 100;

    return { total, completed, processing, pending, failed, successRate };
  }, [mergedLogs]);

  // Filter & Search Logs
  const filteredLogs = useMemo(() => {
    return mergedLogs.filter((log) => {
      const st = String(log.status || '').toLowerCase();

      // 1. Status Filter
      if (statusFilter === 'completed' && st !== 'completed') return false;
      if (statusFilter === 'processing' && st !== 'in progress' && st !== 'uploading' && st !== 'processing') return false;
      if (statusFilter === 'pending' && st !== 'pending' && st !== 'queued' && st !== 'initiated') return false;
      if (statusFilter === 'failed' && st !== 'failed' && st !== 'paused' && st !== 'error') return false;

      // 2. Platform Filter
      if (platformFilter !== 'all' && String(log.platform || '').toLowerCase() !== platformFilter.toLowerCase()) {
        return false;
      }

      // 3. Type Filter
      if (typeFilter !== 'all' && String(log.recordingType || '').toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }

      // 4. Date Range Filter (Bypassed if user is typing an Order ID/search query)
      if (!searchQuery.trim() && (fromDate || toDate)) {
        const logDateStr = extractDateStr(log.timestamp);
        if (logDateStr) {
          if (fromDate && logDateStr < fromDate) return false;
          if (toDate && logDateStr > toDate) return false;
        }
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesOrder = String(log.orderId || '').toLowerCase().includes(q);
        const matchesFile = String(log.fileName || '').toLowerCase().includes(q);
        const matchesPacker = String(log.packerEmail || '').toLowerCase().includes(q);
        const matchesUploadId = String(log.uploadId || '').toLowerCase().includes(q);
        const matchesStage = String(log.stage || '').toLowerCase().includes(q);
        if (!matchesOrder && !matchesFile && !matchesPacker && !matchesUploadId && !matchesStage) {
          return false;
        }
      }

      return true;
    });
  }, [mergedLogs, statusFilter, platformFilter, typeFilter, fromDate, toDate, searchQuery]);

  // Sort Logs
  const sortedLogs = useMemo(() => {
    const list = [...filteredLogs];
    list.sort((a, b) => {
      if (sortField === 'timestamp') {
        const timeA = new Date(a.timestamp).getTime() || 0;
        const timeB = new Date(b.timestamp).getTime() || 0;
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      }
      if (sortField === 'orderId') {
        return sortOrder === 'desc'
          ? b.orderId.localeCompare(a.orderId, undefined, { numeric: true })
          : a.orderId.localeCompare(b.orderId, undefined, { numeric: true });
      }
      if (sortField === 'progress') {
        const progA = Number(a.progress) || 0;
        const progB = Number(b.progress) || 0;
        return sortOrder === 'desc' ? progB - progA : progA - progB;
      }
      return 0;
    });
    return list;
  }, [filteredLogs, sortField, sortOrder]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / pageSize));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedLogs.slice(start, start + pageSize);
  }, [sortedLogs, currentPage, pageSize]);

  // Quick Date presets
  const applyDatePreset = (preset: 'today' | 'yesterday' | '7days' | 'all') => {
    const todayStr = getLocalDateString(0);

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const yStr = getLocalDateString(-1);
      setFromDate(yStr);
      setToDate(yStr);
    } else if (preset === '7days') {
      const pastStr = getLocalDateString(-7);
      setFromDate(pastStr);
      setToDate(todayStr);
    } else {
      setFromDate('');
      setToDate('');
    }
    setCurrentPage(1);
  };

  // Export to CSV
  const handleExportCsv = () => {
    if (sortedLogs.length === 0) {
      onShowToast('No logs matching current filters to export.', 'info');
      return;
    }

    const headers = [
      'Timestamp',
      'Order ID',
      'Platform',
      'Recording Type',
      'Status',
      'Progress %',
      'Stage / Activity',
      'File Name',
      'File Size',
      'Packer Email',
      'Drive File ID',
      'Playback URL',
      'Upload ID',
      'Error',
      'Source'
    ];

    const rows = sortedLogs.map((l) => [
      l.timestamp,
      `"${l.orderId.replace(/"/g, '""')}"`,
      l.platform,
      l.recordingType,
      l.status,
      l.progress,
      `"${(l.stage || '').replace(/"/g, '""')}"`,
      `"${l.fileName.replace(/"/g, '""')}"`,
      formatFileSize(l.fileSize),
      l.packerEmail,
      l.driveFileId,
      l.playbackUrl || (l.driveFileId ? `https://drive.google.com/file/d/${l.driveFileId}/preview` : ''),
      l.uploadId,
      `"${(l.error || '').replace(/"/g, '""')}"`,
      l.source || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `VMS_Upload_Logs_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onShowToast(`Exported ${sortedLogs.length} upload log records to CSV`, 'success');
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (e) {
      return ts;
    }
  };

  const getStatusBadge = (status: string, progress: string | number) => {
    const st = String(status || '').toLowerCase();
    const pct = Math.round(Number(progress) || 0);

    if (st === 'completed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          Completed
        </span>
      );
    }
    if (st === 'in progress' || st === 'uploading' || st === 'processing') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          Processing ({pct}%)
        </span>
      );
    }
    if (st === 'pending' || st === 'queued' || st === 'initiated') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          Pending
        </span>
      );
    }
    if (st === 'failed' || st === 'paused' || st === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          {st === 'paused' ? 'Paused' : 'Failed'}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
        {status}
      </span>
    );
  };

  const getPlatformBadge = (platform: string) => {
    switch (platform) {
      case 'Amazon':
        return <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold px-2 py-0.5 rounded-md">Amazon</span>;
      case 'D2C':
        return <span className="bg-purple-100 text-purple-900 border border-purple-300 text-[11px] font-bold px-2 py-0.5 rounded-md">D2C</span>;
      case 'JioMart':
        return <span className="bg-blue-100 text-blue-900 border border-blue-300 text-[11px] font-bold px-2 py-0.5 rounded-md">JioMart</span>;
      default:
        return <span className="bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold px-2 py-0.5 rounded-md">{platform || 'Custom'}</span>;
    }
  };

  const getTypeBadge = (type: string) => {
    if (type === 'Return') {
      return <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold px-2 py-0.5 rounded">Return</span>;
    }
    return <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold px-2 py-0.5 rounded">Forward</span>;
  };

  return (
    <div id="upload-logs-container" className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <FileClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Upload Logs & Activity History
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit trail and status tracking for all video uploads, chunk streams, pending jobs, and cloud syncs.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToQueue && (
            <button
              id="goto-queue-btn"
              onClick={onNavigateToQueue}
              className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-blue-600" />
              Manage Active Queue & Bulk Upload
            </button>
          )}

          <button
            id="export-logs-csv-btn"
            onClick={handleExportCsv}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Download filtered log table as CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            Export CSV
          </button>

          <button
            id="fix-stuck-logs-btn"
            onClick={handleCleanStuckUploads}
            disabled={isCleaningStuck || isPurgingInterrupted}
            className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Clean up zombie in-progress upload sessions and reset upload locks"
          >
            <RotateCw className={`w-3.5 h-3.5 text-amber-700 ${isCleaningStuck ? 'animate-spin' : ''}`} />
            {isCleaningStuck ? 'Cleaning…' : 'Fix Stuck Uploads'}
          </button>

          {stats.failed > 0 && (
            <button
              id="purge-interrupted-btn"
              onClick={handlePurgeInterrupted}
              disabled={isPurgingInterrupted || isCleaningStuck}
              className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-800 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Permanently remove all interrupted / stale log entries from Google Sheet"
            >
              <Trash2 className={`w-3.5 h-3.5 text-rose-600 ${isPurgingInterrupted ? 'animate-spin' : ''}`} />
              {isPurgingInterrupted ? 'Purging…' : `Purge Interrupted (${stats.failed})`}
            </button>
          )}

          <button
            id="refresh-logs-btn"
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Refreshing…' : 'Refresh Logs'}
          </button>

          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-medium text-slate-600 cursor-pointer select-none transition">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <span>Auto-refresh (6s)</span>
          </label>
        </div>
      </div>

      {/* Summary KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Total Logs */}
        <button
          onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
          className={`p-3.5 rounded-2xl border text-left transition relative overflow-hidden cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/20'
              : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${statusFilter === 'all' ? 'text-slate-300' : 'text-slate-500'}`}>
              Total Logs
            </span>
            <Layers className={`w-4 h-4 ${statusFilter === 'all' ? 'text-slate-300' : 'text-slate-400'}`} />
          </div>
          <div className="text-2xl font-bold mt-1 tracking-tight">{stats.total}</div>
          <div className={`text-[11px] mt-1 ${statusFilter === 'all' ? 'text-slate-300' : 'text-slate-500'}`}>
            All recorded sessions
          </div>
        </button>

        {/* Completed */}
        <button
          onClick={() => { setStatusFilter('completed'); setCurrentPage(1); }}
          className={`p-3.5 rounded-2xl border text-left transition relative overflow-hidden cursor-pointer ${
            statusFilter === 'completed'
              ? 'bg-emerald-700 text-white border-emerald-700 shadow-md ring-2 ring-emerald-600/30'
              : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${statusFilter === 'completed' ? 'text-emerald-100' : 'text-emerald-600'}`}>
              Completed
            </span>
            <CheckCircle2 className={`w-4 h-4 ${statusFilter === 'completed' ? 'text-emerald-200' : 'text-emerald-600'}`} />
          </div>
          <div className="text-2xl font-bold mt-1 tracking-tight text-emerald-950 dark:text-white">{stats.completed}</div>
          <div className={`text-[11px] mt-1 font-medium ${statusFilter === 'completed' ? 'text-emerald-100' : 'text-emerald-600'}`}>
            {stats.successRate}% in Google Drive
          </div>
        </button>

        {/* Under Processing */}
        <button
          onClick={() => { setStatusFilter('processing'); setCurrentPage(1); }}
          className={`p-3.5 rounded-2xl border text-left transition relative overflow-hidden cursor-pointer ${
            statusFilter === 'processing'
              ? 'bg-blue-700 text-white border-blue-700 shadow-md ring-2 ring-blue-600/30'
              : 'bg-white text-slate-800 border-slate-200 hover:border-blue-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${statusFilter === 'processing' ? 'text-blue-100' : 'text-blue-600'}`}>
              Under Processing
            </span>
            <Loader2 className={`w-4 h-4 ${statusFilter === 'processing' ? 'text-blue-200' : 'text-blue-600'} ${stats.processing > 0 ? 'animate-spin' : ''}`} />
          </div>
          <div className="text-2xl font-bold mt-1 tracking-tight text-blue-950 dark:text-white">{stats.processing}</div>
          <div className={`text-[11px] mt-1 font-medium ${statusFilter === 'processing' ? 'text-blue-100' : 'text-blue-600'}`}>
            Active chunk streams
          </div>
        </button>

        {/* Pending */}
        <button
          onClick={() => { setStatusFilter('pending'); setCurrentPage(1); }}
          className={`p-3.5 rounded-2xl border text-left transition relative overflow-hidden cursor-pointer ${
            statusFilter === 'pending'
              ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-500/30'
              : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${statusFilter === 'pending' ? 'text-amber-100' : 'text-amber-600'}`}>
              Pending
            </span>
            <Clock className={`w-4 h-4 ${statusFilter === 'pending' ? 'text-amber-200' : 'text-amber-600'}`} />
          </div>
          <div className="text-2xl font-bold mt-1 tracking-tight text-amber-950 dark:text-white">{stats.pending}</div>
          <div className={`text-[11px] mt-1 font-medium ${statusFilter === 'pending' ? 'text-amber-100' : 'text-amber-600'}`}>
            Waiting in queue
          </div>
        </button>

        {/* Failed / Paused */}
        <button
          onClick={() => { setStatusFilter('failed'); setCurrentPage(1); }}
          className={`p-3.5 rounded-2xl border text-left transition relative overflow-hidden cursor-pointer col-span-2 sm:col-span-1 ${
            statusFilter === 'failed'
              ? 'bg-rose-700 text-white border-rose-700 shadow-md ring-2 ring-rose-600/30'
              : 'bg-white text-slate-800 border-slate-200 hover:border-rose-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${statusFilter === 'failed' ? 'text-rose-100' : 'text-rose-600'}`}>
              Failed / Paused
            </span>
            <AlertTriangle className={`w-4 h-4 ${statusFilter === 'failed' ? 'text-rose-200' : 'text-rose-600'}`} />
          </div>
          <div className="text-2xl font-bold mt-1 tracking-tight text-rose-950 dark:text-white">{stats.failed}</div>
          <div className={`text-[11px] mt-1 font-medium ${statusFilter === 'failed' ? 'text-rose-100' : 'text-rose-600'}`}>
            Ready to retry
          </div>
        </button>
      </div>

      {/* Interrupted / Stale Logs Cleanup Alert Banner */}
      {stats.failed > 0 && (
        <div className="bg-rose-50/80 border border-rose-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 text-rose-900 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-100 rounded-xl text-rose-600 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-rose-950">
                {stats.failed} interrupted upload session(s) in Google Sheet logs
              </h4>
              <p className="text-[11px] text-rose-700 mt-0.5">
                These records represent previous unfinalized chunks or stopped uploads. You can purge them from the log table or filter them to inspect details.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePurgeInterrupted}
              disabled={isPurgingInterrupted}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Trash2 className={`w-3.5 h-3.5 ${isPurgingInterrupted ? 'animate-spin' : ''}`} />
              {isPurgingInterrupted ? 'Purging…' : `Purge All Interrupted (${stats.failed})`}
            </button>
            <button
              onClick={() => { setStatusFilter('failed'); setCurrentPage(1); }}
              className="px-3 py-1.5 bg-white hover:bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-medium transition cursor-pointer"
            >
              View Interrupted Only
            </button>
          </div>
        </div>
      )}

      {/* Filter Control Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5">
        {/* Status Pills / Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pb-3 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500 mr-2 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" /> Filter Status:
          </span>

          <button
            onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-900 text-white shadow-2xs font-semibold'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Logs ({stats.total})
          </button>

          <button
            onClick={() => { setStatusFilter('completed'); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'completed'
                ? 'bg-emerald-600 text-white shadow-2xs font-semibold'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed ({stats.completed})
          </button>

          <button
            onClick={() => { setStatusFilter('processing'); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'processing'
                ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
            }`}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Under Processing ({stats.processing})
          </button>

          <button
            onClick={() => { setStatusFilter('pending'); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-600 text-white shadow-2xs font-semibold'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Pending ({stats.pending})
          </button>

          <button
            onClick={() => { setStatusFilter('failed'); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition inline-flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'failed'
                ? 'bg-rose-600 text-white shadow-2xs font-semibold'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Failed / Paused ({stats.failed})
          </button>
        </div>

        {/* Search and Dropdown Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="lg:col-span-4 relative">
            {isSearchingCloud ? (
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin absolute left-3 top-1/2 -translate-y-1/2" />
            ) : (
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            )}
            <input
              type="text"
              placeholder="Search any Order ID across all historical records…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Platform Filter */}
          <div className="lg:col-span-2">
            <select
              value={platformFilter}
              onChange={(e) => { setPlatformFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
            >
              <option value="all">All Platforms</option>
              <option value="Amazon">Amazon</option>
              <option value="D2C">D2C</option>
              <option value="JioMart">JioMart</option>
              <option value="Custom">Custom</option>
            </select>
          </div>

          {/* Recording Type Filter */}
          <div className="lg:col-span-2">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-700"
            >
              <option value="all">All Types</option>
              <option value="Forward">Forward (Outbound)</option>
              <option value="Return">Return (Inbound)</option>
            </select>
          </div>

          {/* Date Range Inputs */}
          <div className="lg:col-span-4 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setCurrentPage(1); }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                placeholder="From Date"
              />
            </div>
            <span className="text-slate-400 text-xs">to</span>
            <div className="relative flex-1">
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setCurrentPage(1); }}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
                placeholder="To Date"
              />
            </div>
          </div>
        </div>

        {/* Quick Date Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 pt-1">
          <span className="font-medium text-slate-400">Quick Dates:</span>
          <button
            onClick={() => applyDatePreset('today')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer ${
              fromDate === getLocalDateString(0) && toDate === getLocalDateString(0)
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => applyDatePreset('yesterday')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer ${
              fromDate === getLocalDateString(-1) && toDate === getLocalDateString(-1)
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Yesterday
          </button>
          <button
            onClick={() => applyDatePreset('7days')}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer ${
              fromDate === getLocalDateString(-7) && toDate === getLocalDateString(0)
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Last 7 Days
          </button>
          {(fromDate || toDate) && (
            <button
              onClick={() => applyDatePreset('all')}
              className="px-2.5 py-1 rounded-lg border bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200 text-[11px] font-medium transition cursor-pointer"
            >
              Clear Date Filter
            </button>
          )}

          {(searchQuery || platformFilter !== 'all' || typeFilter !== 'all' || fromDate || toDate || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setPlatformFilter('all');
                setTypeFilter('all');
                setFromDate('');
                setToDate('');
                setStatusFilter('all');
                setCurrentPage(1);
              }}
              className="ml-auto text-blue-600 hover:text-blue-800 text-xs font-semibold underline cursor-pointer"
            >
              Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* Info banner if there are stuck processing items */}
      {stats.processing > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-blue-900 shadow-2xs">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-100 text-blue-700 shrink-0">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-blue-900">
                {stats.processing} Upload Session{stats.processing > 1 ? 's' : ''} Under Processing
              </div>
              <div className="text-xs text-blue-700 mt-0.5">
                If any of these uploads were interrupted by a closed tab or network timeout, click "Fix Stuck Uploads" to unfreeze them.
              </div>
            </div>
          </div>
          <button
            onClick={handleCleanStuckUploads}
            disabled={isCleaningStuck}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isCleaningStuck ? 'animate-spin' : ''}`} />
            {isCleaningStuck ? 'Cleaning…' : 'Fix Stuck Sessions'}
          </button>
        </div>
      )}

      {/* Upload Logs Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
            <span>Showing {sortedLogs.length} matching log entries</span>
            {statusFilter !== 'all' && (
              <span className="capitalize bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {statusFilter}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        </div>

        {/* Main Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/75 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                <th
                  onClick={() => {
                    if (sortField === 'timestamp') setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                    else { setSortField('timestamp'); setSortOrder('desc'); }
                  }}
                  className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition select-none"
                >
                  <div className="flex items-center gap-1">
                    <span>Timestamp</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th
                  onClick={() => {
                    if (sortField === 'orderId') setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                    else { setSortField('orderId'); setSortOrder('asc'); }
                  }}
                  className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition select-none"
                >
                  <div className="flex items-center gap-1">
                    <span>Order ID & Platform</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4">File Name & Size</th>
                <th className="py-3 px-4">Status</th>
                <th
                  onClick={() => {
                    if (sortField === 'progress') setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                    else { setSortField('progress'); setSortOrder('desc'); }
                  }}
                  className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition select-none"
                >
                  <div className="flex items-center gap-1">
                    <span>Stage & Progress</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
                <th className="py-3 px-4">Packer / Operator</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center">
                    <div className="max-w-xs mx-auto text-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                        <FileClock className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-slate-700">No upload logs found</p>
                      <p className="text-xs text-slate-500">
                        No upload activities match your current filter criteria. Try adjusting or resetting your filters.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log, idx) => {
                  const pct = Math.round(Number(log.progress) || 0);
                  const isCompleted = String(log.status).toLowerCase() === 'completed';
                  const isProcessing = String(log.status).toLowerCase() === 'in progress' || String(log.status).toLowerCase() === 'uploading';
                  const isFailed = String(log.status).toLowerCase() === 'failed' || String(log.status).toLowerCase() === 'paused';
                  const rowKey = `${log.uploadId || log.orderId}_${idx}`;

                  return (
                    <tr
                      key={rowKey}
                      className="hover:bg-slate-50/80 transition group"
                    >
                      {/* Timestamp */}
                      <td className="py-3.5 px-4 font-mono text-slate-600 whitespace-nowrap text-[11px]">
                        {formatTimestamp(log.timestamp)}
                      </td>

                      {/* Order ID & Platform */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 tracking-tight font-mono text-xs">
                            {log.orderId || '—'}
                          </span>
                          <button
                            onClick={() => copyToClipboard(log.orderId, 'Order ID', `order_${rowKey}`)}
                            className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition"
                            title="Copy Order ID"
                          >
                            {copiedId === `order_${rowKey}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {getPlatformBadge(log.platform)}
                          {getTypeBadge(log.recordingType)}
                        </div>
                      </td>

                      {/* File Name & Size */}
                      <td className="py-3.5 px-4 max-w-[200px]">
                        <div className="flex items-center gap-1.5 truncate" title={log.fileName}>
                          <FileVideo className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="text-slate-800 font-medium truncate text-xs">
                            {log.fileName || 'Recording.mp4'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                          <span>{formatFileSize(log.fileSize) || '—'}</span>
                          {log.source && (
                            <span className="text-slate-400">· {log.source}</span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(log.status, log.progress)}
                        {log.error && (
                          <div className="text-[10px] text-rose-600 mt-1 max-w-[150px] truncate" title={log.error}>
                            {log.error}
                          </div>
                        )}
                      </td>

                      {/* Stage & Progress */}
                      <td className="py-3.5 px-4 min-w-[180px]">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-700 font-medium truncate max-w-[140px]" title={log.stage}>
                              {log.stage || (isCompleted ? 'Uploaded to Google Drive' : 'In Progress')}
                            </span>
                            <span className="font-mono font-bold text-slate-600 ml-2">{pct}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-emerald-500'
                                  : isFailed
                                  ? 'bg-rose-500'
                                  : 'bg-blue-600 animate-pulse'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(isCompleted ? 100 : 0, pct))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Packer / Operator */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <div className="flex items-center gap-1 text-xs truncate max-w-[140px]" title={log.packerEmail}>
                          <UserIcon className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{log.packerEmail || 'Packer'}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Resume Button for Local Queue Items */}
                          {log.queueJobId && (() => {
                            const localItem = localQueue.find(q => q.id === log.queueJobId);
                            const isPausedOrFailed = localItem && (localItem.status === 'failed' || localItem.status === 'paused' || localItem.status === 'pending');
                            if (isPausedOrFailed) {
                              return (
                                <button
                                  onClick={async () => {
                                    await retryUploadItem(log.queueJobId!);
                                    onShowToast('Resumed upload queue item', 'success');
                                    loadData(false);
                                  }}
                                  className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition inline-flex items-center gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
                                  title="Resume Upload"
                                >
                                  <RotateCw className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline text-[11px]">Resume</span>
                                </button>
                              );
                            }
                            return null;
                          })()}

                          {/* Play in Portal Button */}
                          {(log.playbackUrl || log.driveFileId || log.queueJobId) && (
                            <button
                              onClick={() => handleOpenPlayback(log)}
                              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition inline-flex items-center gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
                              title="Play Video in Portal (High Quality)"
                            >
                              <Play className="w-3.5 h-3.5 fill-white" />
                              <span className="hidden sm:inline text-[11px]">Play</span>
                            </button>
                          )}

                          {/* Google Drive Link */}
                          {(log.playbackUrl || log.driveFileId) && (
                            <a
                              href={log.playbackUrl || `https://drive.google.com/file/d/${log.driveFileId}/view`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition inline-flex items-center gap-1 text-xs font-semibold"
                              title="Open Video in Google Drive"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span className="hidden lg:inline text-[11px]">Drive</span>
                            </a>
                          )}

                          {/* Direct Download */}
                          {(log.downloadUrl || log.driveFileId) && (
                            <a
                              href={log.downloadUrl || `https://drive.google.com/uc?export=download&id=${log.driveFileId}`}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                              title="Download MP4 from Drive"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* Copy Link Button */}
                          {(log.playbackUrl || log.driveFileId) && (
                            <button
                              onClick={() => {
                                const url = log.playbackUrl || `https://drive.google.com/file/d/${log.driveFileId}/view`;
                                copyToClipboard(url, 'Google Drive Video Link', `link_${rowKey}`);
                              }}
                              className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                              title="Copy Google Drive URL"
                            >
                              {copiedId === `link_${rowKey}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Info Button for Detail Modal */}
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                            title="View Complete Log Metadata"
                          >
                            <Info className="w-3.5 h-3.5 text-slate-500" />
                          </button>

                          {/* Remove from Sheet & Drive Button */}
                          {canUserDeleteData(currentUser) && (
                            <button
                              onClick={() => handleOpenDeleteModal(log)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 rounded-lg transition border border-rose-200"
                              title="Remove Record from Google Sheet & Drive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="text-xs text-slate-500">
              Page <span className="font-bold text-slate-800">{currentPage}</span> of{' '}
              <span className="font-bold text-slate-800">{totalPages}</span> ({sortedLogs.length} total logs)
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 bg-white border border-slate-200 disabled:opacity-40 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
              >
                Previous
              </button>

              {/* Page numbers (up to 5) */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = i + 1;
                if (totalPages > 5 && currentPage > 3) {
                  pageNum = Math.min(totalPages - 4 + i, currentPage - 2 + i);
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-xl text-xs font-semibold transition ${
                      currentPage === pageNum
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-white border border-slate-200 disabled:opacity-40 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* In-Portal High-Quality Video Playback Modal */}
      {playbackLog && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 text-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center shrink-0">
                  <Film className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-white font-mono">{playbackLog.orderId}</span>
                    {getPlatformBadge(playbackLog.platform)}
                    {getTypeBadge(playbackLog.recordingType)}
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      HD 1080p
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                    {playbackLog.fileName || 'Recording.mp4'} • {playbackLog.fileSize || 'Standard'} • {formatTimestamp(playbackLog.timestamp)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {playbackLog.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${playbackLog.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in Drive
                  </a>
                )}

                <button
                  onClick={handleClosePlayback}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Video Player Display Area */}
            <div className="relative aspect-video bg-black flex items-center justify-center w-full max-h-[64vh] overflow-hidden">
              {localBlobUrl ? (
                <div className="relative w-full h-full flex items-center justify-center">
                  <video
                    src={localBlobUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain max-h-[64vh]"
                  />
                  <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-xs text-amber-300 text-[10px] font-mono px-2 py-1 rounded border border-amber-500/30">
                    ● Local Station Master Recording (Zero Latency)
                  </div>
                </div>
              ) : playbackLog.driveFileId ? (
                <iframe
                  src={`https://drive.google.com/file/d/${playbackLog.driveFileId}/preview`}
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  className="w-full h-full border-0 bg-black min-h-[380px]"
                  loading="eager"
                  title={`Video Playback - Order ${playbackLog.orderId}`}
                />
              ) : (
                <div className="p-8 text-center space-y-2">
                  <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
                  <h4 className="text-sm font-semibold text-white">Video is Queued or Processing</h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    This recording has not finished syncing to Google Drive yet. Check the progress in the upload queue.
                  </p>
                </div>
              )}
            </div>

            {/* Playback Actions & Options Toolbar */}
            <div className="p-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                <span className="font-semibold text-slate-300">Packer:</span> {playbackLog.packerEmail}
                <span>•</span>
                <span className="font-semibold text-slate-300">Stage:</span> {playbackLog.stage}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* View in Drive Button */}
                {playbackLog.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${playbackLog.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition inline-flex items-center gap-1.5 shadow-2xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View in Google Drive
                  </a>
                )}

                {/* Download Button */}
                {playbackLog.driveFileId && (
                  <a
                    href={`https://drive.google.com/uc?export=download&id=${playbackLog.driveFileId}`}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition inline-flex items-center gap-1.5 border border-slate-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download MP4
                  </a>
                )}

                {/* Copy Link Button */}
                {playbackLog.driveFileId && (
                  <button
                    onClick={() => {
                      const url = `https://drive.google.com/file/d/${playbackLog.driveFileId}/view`;
                      copyToClipboard(url, 'Google Drive Video Link', 'modal_drive_link');
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition inline-flex items-center gap-1.5 border border-slate-700"
                  >
                    {copiedId === 'modal_drive_link' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    Copy Link
                  </button>
                )}

                {/* Remove from Sheet Button */}
                <button
                  onClick={() => {
                    setLogToDelete(playbackLog);
                    setDeleteDriveFileOption(false);
                  }}
                  className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 font-semibold rounded-xl transition inline-flex items-center gap-1.5 border border-rose-800/50"
                  title="Remove from OrderLog and UploadLog sheets"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove Log
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Remove Confirmation Modal */}
      {logToDelete && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-rose-50/75 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Remove Record from Sheet & Drive</h3>
                <p className="text-xs text-rose-700">Permanent data and video deletion</p>
              </div>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Are you sure you want to remove the log entries and video recording for Order{' '}
                <strong className="font-mono text-slate-900 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                  {logToDelete.orderId || 'N/A'}
                </strong>
                ?
              </p>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">Order ID:</span>
                  <span className="font-mono font-semibold text-slate-900">{logToDelete.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Platform & Type:</span>
                  <span className="font-semibold text-slate-800">{logToDelete.platform} ({logToDelete.recordingType})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">File Name:</span>
                  <span className="font-mono truncate max-w-[200px] text-slate-700">{logToDelete.fileName || 'Recording.mp4'}</span>
                </div>
                {logToDelete.driveFileId && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Drive ID:</span>
                    <span className="font-mono text-slate-700 truncate max-w-[180px]">{logToDelete.driveFileId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Timestamp:</span>
                  <span>{formatTimestamp(logToDelete.timestamp)}</span>
                </div>
              </div>

              {/* What will be removed breakdown */}
              <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-200/80 text-rose-900 text-[11px] space-y-1.5">
                <p className="font-bold flex items-center gap-1.5 text-rose-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  What will be permanently removed:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-rose-950/80">
                  <li>Matching rows in <strong>OrderLog</strong>, <strong>ReturnLog</strong> & <strong>UploadLog</strong> Google Sheets</li>
                  <li>Duplicate lock cleared so order can be re-recorded</li>
                  <li>Local station IndexedDB upload queue cache</li>
                </ul>
              </div>

              {/* Checkbox for moving Drive file to trash */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 cursor-pointer transition select-none">
                <input
                  type="checkbox"
                  checked={deleteDriveFileOption}
                  onChange={(e) => setDeleteDriveFileOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <div>
                  <span className="font-bold text-slate-900 text-xs">Also move video recording in Google Drive to Trash</span>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {logToDelete.driveFileId
                      ? `Trashes Drive file (${logToDelete.driveFileId}).`
                      : 'Trashes any linked video file found in Google Drive for this order.'}
                  </p>
                </div>
              </label>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setLogToDelete(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-center transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-center transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Confirm & Delete
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Metadata Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileClock className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Upload Session Log Details</h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Order ID</div>
                  <div className="font-mono font-bold text-sm text-slate-900 mt-0.5">{selectedLog.orderId}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Status</div>
                  <div className="mt-1">{getStatusBadge(selectedLog.status, selectedLog.progress)}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Platform</div>
                  <div className="mt-1">{getPlatformBadge(selectedLog.platform)}</div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Recording Type</div>
                  <div className="mt-1">{getTypeBadge(selectedLog.recordingType)}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-slate-400 font-medium">Timestamp:</span>
                  <span className="ml-2 font-mono text-slate-800">{selectedLog.timestamp}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">File Name:</span>
                  <span className="ml-2 font-mono text-slate-800">{selectedLog.fileName}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">File Size:</span>
                  <span className="ml-2 font-mono text-slate-800">{formatFileSize(selectedLog.fileSize)}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">Packer Email:</span>
                  <span className="ml-2 text-slate-800">{selectedLog.packerEmail}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">Upload ID:</span>
                  <span className="ml-2 font-mono text-slate-800">{selectedLog.uploadId || '—'}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">Stage:</span>
                  <span className="ml-2 text-slate-800 font-semibold">{selectedLog.stage}</span>
                </div>

                <div>
                  <span className="text-slate-400 font-medium">Progress:</span>
                  <span className="ml-2 font-bold text-blue-600">{selectedLog.progress}%</span>
                </div>

                {selectedLog.driveFileId && (
                  <div>
                    <span className="text-slate-400 font-medium">Google Drive File ID:</span>
                    <span className="ml-2 font-mono text-blue-600 break-all">{selectedLog.driveFileId}</span>
                  </div>
                )}

                {selectedLog.error && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 mt-2">
                    <span className="font-bold">Error Details:</span>
                    <p className="mt-1 font-mono text-[11px]">{selectedLog.error}</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                {/* Play in Portal */}
                {(selectedLog.playbackUrl || selectedLog.driveFileId) && (
                  <button
                    onClick={() => {
                      const log = selectedLog;
                      setSelectedLog(null);
                      handleOpenPlayback(log);
                    }}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-center transition flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Play in Portal
                  </button>
                )}

                {(selectedLog.playbackUrl || selectedLog.driveFileId) && (
                  <a
                    href={selectedLog.playbackUrl || `https://drive.google.com/file/d/${selectedLog.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-center transition flex items-center justify-center gap-1.5 border border-slate-200"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View in Drive
                  </a>
                )}

                {/* Remove Button */}
                <button
                  onClick={() => {
                    const log = selectedLog;
                    setSelectedLog(null);
                    setLogToDelete(log);
                    setDeleteDriveFileOption(false);
                  }}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold rounded-xl text-center transition flex items-center justify-center gap-1.5 border border-rose-200"
                  title="Remove from Sheets"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>

                <button
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
