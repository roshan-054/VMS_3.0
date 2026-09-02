import { QueueItem } from '../types';
import {
  dbGetAllQueue,
  dbPutQueue,
  getStoredDriveFolderId,
  getStoredChunkSize,
  getStoredAutoUpload,
  getStoredAutoResume,
} from './storage';
import { requestApi, checkDuplicate, normalizeOrderId, cleanupStuckUploads } from './api';

export type WorkerToastHandler = (msg: string, type: 'info' | 'success' | 'error') => void;

interface WorkerState {
  isProcessing: boolean;
  activeItemId: string | null;
  activeProgress: number;
  activeStage: string;
  activeChunk: number;
  totalChunks: number;
}

let isWorkerBusy = false;
let autoSyncTimer: any = null;
let toastHandler: WorkerToastHandler | null = null;
const stateListeners = new Set<(state: WorkerState) => void>();

let currentState: WorkerState = {
  isProcessing: false,
  activeItemId: null,
  activeProgress: 0,
  activeStage: '',
  activeChunk: 0,
  totalChunks: 0,
};

function updateState(partial: Partial<WorkerState>) {
  currentState = { ...currentState, ...partial };
  stateListeners.forEach((fn) => {
    try {
      fn(currentState);
    } catch (e) {
      console.warn('Worker state listener error:', e);
    }
  });
  window.dispatchEvent(new CustomEvent('ops_queue_updated', { detail: currentState }));
}

export function subscribeWorkerStatus(callback: (state: WorkerState) => void): () => void {
  stateListeners.add(callback);
  callback(currentState);
  return () => {
    stateListeners.delete(callback);
  };
}

export function getWorkerStatus(): WorkerState {
  return currentState;
}

export function registerToastHandler(handler: WorkerToastHandler) {
  toastHandler = handler;
}

function notify(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (toastHandler) {
    toastHandler(msg, type);
  }
}

/**
 * Converts a Blob or slice to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

/**
 * Background Upload Worker - Processes items sequentially
 */
export async function triggerUploadWorker(): Promise<void> {
  if (isWorkerBusy) {
    return;
  }

  if (!navigator.onLine) {
    return;
  }

  const autoUpload = getStoredAutoUpload();
  if (!autoUpload) {
    return;
  }

  isWorkerBusy = true;

  try {
    const allItems = await dbGetAllQueue();

    // Prioritize active/pending items in strict chronological FIFO order
    const activeOrPending = allItems
      .filter((item) => item.status === 'pending' || item.status === 'uploading')
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    let candidate = activeOrPending[0];

    // If auto-resume enabled and no active/pending items, check non-duplicate failed items
    if (!candidate && getStoredAutoResume()) {
      const failedItems = allItems
        .filter((item) => item.status === 'failed' && !item.isDuplicate && item.blob)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      candidate = failedItems[0];
    }

    if (!candidate) {
      updateState({
        isProcessing: false,
        activeItemId: null,
        activeProgress: 0,
        activeStage: '',
      });
      isWorkerBusy = false;
      return;
    }

    if (!candidate.blob) {
      candidate.status = 'failed';
      candidate.error = 'Recording video data is missing or corrupted.';
      candidate.stage = 'Error: Video data missing';
      await dbPutQueue(candidate);
      isWorkerBusy = false;
      // Auto-trigger next sequential item
      setTimeout(() => triggerUploadWorker(), 200);
      return;
    }

    const currentItem = candidate;

    // -------------------------------------------------------------
    // DUPLICATE ORDER ID & CLOUD VERIFICATION GUARD:
    // Check if another completed item with same orderId exists locally or remotely
    // -------------------------------------------------------------
    if (!currentItem.bypassDuplicate) {
      const normTarget = normalizeOrderId(currentItem.orderId);

      // 1. Check local completed queue (ONLY completed items with valid web link or fileId)
      const localCompleted = allItems.find(
        (it) =>
          it.id !== currentItem.id &&
          normalizeOrderId(it.orderId) === normTarget &&
          it.status === 'completed' &&
          (it.fileId || it.webViewLink)
      );

      // 2. Check remote Google Sheet / Drive records
      let remoteDuplicate: any = null;
      if (!localCompleted && normTarget) {
        try {
          remoteDuplicate = await checkDuplicate({
            orderId: currentItem.orderId,
            platform: currentItem.platform,
            recordingType: currentItem.recordingType,
          });
        } catch (e) {
          console.warn('Remote duplicate check note:', e);
        }
      }

      // If remote already has a completed Drive file for this order:
      // Check if THIS queue item was the one uploaded (e.g. uploadId set, or progress >= 50%, or status was uploading/failed)
      if (remoteDuplicate && remoteDuplicate.fileId && remoteDuplicate.fileId.length > 5) {
        const wasAttempted = Boolean(
          currentItem.uploadId ||
          (currentItem.progress && currentItem.progress >= 50) ||
          currentItem.status === 'uploading' ||
          (currentItem.status === 'failed' && (currentItem.stage?.includes('Upload') || currentItem.stage?.includes('Processing')))
        );

        if (wasAttempted) {
          // The file was already successfully saved to Google Drive!
          currentItem.status = 'completed';
          currentItem.progress = 100;
          currentItem.stage = 'Uploaded to Google Drive';
          currentItem.isDuplicate = false;
          currentItem.error = undefined;
          currentItem.fileId = remoteDuplicate.fileId;
          currentItem.webViewLink =
            remoteDuplicate.webViewLink ||
            remoteDuplicate.playbackUrl ||
            `https://drive.google.com/file/d/${remoteDuplicate.fileId}/preview`;
          await dbPutQueue(currentItem);
          updateState({
            isProcessing: false,
            activeItemId: null,
            activeProgress: 100,
            activeStage: 'Upload verified completed',
          });
          notify(`✅ Order ${currentItem.orderId} verified as successfully uploaded to Google Drive!`, 'success');
          isWorkerBusy = false;
          setTimeout(() => triggerUploadWorker(), 200);
          return;
        }
      }

      if (localCompleted || (remoteDuplicate && (remoteDuplicate.fileId || remoteDuplicate.isDuplicate))) {
        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.stage = `Blocked: Duplicate Order ID (${currentItem.orderId})`;
        currentItem.error = `Duplicate Order ID: Order "${currentItem.orderId}" has already been uploaded to Google Drive. Duplicate upload was prevented.`;
        currentItem.duplicateReason = `Order ${currentItem.orderId} already exists in Google Drive / OrderLog (Timestamp: ${
          remoteDuplicate?.timestamp || 'Previous Record'
        }).`;

        await dbPutQueue(currentItem);
        updateState({
          isProcessing: false,
          activeItemId: null,
          activeProgress: 0,
          activeStage: '',
        });

        notify(
          `⚠️ Duplicate Order ID blocked: Order ${currentItem.orderId} is already in Google Drive. Click "Bypass & Upload" if you wish to upload anyway.`,
          'error'
        );

        isWorkerBusy = false;
        // Immediately start next pending non-duplicate item in sequential pipeline
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
    }

    // -------------------------------------------------------------
    // START UPLOAD PROCESS (Strict Single Active Item)
    // -------------------------------------------------------------
    currentItem.status = 'uploading';
    currentItem.isDuplicate = false;
    currentItem.stage = 'Connecting to Google Drive...';
    await dbPutQueue(currentItem);

    updateState({
      isProcessing: true,
      activeItemId: currentItem.id,
      activeProgress: currentItem.progress || 0,
      activeStage: 'Connecting to Google Drive...',
    });

    const totalBytes = currentItem.blob.size;
    // For small and medium files (<= 12 MB), use single-chunk instant upload (~1.5-2.5s)
    // For larger files, use fast 4 MB chunks
    const isSmallFile = totalBytes <= 12 * 1024 * 1024;
    const configuredChunkSize = getStoredChunkSize();
    const chunkSize = isSmallFile ? totalBytes : (configuredChunkSize > 0 ? configuredChunkSize : 4 * 1024 * 1024);
    const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));
    const driveFolderId = currentItem.driveFolderId || getStoredDriveFolderId();

    // 1. Request start upload session
    let startRes: any;
    try {
      startRes = await requestApi('startUpload', {
        orderId: currentItem.orderId,
        platform: currentItem.platform,
        recordingType: currentItem.recordingType,
        fileSize: currentItem.fileSize || totalBytes,
        mimeType: currentItem.mimeType,
        fileName: currentItem.fileName,
        source: currentItem.source || 'Automatic Recording',
        driveFolderId: driveFolderId,
        recordingDate: currentItem.recordingDate,
        totalChunks: totalChunks,
        bypassDuplicate: !!currentItem.bypassDuplicate,
        queueJobId: currentItem.id,
      });
    } catch (startErr: any) {
      const errMsg = startErr?.message || String(startErr);
      if (
        errMsg.toLowerCase().includes('duplicate') ||
        errMsg.toLowerCase().includes('already exists')
      ) {
        // Double-check if the file was already uploaded
        try {
          const verified = await checkDuplicate({
            orderId: currentItem.orderId,
            platform: currentItem.platform,
            recordingType: currentItem.recordingType,
          });
          if (verified && verified.fileId) {
            currentItem.status = 'completed';
            currentItem.progress = 100;
            currentItem.stage = 'Uploaded to Google Drive';
            currentItem.fileId = verified.fileId;
            currentItem.webViewLink = verified.webViewLink || `https://drive.google.com/file/d/${verified.fileId}/preview`;
            currentItem.error = undefined;
            currentItem.isDuplicate = false;
            await dbPutQueue(currentItem);
            notify(`✅ Order ${currentItem.orderId} verified in Google Drive!`, 'success');
            isWorkerBusy = false;
            setTimeout(() => triggerUploadWorker(), 200);
            return;
          }
        } catch (_) {}

        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.progress = 0;
        currentItem.uploadedBytes = 0;
        currentItem.currentChunk = 0;
        currentItem.stage = `Blocked: Duplicate Order ID (${currentItem.orderId})`;
        currentItem.error = `Duplicate Order ID: Order "${currentItem.orderId}" has already been uploaded to Google Drive.`;
        currentItem.duplicateReason = errMsg;
        await dbPutQueue(currentItem);
        updateState({ isProcessing: false, activeItemId: null });
        notify(`⚠️ Duplicate Order ID: Order ${currentItem.orderId} is already in Google Drive.`, 'error');
        isWorkerBusy = false;
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
      throw startErr;
    }

    if (!startRes?.success) {
      if (startRes?.isDuplicate || startRes?.code === 'DUPLICATE_ORDER_ID') {
        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.progress = 0;
        currentItem.uploadedBytes = 0;
        currentItem.currentChunk = 0;
        currentItem.stage = `Blocked: Duplicate Order ID (${currentItem.orderId})`;
        currentItem.error =
          startRes.error ||
          `Duplicate Order ID: Order "${currentItem.orderId}" already uploaded.`;
        await dbPutQueue(currentItem);
        updateState({ isProcessing: false, activeItemId: null });
        notify(`⚠️ Duplicate Order ID: Order ${currentItem.orderId} already uploaded.`, 'error');
        isWorkerBusy = false;
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
      throw new Error(startRes?.error || 'Failed to initiate Google Drive upload session.');
    }

    const uploadId = startRes.uploadId;
    currentItem.uploadId = uploadId;
    currentItem.totalChunks = totalChunks;
    currentItem.chunkSize = chunkSize;

    // 2. Upload Chunks Sequentially (Optimized Direct Apps Script Pipeline)
    let finalFileId = '';
    let finalWebViewLink = '';

    for (let c = 0; c < totalChunks; c++) {
      // Re-check if item was paused by user mid-stream
      const freshQueue = await dbGetAllQueue();
      const freshItem = freshQueue.find((i) => i.id === currentItem.id);
      if (freshItem && freshItem.status === 'paused') {
        isWorkerBusy = false;
        updateState({ isProcessing: false, activeItemId: null });
        setTimeout(() => triggerUploadWorker(), 200);
        return;
      }

      const startByte = c * chunkSize;
      const endByte = Math.min(startByte + chunkSize, totalBytes);
      const chunkBlob = currentItem.blob.slice(startByte, endByte);
      const isFinalChunk = c === totalChunks - 1 || endByte >= totalBytes;

      const stageDesc =
        totalChunks === 1
          ? 'Uploading video to Google Drive...'
          : `Uploading chunk ${c + 1} of ${totalChunks} (${Math.round((endByte / (1024 * 1024)) * 10) / 10} MB / ${Math.round((totalBytes / (1024 * 1024)) * 10) / 10} MB)...`;

      currentItem.currentChunk = c;
      currentItem.stage = stageDesc;
      currentItem.uploadedBytes = endByte;
      currentItem.progress = totalChunks === 1 ? 65 : Math.min(95, Math.round((endByte / totalBytes) * 100));

      await dbPutQueue(currentItem);
      updateState({
        isProcessing: true,
        activeItemId: currentItem.id,
        activeProgress: currentItem.progress,
        activeStage: stageDesc,
        activeChunk: c + 1,
        totalChunks: totalChunks,
      });

      // High-speed Base64 encoding
      const base64 = await blobToBase64(chunkBlob);
      let attempt = 0;
      let proxySuccess = false;
      let chunkRes: any = null;

      while (attempt < 3 && !proxySuccess) {
        attempt++;
        try {
          chunkRes = await requestApi('uploadChunk', {
            uploadId: uploadId,
            chunkIndex: c,
            totalChunks: totalChunks,
            startByte: startByte,
            endByte: endByte,
            totalSize: totalBytes,
            base64: base64,
            driveFolderId: driveFolderId,
            queueJobId: currentItem.id,
          });

          if (chunkRes?.success) {
            proxySuccess = true;
            if (chunkRes?.fileId) {
              finalFileId = chunkRes.fileId;
              finalWebViewLink = chunkRes.webViewLink || chunkRes.playbackUrl;
            }
          } else {
            throw new Error(chunkRes?.error || 'Chunk upload returned false');
          }
        } catch (cErr: any) {
          console.warn(`Upload chunk ${c + 1} attempt ${attempt} note:`, cErr);
          if (attempt >= 3) {
            // Check if backend actually received and finished it despite client timeout
            try {
              const verified = await checkDuplicate({
                orderId: currentItem.orderId,
                platform: currentItem.platform,
                recordingType: currentItem.recordingType,
              });
              if (verified && verified.fileId) {
                finalFileId = verified.fileId;
                finalWebViewLink = verified.webViewLink || `https://drive.google.com/file/d/${verified.fileId}/preview`;
                proxySuccess = true;
                break;
              }
            } catch (_) {}

            if (!proxySuccess) {
              throw new Error(
                `Chunk ${c + 1}/${totalChunks} failed after 3 attempts: ${cErr.message || cErr}`
              );
            }
          }
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }

      // If final chunk reached, immediately mark completed (100%)
      if (isFinalChunk) {
        const resolvedFileId = finalFileId || chunkRes?.fileId || '';
        const resolvedWebLink =
          finalWebViewLink ||
          chunkRes?.webViewLink ||
          chunkRes?.playbackUrl ||
          (resolvedFileId ? `https://drive.google.com/file/d/${resolvedFileId}/preview` : '');

        currentItem.status = 'completed';
        currentItem.progress = 100;
        currentItem.stage = 'Uploaded to Google Drive';
        currentItem.error = undefined;
        currentItem.isDuplicate = false;
        currentItem.webViewLink = resolvedWebLink;
        currentItem.fileId = resolvedFileId;

        await dbPutQueue(currentItem);
        updateState({
          isProcessing: false,
          activeItemId: null,
          activeProgress: 100,
          activeStage: 'Upload completed',
        });

        notify(`✅ Successfully uploaded ${currentItem.fileName} to Google Drive!`, 'success');
        break;
      }
    }
  } catch (err: any) {
    console.error('Upload worker process error:', err);

    // Fallback verification: did the file actually make it to Google Drive despite connection error?
    let verifiedAfterError = false;
    try {
      const allItems = await dbGetAllQueue();
      const currentItem = allItems.find(
        (i) => i.id === currentState.activeItemId || i.status === 'uploading'
      );
      if (currentItem) {
        const verified = await checkDuplicate({
          orderId: currentItem.orderId,
          platform: currentItem.platform,
          recordingType: currentItem.recordingType,
        });
        if (verified && verified.fileId) {
          currentItem.status = 'completed';
          currentItem.progress = 100;
          currentItem.stage = 'Uploaded to Google Drive';
          currentItem.fileId = verified.fileId;
          currentItem.webViewLink =
            verified.webViewLink ||
            verified.playbackUrl ||
            `https://drive.google.com/file/d/${verified.fileId}/preview`;
          currentItem.error = undefined;
          currentItem.isDuplicate = false;
          await dbPutQueue(currentItem);
          verifiedAfterError = true;
          notify(`✅ Order ${currentItem.orderId} verified as uploaded to Google Drive!`, 'success');
        } else {
          currentItem.status = 'failed';
          currentItem.error = err.message || 'Upload transmission error';
          currentItem.stage = 'Upload interrupted - Ready to resume';
          await dbPutQueue(currentItem);
        }
      }
    } catch (_) {}

    updateState({
      isProcessing: false,
      activeItemId: null,
      activeProgress: 0,
      activeStage: '',
    });

    if (!verifiedAfterError) {
      notify(`⚠️ Upload error: ${err.message || 'Connection failed'}`, 'error');
    }
  } finally {
    isWorkerBusy = false;
    // AUTOMATIC SEQUENTIAL CHAIN:
    // Once one file completes (or halts), immediately pick up the next pending item in sequential FIFO order!
    setTimeout(async () => {
      try {
        const items = await dbGetAllQueue();
        const hasMorePending = items.some((i) => i.status === 'pending');
        if (hasMorePending) {
          triggerUploadWorker();
        }
      } catch (_) {}
    }, 300);
  }
}

/**
 * Initialize background upload worker and auto-sync intervals
 */
export function initUploadWorker(handler?: WorkerToastHandler): () => void {
  if (handler) {
    registerToastHandler(handler);
  }

  // Periodic small-interval sync (checks for pending items every 4 seconds)
  if (!autoSyncTimer) {
    autoSyncTimer = setInterval(() => {
      if (navigator.onLine && !isWorkerBusy) {
        triggerUploadWorker();
      }
    }, 4000);
  }

  const handleOnline = () => {
    if (!isWorkerBusy) {
      triggerUploadWorker();
    }
  };

  const handleCustomTrigger = () => {
    if (!isWorkerBusy) {
      triggerUploadWorker();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('ops_trigger_upload', handleCustomTrigger);

  // Initial kick-off
  setTimeout(() => {
    triggerUploadWorker();
  }, 1000);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('ops_trigger_upload', handleCustomTrigger);
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
  };
}

/**
 * Manually pause an item
 */
export async function pauseUploadItem(id: string): Promise<void> {
  const items = await dbGetAllQueue();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.status = 'paused';
    item.stage = 'Paused by operator';
    await dbPutQueue(item);
    window.dispatchEvent(new CustomEvent('ops_queue_updated'));
  }
}

/**
 * Resume an item
 */
export async function resumeUploadItem(id: string): Promise<void> {
  const items = await dbGetAllQueue();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.status = 'pending';
    item.error = undefined;
    item.stage = 'Queued for upload';
    await dbPutQueue(item);
    window.dispatchEvent(new CustomEvent('ops_queue_updated'));
    triggerUploadWorker();
  }
}

/**
 * Retry or Force bypass an upload item
 */
export async function retryUploadItem(id: string, bypassDuplicate = false): Promise<void> {
  const items = await dbGetAllQueue();
  const item = items.find((i) => i.id === id);
  if (item) {
    item.status = 'pending';
    item.error = undefined;
    item.isDuplicate = false;
    item.currentChunk = 0;
    item.uploadedBytes = 0;
    item.progress = 0;
    item.stage = bypassDuplicate ? 'Queued for upload (Duplicate Bypassed)' : 'Queued for upload';
    if (bypassDuplicate) {
      item.bypassDuplicate = true;
    }
    await dbPutQueue(item);
    isWorkerBusy = false;
    window.dispatchEvent(new CustomEvent('ops_queue_updated'));
    triggerUploadWorker();
  }
}

/**
 * Force bypass duplicate protection for ALL duplicate-blocked queue items
 */
export async function bypassAllDuplicates(): Promise<number> {
  const items = await dbGetAllQueue();
  let count = 0;
  for (const item of items) {
    const isDup =
      item.isDuplicate ||
      (item.status === 'failed' &&
        (item.error?.toLowerCase().includes('duplicate') ||
          item.stage?.toLowerCase().includes('duplicate')));
    if (isDup && item.blob) {
      item.status = 'pending';
      item.error = undefined;
      item.isDuplicate = false;
      item.bypassDuplicate = true;
      item.currentChunk = 0;
      item.uploadedBytes = 0;
      item.progress = 0;
      item.stage = 'Queued for upload (Duplicate Bypassed)';
      await dbPutQueue(item);
      count++;
    }
  }
  isWorkerBusy = false;
  updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
  setTimeout(() => triggerUploadWorker(), 200);
  return count;
}

/**
 * Reset local queue items that are stuck in 'uploading' or failed state back to 'pending'
 */
export async function resetStuckLocalQueue(): Promise<number> {
  const items = await dbGetAllQueue();
  let count = 0;
  for (const item of items) {
    if (item.status === 'uploading' || (item.status === 'failed' && item.blob)) {
      item.status = 'pending';
      item.stage = 'Queued for upload';
      item.error = undefined;
      item.isDuplicate = false;
      item.bypassDuplicate = true; // allow retrying
      item.currentChunk = 0;
      item.uploadedBytes = 0;
      item.progress = 0;
      await dbPutQueue(item);
      count++;
    }
  }
  isWorkerBusy = false;
  updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
  return count;
}

/**
 * Clean up all stuck local and Google Sheet upload sessions
 */
export async function fixAndCleanAllStuckUploads(options: { purgeInterrupted?: boolean } = {}): Promise<{
  localResetCount: number;
  cloudCleanedRows: number;
  message: string;
}> {
  let localResetCount = 0;
  let cloudCleanedRows = 0;

  // 1. Reset local queue
  try {
    localResetCount = await resetStuckLocalQueue();
  } catch (e) {
    console.warn('Local queue reset note:', e);
  }

  // 2. Call cloud cleanup API
  try {
    const res = await cleanupStuckUploads({ purgeInterrupted: !!options.purgeInterrupted });
    if (res && res.cleanedRows !== undefined) {
      cloudCleanedRows = res.cleanedRows;
    }
  } catch (e: any) {
    console.warn('Cloud cleanup note:', e);
  }

  // 3. Kick off upload worker cleanly
  setTimeout(() => triggerUploadWorker(), 500);

  return {
    localResetCount,
    cloudCleanedRows,
    message: options.purgeInterrupted
      ? `Purged ${cloudCleanedRows} interrupted cloud row(s) and reset ${localResetCount} local item(s).`
      : `Reset ${localResetCount} local queue item(s) and cleared ${cloudCleanedRows} stuck cloud session(s).`,
  };
}
