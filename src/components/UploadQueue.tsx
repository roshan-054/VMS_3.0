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
  Filter,
  Loader2,
  Layers
} from 'lucide-react';
import { QueueItem } from '../types';
import {
  dbGetAllQueue,
  dbDeleteQueueItem,
  dbPutQueue,
  getStoredChunkSizeMb,
  getStoredAutoUpload,
  setStoredAutoUpload
} from '../lib/storage';
import { applySheetConditionalFormatting, fetchUploadLogs, deleteLogEntry } from '../lib/api';
import {
  triggerUploadWorker,
  pauseUploadItem,
  resumeUploadItem,
  retryUploadItem,
  bypassAllDuplicates,
  subscribeWorkerStatus,
  fixAndCleanAllStuckUploads
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

  // Deletion Confirmation Modal State
  const [itemToDelete, setItemToDelete] = useState<QueueItem | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [deleteFromSheetsOption, setDeleteFromSheetsOption] = useState(true);
  const [deleteDriveOption, setDeleteDriveOption] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isProcessingDelete, setIsProcessingDelete] = useState(false);

  const loadQueue = async () => {
    try {
      const localItems = await dbGetAllQueue();
      // Auto-heal any items that completed or have a valid Drive fileId so they never linger at 99%
      let healed = false;
      for (const item of localItems) {
        if (
          (item.fileId ||
            item.webViewLink ||
            (item.progress && item.progress >= 99 && item.stage?.toLowerCase().includes('uploaded'))) &&
          item.status !== 'completed'
        ) {
          item.status = 'completed';
          item.progress = 100;
          item.stage = 'Uploaded to Google Drive';
          item.isDuplicate = false;
          item.error = undefined;
          await dbPutQueue(item);
          healed = true;
        }
      }
      const all = healed ? await dbGetAllQueue() : localItems;
      all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setQueue(all);
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

  const [isCleaningStuck, setIsCleaningStuck] = useState(false);
  const handleFixStuckQueue = async () => {
    setIsCleaningStuck(true);
    try {
      const result = await fixAndCleanAllStuckUploads();
      loadQueue();
      onQueueChanged();
      onShowToast(`🧹 ${result.message || 'Reset queue and cleared stuck upload locks.'}`, 'success');
    } catch (e: any) {
      onShowToast(`Error cleaning stuck uploads: ${e?.message || e}`, 'error');
    } finally {
      setIsCleaningStuck(false);
    }
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

  const [isBypassingAll, setIsBypassingAll] = useState(false);
  const handleBypassAllDuplicates = async () => {
    setIsBypassingAll(true);
    try {
      const count = await bypassAllDuplicates();
      loadQueue();
      onQueueChanged();
      onShowToast(`🚀 Bypassed duplicate protection for ${count} order(s). Starting upload…`, 'success');
    } catch (e: any) {
      onShowToast(`Error bypassing duplicates: ${e?.message || e}`, 'error');
    } finally {
      setIsBypassingAll(false);
    }
  };

  const handleRemoveAllDuplicates = async () => {
    const dups = queue.filter(
      (i) =>
        i.isDuplicate ||
        (i.status === 'failed' &&
          (i.error?.toLowerCase().includes('duplicate') ||
            i.stage?.toLowerCase().includes('duplicate')))
    );
    for (const item of dups) {
      await dbDeleteQueueItem(item.id);
    }
    loadQueue();
    onQueueChanged();
    onShowToast(`Removed ${dups.length} blocked duplicate item(s) from local queue.`, 'info');
  };

  const handleRestartFromScratch = async (item: QueueItem) => {
    await retryUploadItem(item.id, false);
    loadQueue();
    onQueueChanged();
    onShowToast(`Restarting upload for Order ${item.orderId}…`, 'info');
  };

  const handlePromptDeleteOne = (item: QueueItem) => {
    setItemToDelete(item);
    setIsBulkDeleting(false);
    setDeleteFromSheetsOption(true);
    setDeleteDriveOption(false);
    setIsDeleteModalOpen(true);
  };

  const handlePromptDeleteBulk = () => {
    if (selectedQueueIds.length === 0) return;
    setItemToDelete(null);
    setIsBulkDeleting(true);
    setDeleteFromSheetsOption(true);
    setDeleteDriveOption(false);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    setIsProcessingDelete(true);
    try {
      if (isBulkDeleting) {
        const itemsToDelete = queue.filter((i) => selectedQueueIds.includes(i.id));
        for (const item of itemsToDelete) {
          await dbDeleteQueueItem(item.id);
          if (deleteFromSheetsOption || deleteDriveOption) {
            try {
              await deleteLogEntry({
                orderId: item.orderId,
                uploadId: item.uploadId || item.uploadSessionId,
                driveFileId: item.fileId || item.driveFileId,
                deleteFromSheets: deleteFromSheetsOption,
                deleteFromDrive: deleteDriveOption,
              });
            } catch (e) {
              console.warn('Remote bulk delete note:', e);
            }
          }
        }
        const count = itemsToDelete.length;
        setSelectedQueueIds([]);
        loadQueue();
        onQueueChanged();
        const sheetMsg = deleteFromSheetsOption ? ' and Google Sheet logs' : '';
        onShowToast(`Deleted ${count} item(s) from local queue${sheetMsg}.`, 'success');
      } else if (itemToDelete) {
        await dbDeleteQueueItem(itemToDelete.id);
        if (deleteFromSheetsOption || deleteDriveOption) {
          try {
            await deleteLogEntry({
              orderId: itemToDelete.orderId,
              uploadId: itemToDelete.uploadId || itemToDelete.uploadSessionId,
              driveFileId: itemToDelete.fileId || itemToDelete.driveFileId,
              deleteFromSheets: deleteFromSheetsOption,
              deleteFromDrive: deleteDriveOption,
            });
          } catch (e) {
            console.warn('Remote single delete note:', e);
          }
        }
        loadQueue();
        onQueueChanged();
        const sheetMsg = deleteFromSheetsOption ? ' and Google Sheet logs' : '';
        onShowToast(`Removed Order ${itemToDelete.orderId} from upload queue${sheetMsg}.`, 'success');
      }
    } catch (err: any) {
      onShowToast(`Delete error: ${err.message || err}`, 'error');
    } finally {
      setIsProcessingDelete(false);
      setIsDeleteModalOpen(false);
      setItemToDelete(null);
      setIsBulkDeleting(false);
    }
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

  const currentChunkSizeMb = getStoredChunkSizeMb();

  // Filtered queue items
  const filteredQueue = queue.filter((item) => {
    if (filterType === 'pending') {
      return item.status === 'pending' || item.status === 'uploading' || item.status === 'paused';
    }
    if (filterType === 'duplicate') {
      return (
        !item.fileId &&
        (item.isDuplicate ||
          (item.status === 'failed' &&
            (item.error?.toLowerCase().includes('duplicate') ||
              item.stage?.toLowerCase().includes('duplicate'))))
      );
    }
    if (filterType === 'completed') {
      return item.status === 'completed';
    }
    // Default 'all' in active queue shows non-completed items (completed files belong in Upload Logs)
    return item.status !== 'completed';
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
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                Sequential Upload: 1-by-1 FIFO
              </span>
              <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-500" />
                {currentChunkSizeMb} MB Chunks
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Strict sequential upload system: Files upload one after another. As soon as one file finishes, the next one begins automatically.
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
            id="fix-stuck-queue-btn"
            onClick={handleFixStuckQueue}
            disabled={isCleaningStuck}
            className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Clean and unfreeze any stuck uploads or release duplicate locks"
          >
            <RotateCw className={`w-3.5 h-3.5 text-amber-700 ${isCleaningStuck ? 'animate-spin' : ''}`} />
            {isCleaningStuck ? 'Cleaning…' : 'Fix Stuck / Reset'}
          </button>

          {duplicateCount > 0 && (
            <button
              id="unblock-all-toolbar-btn"
              onClick={handleBypassAllDuplicates}
              disabled={isBypassingAll}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Unblock and upload all duplicate-blocked orders"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {isBypassingAll ? 'Unblocking…' : `Unblock All (${duplicateCount})`}
            </button>
          )}

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
          className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-red-900 shadow-xs"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-700 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-xs sm:text-sm text-red-900 flex items-center gap-2">
                <span>{duplicateCount} Duplicate Order ID{duplicateCount > 1 ? 's' : ''} Blocked from Upload</span>
                <span className="bg-red-200 text-red-900 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                  Action Required
                </span>
              </div>
              <div className="text-xs text-red-700 mt-0.5">
                The system detected matching Order IDs in Google Drive or logs. You can bypass protection to force upload, or remove them.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              id="bypass-all-duplicates-banner-btn"
              onClick={handleBypassAllDuplicates}
              disabled={isBypassingAll}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              title="Force bypass duplicate protection and upload all blocked items"
            >
              <ShieldCheck className="w-4 h-4" />
              {isBypassingAll ? 'Bypassing…' : `Bypass & Upload All (${duplicateCount})`}
            </button>
            <button
              id="remove-all-duplicates-banner-btn"
              onClick={handleRemoveAllDuplicates}
              className="px-3 py-2 bg-white hover:bg-red-100 text-red-700 border border-red-300 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
              title="Remove all blocked duplicate items from the local queue"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove All
            </button>
            <button
              onClick={() => setFilterType('duplicate')}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
            >
              View Duplicates
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
                onClick={handlePromptDeleteBulk}
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
              !item.fileId &&
              (item.isDuplicate ||
                (item.status === 'failed' &&
                  (item.error?.toLowerCase().includes('duplicate') ||
                    item.stage?.toLowerCase().includes('duplicate'))));
            const isSelected = selectedQueueIds.includes(item.id);

            // Compute sequential queue position
            const pendingOrActiveList = queue.filter(
              (i) => i.status === 'pending' || i.status === 'uploading'
            );
            const queuePosition = pendingOrActiveList.findIndex((i) => i.id === item.id) + 1;
            const isCompleted = item.status === 'completed' || !!item.fileId;

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

                      {!isDuplicate && isCompleted && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Uploaded to Drive (100%)
                        </span>
                      )}

                      {!isDuplicate && !isCompleted && isItemUploading && (
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Uploading ({item.progress}%) [Active #1]
                        </span>
                      )}

                      {!isDuplicate && !isCompleted && item.status === 'paused' && (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Pause className="w-3 h-3" />
                          Paused ({item.progress}%)
                        </span>
                      )}

                      {!isDuplicate && !isCompleted && item.status === 'failed' && (
                        <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Upload Interrupted (Resumable)
                        </span>
                      )}

                      {!isDuplicate && !isCompleted && item.status === 'pending' && !isItemUploading && (
                        <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-indigo-200 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" />
                          {queuePosition > 1 ? `In Queue (Position #${queuePosition})` : 'In Queue (Next to Upload)'}
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
                      <span className="capitalize">{isDuplicate ? 'Duplicate Blocked' : isCompleted ? 'Completed' : item.status}</span>
                      <span>{isDuplicate ? 'Blocked' : isCompleted ? '100%' : `${item.progress}%`}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                      <div
                        className={`h-full transition-all duration-300 rounded-full ${
                          isCompleted
                            ? 'bg-emerald-500'
                            : isDuplicate
                            ? 'bg-red-400'
                            : item.status === 'failed'
                            ? 'bg-red-500'
                            : item.status === 'paused'
                            ? 'bg-amber-500'
                            : 'bg-blue-600 animate-pulse'
                        }`}
                        style={{ width: isDuplicate ? '100%' : isCompleted ? '100%' : `${item.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Interactive Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {/* If duplicate: Option to Bypass & Force Upload */}
                    {isDuplicate && (
                      <button
                        onClick={() => handleForceBypassDuplicate(item)}
                        className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                        title="Bypass duplicate protection and force upload now"
                      >
                        <ShieldCheck className="w-4 h-4" />
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

                    {/* Remove from Local Queue with Option to Delete from Sheet Logs */}
                    <button
                      onClick={() => handlePromptDeleteOne(item)}
                      className="px-2.5 py-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                      title="Remove from queue & delete options"
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

      {/* Delete Confirmation Modal with option to delete from Google Sheet Logs */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center border border-rose-200 shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isBulkDeleting
                    ? `Delete ${selectedQueueIds.length} Queue Items`
                    : `Delete Order: ${itemToDelete?.orderId || 'Item'}`}
                </h3>
                <p className="text-xs text-slate-500">
                  Select whether you also want to remove data from Google Sheet logs.
                </p>
              </div>
            </div>

            {/* Deletion Scope Options */}
            <div className="space-y-2.5 pt-1">
              {/* Checkbox 1: Delete data from Google Sheets logs */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-50 cursor-pointer transition select-none">
                <input
                  type="checkbox"
                  checked={deleteFromSheetsOption}
                  onChange={(e) => setDeleteFromSheetsOption(e.target.checked)}
                  className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4"
                />
                <div>
                  <span className="font-bold text-slate-900 text-xs">Also delete data from Google Sheet Logs</span>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {deleteFromSheetsOption
                      ? 'Permanently deletes matching rows from OrderLog, ReturnLog & UploadLog Google Sheets.'
                      : 'Leaves Google Sheet records intact. Only removes this item from the local device upload queue.'}
                  </p>
                </div>
              </label>

              {/* Checkbox 2: Move video recording in Google Drive to Trash */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 cursor-pointer transition select-none">
                <input
                  type="checkbox"
                  checked={deleteDriveOption}
                  onChange={(e) => setDeleteDriveOption(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <div>
                  <span className="font-bold text-slate-900 text-xs">Also move video recording in Google Drive to Trash</span>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Moves the associated video recording in Google Drive to trash if it was uploaded.
                  </p>
                </div>
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={isProcessingDelete}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setItemToDelete(null);
                  setIsBulkDeleting(false);
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-center transition cursor-pointer text-xs"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isProcessingDelete}
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-center transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer text-xs"
              >
                {isProcessingDelete ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Confirm Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
