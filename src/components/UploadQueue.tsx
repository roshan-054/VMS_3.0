import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  Play,
  Pause,
  RotateCw,
  Trash2,
  CheckCircle,
  AlertTriangle,
  FileVideo,
  ExternalLink,
  Zap,
  Check,
  XCircle,
  RefreshCw,
  PlusCircle,
  FileSpreadsheet,
  FileClock,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  Filter
} from 'lucide-react';
import { QueueItem } from '../types';
import {
  dbGetAllQueue,
  dbDeleteQueueItem,
  getStoredChunkSizeMb,
  getStoredAutoUpload,
  setStoredAutoUpload
} from '../lib/storage';
import { applySheetConditionalFormatting } from '../lib/api';
import {
  triggerUploadWorker,
  pauseUploadItem,
  resumeUploadItem,
  retryUploadItem,
  subscribeWorkerStatus
} from '../lib/uploadWorker';
import { ManualUpload } from './ManualUpload';

interface UploadQueueProps {
  onQueueChanged: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  onNavigateToLogs?: () => void;
}

export const UploadQueue: React.FC<UploadQueueProps> = ({
  onQueueChanged,
  onShowToast,
  onNavigateToLogs
}) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [showManualUpload, setShowManualUpload] = useState(true);
  const [isApplyingFormatting, setIsApplyingFormatting] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'pending' | 'duplicate' | 'completed'>('all');
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(getStoredAutoUpload());
  const [workerState, setWorkerState] = useState({
    isProcessing: false,
    activeItemId: null as string | null,
    activeProgress: 0,
    activeStage: '',
    activeChunk: 0,
    totalChunks: 0
  });

  const loadQueue = async () => {
    try {
      const items = await dbGetAllQueue();
      // Sort newest first
      items.sort((a, b) => b.createdAt - a.createdAt);
      setQueue(items);
    } catch (e) {
      console.warn('Load queue error:', e);
    }
  };

  useEffect(() => {
    loadQueue();

    // Subscribe to background upload worker state
    const unsubscribeWorker = subscribeWorkerStatus((state) => {
      setWorkerState(state);
      loadQueue();
    });

    // Listen for custom queue updates
    const handleQueueUpdate = () => {
      loadQueue();
      onQueueChanged();
    };

    window.addEventListener('ops_queue_updated', handleQueueUpdate);
    const interval = setInterval(loadQueue, 3000);

    return () => {
      unsubscribeWorker();
      window.removeEventListener('ops_queue_updated', handleQueueUpdate);
      clearInterval(interval);
    };
  }, []);

  const handleApplyFormatting = async () => {
    setIsApplyingFormatting(true);
    try {
      await applySheetConditionalFormatting();
      onShowToast('Applied duplicate highlight rules to Google Sheet OrderLog (Column B)!', 'success');
    } catch (err: any) {
      onShowToast(`Formatting update note: ${err.message}`, 'info');
    } finally {
      setIsApplyingFormatting(false);
    }
  };

  const handleSyncAll = () => {
    triggerUploadWorker();
    onShowToast('Syncing all pending uploads to Google Drive…', 'info');
  };

  const handleToggleAutoUpload = () => {
    const next = !autoUploadEnabled;
    setAutoUploadEnabled(next);
    setStoredAutoUpload(next);
    if (next) {
      triggerUploadWorker();
      onShowToast('Auto-sync enabled: Pending videos will upload automatically.', 'success');
    } else {
      onShowToast('Auto-sync paused.', 'info');
    }
  };

  const handleResume = async (item: QueueItem) => {
    await resumeUploadItem(item.id);
    loadQueue();
    onQueueChanged();
    onShowToast(`Resuming upload for Order ${item.orderId}…`, 'info');
  };

  const handlePause = async (item: QueueItem) => {
    await pauseUploadItem(item.id);
    loadQueue();
    onQueueChanged();
    onShowToast(`Paused upload for Order ${item.orderId}.`, 'info');
  };

  const handleForceBypassDuplicate = async (item: QueueItem) => {
    await retryUploadItem(item.id, true);
    loadQueue();
    onQueueChanged();
    onShowToast(`Duplicate check bypassed for Order ${item.orderId}. Starting upload…`, 'info');
  };

  const handleRestartFromScratch = async (item: QueueItem) => {
    await retryUploadItem(item.id, false);
    loadQueue();
    onQueueChanged();
    onShowToast(`Restarting upload for Order ${item.orderId}…`, 'info');
  };

  const handleRemove = async (id: string, orderId: string) => {
    await dbDeleteQueueItem(id);
    loadQueue();
    onQueueChanged();
    onShowToast(`Removed Order ${orderId} from local upload queue.`, 'info');
  };

  const handleClearCompleted = async () => {
    const completed = queue.filter((i) => i.status === 'completed');
    for (const item of completed) {
      await dbDeleteQueueItem(item.id);
    }
    loadQueue();
    onQueueChanged();
    onShowToast(`Cleared ${completed.length} completed items from queue.`, 'info');
  };

  const handleToggleSelectAll = () => {
    if (selectedQueueIds.length === filteredQueue.length) {
      setSelectedQueueIds([]);
    } else {
      setSelectedQueueIds(filteredQueue.map((i) => i.id));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedQueueIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedQueueIds.length === 0) return;
    for (const id of selectedQueueIds) {
      await dbDeleteQueueItem(id);
    }
    const count = selectedQueueIds.length;
    setSelectedQueueIds([]);
    loadQueue();
    onQueueChanged();
    onShowToast(`Successfully deleted ${count} selected queue item(s).`, 'success');
  };

  const currentChunkSizeMb = getStoredChunkSizeMb();

  // Filtered queue items
  const filteredQueue = queue.filter((item) => {
    if (filterType === 'pending') {
      return item.status === 'pending' || item.status === 'uploading' || item.status === 'paused';
    }
    if (filterType === 'duplicate') {
      return item.isDuplicate || (item.status === 'failed' && (item.error?.toLowerCase().includes('duplicate') || item.stage?.toLowerCase().includes('duplicate')));
    }
    if (filterType === 'completed') {
      return item.status === 'completed';
    }
    return true;
  });

  const duplicateCount = queue.filter(
    (i) => i.isDuplicate || (i.status === 'failed' && (i.error?.toLowerCase().includes('duplicate') || i.stage?.toLowerCase().includes('duplicate')))
  ).length;
  const pendingCount = queue.filter((i) => i.status === 'pending' || i.status === 'uploading').length;
  const completedCount = queue.filter((i) => i.status === 'completed').length;

  return (
    <div id="upload-queue-container" className="space-y-6">
      {/* Top Banner: Auto-Sequence & Duplicate Guard Status */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Automatic Upload Queue & Duplicate Guard
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                Auto-Sequence Active
              </span>
              <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-500" />
                {currentChunkSizeMb} MB Chunks
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Uploads progress continuously one after another in small intervals. Duplicate Order IDs are automatically detected and blocked from corrupting cloud records.
            </p>
          </div>
        </div>

        {/* Global Queue Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            id="toggle-auto-upload-btn"
            onClick={handleToggleAutoUpload}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border transition inline-flex items-center gap-1.5 cursor-pointer ${
              autoUploadEnabled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
            }`}
            title="Toggle automatic upload sequencing"
          >
            {autoUploadEnabled ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Auto-Sync: ON
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                Auto-Sync: PAUSED
              </>
            )}
          </button>

          <button
            id="sync-all-pending-btn"
            onClick={handleSyncAll}
            disabled={workerState.isProcessing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${workerState.isProcessing ? 'animate-spin' : ''}`} />
            {workerState.isProcessing ? 'Syncing Queue…' : 'Sync All Pending'}
          </button>

          <button
            id="toggle-manual-upload-btn"
            onClick={() => setShowManualUpload(!showManualUpload)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition inline-flex items-center gap-1.5 cursor-pointer ${
              showManualUpload
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5 text-blue-600" />
            {showManualUpload ? 'Hide Custom Bulk Upload' : 'Custom Bulk Upload'}
          </button>

          {onNavigateToLogs && (
            <button
              id="view-upload-logs-btn"
              onClick={onNavigateToLogs}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileClock className="w-3.5 h-3.5 text-blue-600" />
              Upload Logs
            </button>
          )}
        </div>
      </div>

      {/* Manual Upload Expansion Section */}
      {showManualUpload && (
        <div className="animate-in fade-in slide-in-from-top-3 duration-200">
          <ManualUpload
            onQueueUpdated={() => {
              loadQueue();
              onQueueChanged();
              triggerUploadWorker();
            }}
            onShowToast={onShowToast}
          />
        </div>
      )}

      {/* Duplicate Order Warning Alert Box if any duplicate blocked */}
      {duplicateCount > 0 && (
        <div
          id="duplicate-alert-banner"
          className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-900 shadow-xs"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-700 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-red-900">
                {duplicateCount} Duplicate Order ID{duplicateCount > 1 ? 's' : ''} Blocked from Upload
              </div>
              <div className="text-xs text-red-700 mt-0.5">
                The system prevented these duplicate Order IDs from being uploaded because matching recordings already exist in Google Drive and Sheet logs.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setFilterType('duplicate')}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              View Duplicates ({duplicateCount})
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs & Queue Statistics Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              filterType === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>All Items</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-800 font-bold">
              {queue.length}
            </span>
          </button>

          <button
            onClick={() => setFilterType('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              filterType === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>Pending / Uploading</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-800 font-bold">
              {pendingCount}
            </span>
          </button>

          {duplicateCount > 0 && (
            <button
              onClick={() => setFilterType('duplicate')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                filterType === 'duplicate'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Duplicates Blocked</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-200 text-red-900 font-bold">
                {duplicateCount}
              </span>
            </button>
          )}

          <button
            onClick={() => setFilterType('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              filterType === 'completed'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>Completed</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold">
              {completedCount}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            id="format-sheet-duplicates-btn"
            onClick={handleApplyFormatting}
            disabled={isApplyingFormatting}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-medium transition inline-flex items-center gap-1.5"
            title="Applies conditional formatting rule to highlight any duplicate Order IDs in Google Sheet OrderLog"
          >
            <FileSpreadsheet className={`w-3.5 h-3.5 text-emerald-600 ${isApplyingFormatting ? 'animate-spin' : ''}`} />
            {isApplyingFormatting ? 'Formatting…' : 'Highlight Duplicates in Sheet'}
          </button>

          {completedCount > 0 && (
            <button
              id="clear-completed-queue-btn"
              onClick={handleClearCompleted}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer"
            >
              Clear Completed ({completedCount})
            </button>
          )}
        </div>
      </div>

      {/* Queue Items List */}
      {filteredQueue.length === 0 ? (
        <div id="queue-empty-box" className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">
            {filterType === 'duplicate'
              ? 'No Duplicate Order IDs Detected'
              : filterType === 'pending'
              ? 'No Pending Uploads'
              : 'All Queue Items Synchronized'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {filterType === 'duplicate'
              ? 'Every order in your packing queue is unique and safe from duplicate collisions.'
              : 'When packing recordings are captured, they are stored locally and uploaded sequentially to Google Drive.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Bulk Select & Delete Bar */}
          <div className="bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                aria-label="Select all queue items"
                checked={selectedQueueIds.length > 0 && selectedQueueIds.length === filteredQueue.length}
                onChange={handleToggleSelectAll}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="font-semibold text-slate-700">
                Select All ({filteredQueue.length} items)
              </span>
              {selectedQueueIds.length > 0 && (
                <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold text-[11px]">
                  {selectedQueueIds.length} selected
                </span>
              )}
            </div>

            {selectedQueueIds.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected ({selectedQueueIds.length})
              </button>
            )}
          </div>

          {filteredQueue.map((item) => {
            const isItemUploading = workerState.isProcessing && workerState.activeItemId === item.id;
            const fileSizeMb = item.fileSize ? (item.fileSize / (1024 * 1024)).toFixed(2) : '0';
            const uploadedMb = item.uploadedBytes ? (item.uploadedBytes / (1024 * 1024)).toFixed(2) : '0';
            const isDuplicate =
              item.isDuplicate ||
              (item.status === 'failed' &&
                (item.error?.toLowerCase().includes('duplicate') ||
                  item.stage?.toLowerCase().includes('duplicate')));
            const isSelected = selectedQueueIds.includes(item.id);

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 transition ${
                  isSelected
                    ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-400'
                    : isDuplicate
                    ? 'border-red-300 bg-red-50/20'
                    : isItemUploading
                    ? 'border-blue-300 ring-2 ring-blue-500/10'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Left: Checkbox & Video Details */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    aria-label={`Select queue item ${item.orderId}`}
                    checked={isSelected}
                    onChange={() => handleToggleSelectOne(item.id)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer mt-3 shrink-0"
                  />
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      isDuplicate
                        ? 'bg-red-100 text-red-700 border border-red-300'
                        : item.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : isItemUploading
                        ? 'bg-blue-50 text-blue-600 border border-blue-200 animate-pulse'
                        : item.status === 'failed'
                        ? 'bg-red-50 text-red-600 border border-red-200'
                        : item.status === 'paused'
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {isDuplicate ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : (
                      <FileVideo className="w-5 h-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm tracking-tight">{item.orderId}</span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {item.platform}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          item.recordingType === 'Forward'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {item.recordingType}
                      </span>

                      {/* Status Badges */}
                      {isDuplicate && (
                        <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-red-300 flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3" />
                          Duplicate Order ID - Upload Blocked
                        </span>
                      )}

                      {!isDuplicate && item.status === 'completed' && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Uploaded to Drive
                        </span>
                      )}

                      {!isDuplicate && isItemUploading && (
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Uploading ({item.progress}%)
                        </span>
                      )}

                      {!isDuplicate && item.status === 'paused' && (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Pause className="w-3 h-3" />
                          Paused ({item.progress}%)
                        </span>
                      )}

                      {!isDuplicate && item.status === 'failed' && (
                        <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Upload Interrupted (Resumable)
                        </span>
                      )}

                      {!isDuplicate && item.status === 'pending' && !isItemUploading && (
                        <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" />
                          In Queue (Auto-Sync)
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 font-mono mt-1 truncate">{item.fileName}</p>

                    {/* Duplicate Description or Stage Details */}
                    {isDuplicate ? (
                      <div className="mt-1.5 p-2 bg-red-100/60 border border-red-200 rounded-lg text-xs text-red-800 font-medium">
                        ⚠️ <strong>Duplicate Order ID:</strong> An upload with Order ID "{item.orderId}" already exists in Google Drive or Order Logs. Automatic upload is blocked to prevent accidental overwrite.
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                        <span>
                          {fileSizeMb} MB {item.uploadedBytes && item.status !== 'completed' ? `(${uploadedMb} MB uploaded)` : ''}
                        </span>
                        <span>•</span>
                        <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                        {item.stage && (
                          <>
                            <span>•</span>
                            <span
                              className={`font-medium ${
                                item.status === 'failed'
                                  ? 'text-red-600 font-semibold'
                                  : item.status === 'paused'
                                  ? 'text-amber-600'
                                  : 'text-blue-600'
                              }`}
                            >
                              {item.stage}
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Drive Web View Link if completed */}
                    {item.webViewLink && (
                      <div className="mt-2">
                        <a
                          href={item.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Video in Google Drive
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Progress Bar & Action Controls */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full lg:w-auto justify-between lg:justify-end shrink-0">
                  <div className="w-full sm:w-44 space-y-1.5">
                    <div className="flex justify-between text-[11px] font-bold text-slate-600">
                      <span className="capitalize">{isDuplicate ? 'Duplicate Blocked' : item.status}</span>
                      <span>{item.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                      <div
                        className={`h-full transition-all duration-300 ${
                          item.status === 'completed'
                            ? 'bg-emerald-500'
                            : isDuplicate
                            ? 'bg-red-400'
                            : item.status === 'failed'
                            ? 'bg-red-500'
                            : item.status === 'paused'
                            ? 'bg-amber-500'
                            : 'bg-blue-600 animate-pulse'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Interactive Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {/* If duplicate: Option to Bypass & Force Upload */}
                    {isDuplicate && (
                      <button
                        onClick={() => handleForceBypassDuplicate(item)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                        title="Bypass duplicate protection and upload anyway"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Bypass & Upload
                      </button>
                    )}

                    {/* Resume / Sync Button (when not duplicate and failed/paused/pending) */}
                    {!isDuplicate && (item.status === 'failed' || item.status === 'paused' || (item.status === 'pending' && !isItemUploading)) && (
                      <button
                        onClick={() => handleResume(item)}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Start or Resume Upload"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Start / Resume
                      </button>
                    )}

                    {/* Cancel / Pause Button (when currently uploading) */}
                    {isItemUploading && (
                      <button
                        onClick={() => handlePause(item)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                        title="Pause ongoing upload"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pause
                      </button>
                    )}

                    {/* Restart from 0% Button (for failed/paused items) */}
                    {!isDuplicate && (item.status === 'failed' || item.status === 'paused') && (
                      <button
                        onClick={() => handleRestartFromScratch(item)}
                        className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                        title="Restart upload from beginning"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                    )}

                    {/* Remove from Local Queue Only Button */}
                    <button
                      onClick={() => handleRemove(item.id, item.orderId)}
                      className="px-2.5 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
