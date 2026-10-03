import { QueueItem } from '../types';
import {
  dbGetAllQueue,
  dbPutQueue,
  dbDeleteQueueItem,
  getStoredDriveFolderId,
  getStoredChunkSize,
  getStoredAutoUpload,
  getStoredAutoResume,
  manualFileCache,
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
const deletedItemIds = new Set<string>();

let currentState: WorkerState = {
  isProcessing: false,
  activeItemId: null,
  activeProgress: 0,
  activeStage: '',
  activeChunk: 0,
  totalChunks: 0,
};

/**
 * Safely saves an item to IndexedDB ONLY if it has not been deleted by the user.
 * This prevents background worker tasks from resurrecting deleted items.
 */
async function safePutQueue(item: QueueItem): Promise<boolean> {
  if (!item || !item.id || deletedItemIds.has(item.id)) {
    return false;
  }
  const all = await dbGetAllQueue();
  if (!all.some((i) => i.id === item.id)) {
    return false;
  }
  await dbPutQueue(item);
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
  return true;
}

/**
 * Permanently deletes an item from local queue, aborts any active upload for it,
 * purges memory caches, and prevents resurrection.
 */
export async function deleteUploadItem(id: string): Promise<void> {
  deletedItemIds.add(id);
  manualFileCache.delete(id);

  if (currentState.activeItemId === id) {
    updateState({
      isProcessing: false,
      activeItemId: null,
      activeProgress: 0,
      activeStage: '',
      activeChunk: 0,
      totalChunks: 0,
    });
    isWorkerBusy = false;
  }

  await dbDeleteQueueItem(id);
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
}

/**
 * Permanently deletes multiple items in bulk and prevents background resurrection
 */
export async function bulkDeleteUploadItems(ids: string[]): Promise<void> {
  for (const id of ids) {
    deletedItemIds.add(id);
    manualFileCache.delete(id);
    if (currentState.activeItemId === id) {
      updateState({
        isProcessing: false,
        activeItemId: null,
        activeProgress: 0,
        activeStage: '',
        activeChunk: 0,
        totalChunks: 0,
      });
      isWorkerBusy = false;
    }
    await dbDeleteQueueItem(id);
  }
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
}

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

    // Verify if candidate has valid video data available
    const hasData =
      (candidate.blob && candidate.blob.size > 0) ||
      manualFileCache.has(candidate.id) ||
      Boolean(candidate.blob);

    if (deletedItemIds.has(candidate.id)) {
      isWorkerBusy = false;
      return;
    }

    if (!hasData) {
      candidate.status = 'failed';
      candidate.error = 'Recording video data is missing or corrupted. Please re-queue the video.';
      candidate.stage = 'Error: Video data missing';
      await safePutQueue(candidate);
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

      // 1. Check local completed queue (ONLY completed items with matching recordingType and valid web link or fileId)
      const localCompleted = allItems.find(
        (it) =>
          it.id !== currentItem.id &&
          normalizeOrderId(it.orderId) === normTarget &&
          (it.recordingType || 'Forward') === (currentItem.recordingType || 'Forward') &&
          it.status === 'completed' &&
          (it.fileId || it.webViewLink)
      );

      // 2. Check remote Google Sheet / Drive records (strictly filtered by recordingType)
      let remoteDuplicate: any = null;
      if (!localCompleted && normTarget) {
        try {
          remoteDuplicate = await checkDuplicate({
            orderId: currentItem.orderId,
            platform: currentItem.platform,
            recordingType: currentItem.recordingType || 'Forward',
          });
        } catch (e) {
          console.warn('Remote duplicate check note:', e);
        }
      }

      if (deletedItemIds.has(currentItem.id)) {
        isWorkerBusy = false;
        return;
      }

      // If remote already has a completed Drive file for this order:
      // Only treat as verified completion if this exact item was already uploaded and assigned this fileId
      if (remoteDuplicate && remoteDuplicate.fileId && remoteDuplicate.fileId.length > 5) {
        const isThisExactItem = Boolean(currentItem.fileId && currentItem.fileId === remoteDuplicate.fileId);
        if (isThisExactItem) {
          currentItem.status = 'completed';
          currentItem.progress = 100;
          currentItem.stage = 'Uploaded to Google Drive';
          currentItem.isDuplicate = false;
          currentItem.error = undefined;
          await safePutQueue(currentItem);
          updateState({
            isProcessing: false,
            activeItemId: null,
            activeProgress: 100,
            activeStage: 'Upload verified completed',
          });
          notify(`✅ Order ${currentItem.orderId} (${currentItem.recordingType}) verified in Google Drive!`, 'success');
          isWorkerBusy = false;
          setTimeout(() => triggerUploadWorker(), 200);
          return;
        }
      }

      if (localCompleted || (remoteDuplicate && (remoteDuplicate.fileId || remoteDuplicate.isDuplicate || remoteDuplicate.isInProgress))) {
        const typeLabel = currentItem.recordingType || 'Forward';
        const targetSheetName = typeLabel === 'Return' ? 'ReturnLog' : 'OrderLog';
        const isInProgressCollision = Boolean(remoteDuplicate?.isInProgress || remoteDuplicate?.status?.includes('Progress') || remoteDuplicate?.packerEmail);

        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.stage = isInProgressCollision
          ? `Collision: Order ${currentItem.orderId} currently packing by ${remoteDuplicate?.packerEmail || 'another station'}`
          : `Blocked: Duplicate ${typeLabel} (${currentItem.orderId})`;
        currentItem.error = isInProgressCollision
          ? `Duplicate Order Collision: Order "${currentItem.orderId}" is currently being packed/uploaded by ${remoteDuplicate?.packerEmail || 'another station'}. Simultaneous duplicate upload was prevented.`
          : `Duplicate Order ID: Order "${currentItem.orderId}" has already been uploaded for ${typeLabel} recording. Duplicate upload was prevented.`;
        currentItem.duplicateReason = isInProgressCollision
          ? `Active upload in progress by ${remoteDuplicate?.packerEmail || 'another station'} started at ${remoteDuplicate?.timestamp || 'just now'}.`
          : `Order ${currentItem.orderId} already exists in Google Drive / ${targetSheetName} for ${typeLabel} (Recorded: ${
              remoteDuplicate?.timestamp || (localCompleted?.createdAt ? new Date(localCompleted.createdAt).toLocaleString() : 'Previous Record')
            }).`;

        await safePutQueue(currentItem);
        updateState({
          isProcessing: false,
          activeItemId: null,
          activeProgress: 0,
          activeStage: '',
        });

        notify(
          isInProgressCollision
            ? `⚠️ Collision: Order ${currentItem.orderId} is currently being packed by ${remoteDuplicate?.packerEmail || 'another station'}. Duplicate upload prevented.`
            : `⚠️ Duplicate ${typeLabel} Order blocked: Order ${currentItem.orderId} already exists in Google Drive. Click "Bypass & Upload" if you wish to upload anyway.`,
          'error'
        );

        isWorkerBusy = false;
        // Immediately start next pending non-duplicate item in sequential pipeline
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
    }

    if (deletedItemIds.has(currentItem.id)) {
      isWorkerBusy = false;
      return;
    }

    // -------------------------------------------------------------
    // START UPLOAD PROCESS (Strict Single Active Item)
    // -------------------------------------------------------------
    currentItem.status = 'uploading';
    currentItem.isDuplicate = false;
    currentItem.stage = 'Connecting to Google Drive...';
    await safePutQueue(currentItem);

    updateState({
      isProcessing: true,
      activeItemId: currentItem.id,
      activeProgress: currentItem.progress || 0,
      activeStage: 'Connecting to Google Drive...',
    });

    // Compute accurate total size in bytes
    let realBlobOrFile: Blob | null = null;
    if (manualFileCache.has(currentItem.id)) {
      realBlobOrFile = manualFileCache.get(currentItem.id) || null;
    }
    if (!realBlobOrFile && currentItem.blob && currentItem.blob.size > 0) {
      realBlobOrFile = currentItem.blob;
    }

    const totalBytes =
      realBlobOrFile && realBlobOrFile.size > 0
        ? realBlobOrFile.size
        : (currentItem.fileSize || (currentItem.blob ? currentItem.blob.size : 0));

    if (totalBytes <= 0) {
      currentItem.status = 'failed';
      currentItem.error = 'Video file size is empty (0 bytes) or missing. Please re-queue the video.';
      currentItem.stage = 'Error: Video file empty';
      await safePutQueue(currentItem);
      isWorkerBusy = false;
      setTimeout(() => triggerUploadWorker(), 300);
      return;
    }

    // Strict Google Apps Script & Google Drive Resumable Compatibility:
    // Google Apps Script Web App POST payload limit is strictly 10 MB (10,485,760 bytes).
    // In Base64 encoding, every 3 bytes becomes 4 bytes (size increases by 33.3%).
    // 4 MB binary = 4,194,304 bytes -> 5.33 MB Base64 (+ JSON envelope ~5.35 MB).
    // This is 100% safe, well below the 10 MB limit, and conforms to Google Drive's 256 KiB alignment (16 * 256 KiB).
    // If total file size is <= 4 MB, upload in 1 single clean shot.
    // If total file size > 4 MB, stream via 4 MB chunks.
    const CHUNK_4MB = 4 * 1024 * 1024; // 4,194,304 bytes (16 * 256 KiB)
    let chunkSize: number;
    let totalChunks: number;

    if (totalBytes <= CHUNK_4MB) {
      chunkSize = totalBytes;
      totalChunks = 1;
    } else {
      chunkSize = CHUNK_4MB;
      totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));
    }
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
        createdAt: currentItem.createdAt,
      });
    } catch (startErr: any) {
      if (deletedItemIds.has(currentItem.id)) {
        isWorkerBusy = false;
        return;
      }
      const errMsg = startErr?.message || String(startErr);
      if (
        errMsg.toLowerCase().includes('duplicate') ||
        errMsg.toLowerCase().includes('already exists') ||
        errMsg.toLowerCase().includes('collision') ||
        errMsg.toLowerCase().includes('currently being')
      ) {
        // Check if existing file is already verified completed in Google Drive
        try {
          const verifiedExisting = await checkDuplicate({
            orderId: currentItem.orderId,
            platform: currentItem.platform,
            recordingType: currentItem.recordingType || 'Forward',
          });
          if (verifiedExisting && verifiedExisting.fileId) {
            currentItem.status = 'completed';
            currentItem.progress = 100;
            currentItem.stage = 'Uploaded to Google Drive';
            currentItem.fileId = verifiedExisting.fileId;
            currentItem.webViewLink =
              verifiedExisting.webViewLink ||
              verifiedExisting.playbackUrl ||
              `https://drive.google.com/file/d/${verifiedExisting.fileId}/preview`;
            currentItem.isDuplicate = false;
            currentItem.error = undefined;
            await safePutQueue(currentItem);
            updateState({
              isProcessing: false,
              activeItemId: null,
              activeProgress: 100,
              activeStage: 'Upload verified in Google Drive',
            });
            notify(`✅ Order ${currentItem.orderId} verified in Google Drive!`, 'success');
            isWorkerBusy = false;
            setTimeout(() => triggerUploadWorker(), 300);
            return;
          }
        } catch (_) {}

        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.progress = 0;
        currentItem.uploadedBytes = 0;
        currentItem.currentChunk = 0;
        currentItem.stage = `Blocked: Duplicate (${currentItem.orderId})`;
        currentItem.error = errMsg;
        currentItem.duplicateReason = errMsg;
        await safePutQueue(currentItem);
        updateState({ isProcessing: false, activeItemId: null });
        notify(`⚠️ ${errMsg}`, 'error');
        isWorkerBusy = false;
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
      throw startErr;
    }

    if (deletedItemIds.has(currentItem.id)) {
      isWorkerBusy = false;
      return;
    }

    if (!startRes?.success) {
      if (startRes?.isDuplicate || startRes?.code === 'DUPLICATE_ORDER_ID') {
        if (startRes.existing?.fileId) {
          currentItem.status = 'completed';
          currentItem.progress = 100;
          currentItem.stage = 'Uploaded to Google Drive';
          currentItem.fileId = startRes.existing.fileId;
          currentItem.webViewLink =
            startRes.existing.webViewLink ||
            `https://drive.google.com/file/d/${startRes.existing.fileId}/preview`;
          currentItem.isDuplicate = false;
          currentItem.error = undefined;
          await safePutQueue(currentItem);
          updateState({
            isProcessing: false,
            activeItemId: null,
            activeProgress: 100,
            activeStage: 'Upload verified in Google Drive',
          });
          notify(`✅ Order ${currentItem.orderId} verified in Google Drive!`, 'success');
          isWorkerBusy = false;
          setTimeout(() => triggerUploadWorker(), 300);
          return;
        }

        currentItem.status = 'failed';
        currentItem.isDuplicate = true;
        currentItem.progress = 0;
        currentItem.uploadedBytes = 0;
        currentItem.currentChunk = 0;
        currentItem.stage = `Blocked: Duplicate Order ID (${currentItem.orderId})`;
        currentItem.error =
          startRes.error ||
          `Duplicate Order ID: Order "${currentItem.orderId}" already uploaded.`;
        await safePutQueue(currentItem);
        updateState({ isProcessing: false, activeItemId: null });
        notify(`⚠️ Duplicate Order ID: Order ${currentItem.orderId} already uploaded.`, 'error');
        isWorkerBusy = false;
        setTimeout(() => triggerUploadWorker(), 300);
        return;
      }
      throw new Error(startRes?.error || 'Failed to initiate Google Drive upload session.');
    }

    // -------------------------------------------------------------
    // GLOBAL 1-BY-1 CLOUD QUEUE HANDLING:
    // If another workstation is currently transmitting an upload, gracefully wait
    // and poll until the single-lane cloud slot is freed.
    // -------------------------------------------------------------
    if (startRes?.queuedInCloud) {
      currentItem.status = 'uploading';
      const activeWho = startRes.activeUploader
        ? `Station (${startRes.activeUploader.split('@')[0]})`
        : 'Another station';
      const orderWho = startRes.activeOrderId ? `Order #${startRes.activeOrderId}` : 'video';
      const waitStage = `⏳ 1-by-1 Queue: Waiting for ${activeWho} to finish ${orderWho}...`;
      currentItem.stage = waitStage;
      currentItem.progress = Math.max(currentItem.progress || 0, 5);
      await safePutQueue(currentItem);
      updateState({
        isProcessing: true,
        activeItemId: currentItem.id,
        activeProgress: currentItem.progress,
        activeStage: waitStage,
      });
      isWorkerBusy = false;
      const waitMs = Math.max(2000, Number(startRes.retryAfterMs || 3000));
      setTimeout(() => triggerUploadWorker(), waitMs);
      return;
    }

    let uploadId = startRes.uploadId;
    currentItem.uploadId = uploadId;
    currentItem.totalChunks = totalChunks;
    currentItem.chunkSize = chunkSize;
    await safePutQueue(currentItem);

    // 2. Upload Chunks Sequentially via Apps Script proxy
    let finalFileId = '';
    let finalWebViewLink = '';
    let sessionRecoveryCount = 0;
    let directUploadDisabled = false;

    for (let c = 0; c < totalChunks; c++) {
      if (deletedItemIds.has(currentItem.id)) {
        isWorkerBusy = false;
        updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
        return;
      }

      // Re-check if item was deleted or paused by user mid-stream
      const freshQueue = await dbGetAllQueue();
      const freshItem = freshQueue.find((i) => i.id === currentItem.id);
      if (!freshItem || deletedItemIds.has(currentItem.id)) {
        isWorkerBusy = false;
        updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
        return;
      }
      if (freshItem && freshItem.status === 'paused') {
        isWorkerBusy = false;
        updateState({ isProcessing: false, activeItemId: null });
        setTimeout(() => triggerUploadWorker(), 200);
        return;
      }

      const startByte = c * chunkSize;
      const endByte = Math.min(startByte + chunkSize, totalBytes);
      
      let chunkBlob: Blob | null = null;
      if (manualFileCache.has(currentItem.id)) {
        const fileFromCache = manualFileCache.get(currentItem.id)!;
        chunkBlob = fileFromCache.slice(startByte, endByte);
      } else if (currentItem.blob && currentItem.blob.size > 0) {
        chunkBlob = currentItem.blob.slice(startByte, endByte);
      }

      if (!chunkBlob || chunkBlob.size === 0) {
        currentItem.status = 'failed';
        currentItem.error = currentItem.isInMemory
          ? 'File data in memory was cleared by page reload. Please re-upload the video.'
          : 'Video data missing or unreadable. Please re-queue the video.';
        currentItem.stage = 'Error: Video data unreadable';
        await safePutQueue(currentItem);
        isWorkerBusy = false;
        triggerUploadWorker();
        return;
      }

      const isFinalChunk = c === totalChunks - 1 || endByte >= totalBytes;

      const stageDesc =
        totalChunks === 1
          ? 'Streaming video to Google Drive...'
          : `Uploading chunk ${c + 1} of ${totalChunks} (${Math.round((endByte / (1024 * 1024)) * 10) / 10} MB / ${Math.round((totalBytes / (1024 * 1024)) * 10) / 10} MB)...`;

      currentItem.currentChunk = c;
      currentItem.stage = stageDesc;
      currentItem.uploadedBytes = endByte;
      currentItem.progress = totalChunks === 1 ? 75 : Math.min(95, Math.round((endByte / totalBytes) * 100));

      await safePutQueue(currentItem);

      updateState({
        isProcessing: true,
        activeItemId: currentItem.id,
        activeProgress: currentItem.progress,
        activeStage: stageDesc,
        activeChunk: c + 1,
        totalChunks: totalChunks,
      });

      let chunkSuccess = false;
      let attempt = 0;
      const directUploadUrl = startRes?.uploadUrl || '';

      // -------------------------------------------------------------
      // Primary High-Speed Channel: Direct Google Drive Resumable Stream
      // Streams raw binary slices directly through local proxy to Google Drive (100+ Mbps, 0% CPU, no Base64 overhead)
      // -------------------------------------------------------------
      if (directUploadUrl && !directUploadDisabled) {
        while (attempt < 4 && !chunkSuccess) {
          if (deletedItemIds.has(currentItem.id)) {
            isWorkerBusy = false;
            return;
          }
          attempt++;
          try {
            let usedProxy = false;
            let proxyData: any = null;

            // 1. Try local Node.js proxy to bypass browser CORS and stream raw binary at full cloud speed
            try {
              const proxyResp = await fetch('/api/drive/resumable-chunk', {
                method: 'PUT',
                headers: {
                  'x-drive-upload-url': directUploadUrl,
                  'content-range': `bytes ${startByte}-${endByte - 1}/${totalBytes}`,
                  'content-type': currentItem.mimeType || 'video/mp4',
                },
                body: chunkBlob,
              });

              if (proxyResp && proxyResp.ok) {
                proxyData = await proxyResp.json().catch(() => null);
                if (proxyData) usedProxy = true;
              }
            } catch (proxyNetErr) {
              usedProxy = false;
            }

            if (usedProxy && proxyData) {
              // HTTP 308 = Chunk accepted, waiting for remaining chunks
              if (proxyData.success && (proxyData.driveStatus === 308 || proxyData.status === 308)) {
                chunkSuccess = true;
                if (c > 0 && c % 4 === 0 && uploadId) {
                  requestApi('heartbeatUpload', { uploadId }).catch(() => {});
                }
                break;
              }

               // HTTP 200 or 201 = Video upload fully completed by Google Drive!
              if (proxyData.success && (proxyData.driveStatus === 200 || proxyData.driveStatus === 201 || proxyData.fileId)) {
                finalFileId = proxyData.fileId || (proxyData.file && proxyData.file.id) || '';
                finalWebViewLink = `https://drive.google.com/file/d/${finalFileId}/preview`;
                chunkSuccess = true;

                // Immediately finalize Google Sheets row and release upload slot
                try {
                  const fin = await requestApi('finishUpload', {
                    uploadId: uploadId,
                    fileId: finalFileId,
                    orderId: currentItem.orderId,
                    platform: currentItem.platform,
                    recordingType: currentItem.recordingType || 'Forward',
                    fileName: currentItem.fileName,
                    fileSize: totalBytes,
                    mimeType: currentItem.mimeType,
                    source: currentItem.source || 'Automatic Recording',
                    driveFolderId: driveFolderId,
                    queueJobId: currentItem.id,
                    createdAt: currentItem.createdAt,
                  });
                  if (fin && (fin.webViewLink || fin.playbackUrl)) {
                    finalWebViewLink = fin.webViewLink || fin.playbackUrl;
                  }
                } catch (finErr) {
                  console.warn('finishUpload notice:', finErr);
                }
                break;
              }

              if (proxyData.sessionExpired || proxyData.driveStatus === 404 || proxyData.driveStatus === 410) {
                throw new Error('Google Drive upload session expired');
              }

              throw new Error(proxyData.error || `Proxy returned ${proxyData.driveStatus || proxyData.status}`);
            }

            // 2. Direct Browser PUT Fallback (if proxy unavailable)
            const driveResp = await fetch(directUploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Range': `bytes ${startByte}-${endByte - 1}/${totalBytes}`,
                'Content-Type': currentItem.mimeType || 'video/mp4',
              },
              body: chunkBlob,
            });

            // HTTP 308 = Chunk accepted, waiting for remaining chunks
            if (driveResp.status === 308) {
              chunkSuccess = true;
              break;
            }

            // HTTP 200 or 201 = Video upload fully completed by Google Drive!
            if (driveResp.status === 200 || driveResp.status === 201) {
              const driveData = await driveResp.json().catch(() => ({}));
              if (driveData && driveData.id) {
                finalFileId = driveData.id;
                finalWebViewLink = `https://drive.google.com/file/d/${driveData.id}/preview`;
                chunkSuccess = true;

                // Immediately finalize Google Sheets row and release upload slot
                try {
                  const fin = await requestApi('finishUpload', {
                    uploadId: uploadId,
                    fileId: finalFileId,
                    orderId: currentItem.orderId,
                    platform: currentItem.platform,
                    recordingType: currentItem.recordingType || 'Forward',
                    fileName: currentItem.fileName,
                    fileSize: totalBytes,
                    mimeType: currentItem.mimeType,
                    source: currentItem.source || 'Automatic Recording',
                    driveFolderId: driveFolderId,
                    queueJobId: currentItem.id,
                    createdAt: currentItem.createdAt,
                  });
                  if (fin && (fin.webViewLink || fin.playbackUrl)) {
                    finalWebViewLink = fin.webViewLink || fin.playbackUrl;
                  }
                } catch (finErr) {
                  console.warn('finishUpload notice:', finErr);
                }
                break;
              }
            }

            if (driveResp.status === 404 || driveResp.status === 410) {
              throw new Error('Google Drive upload session expired');
            }

            throw new Error(`Google Drive returned status ${driveResp.status}`);
          } catch (putErr: any) {
            console.warn(`Direct Drive PUT chunk ${c + 1} attempt ${attempt} notice:`, putErr);
            // If browser throws CORS or network error on initial chunk, smoothly disable direct channel
            // so remaining chunks stream via Apps Script proxy without 4 retries per chunk
            if (c <= 1 || attempt >= 2) {
              console.warn('Direct upload channel unavailable in browser, smoothly streaming via Apps Script...');
              directUploadDisabled = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }

      // -------------------------------------------------------------
      // Secondary Fallback Channel: Apps Script Base64 Proxy
      // -------------------------------------------------------------
      if (!chunkSuccess) {
        attempt = 0;
        const base64 = await blobToBase64(chunkBlob);
        while (attempt < 4 && !chunkSuccess) {
          if (deletedItemIds.has(currentItem.id)) {
            isWorkerBusy = false;
            return;
          }
          attempt++;
          try {
            const chunkRes: any = await requestApi('uploadChunk', {
              uploadId: uploadId,
              orderId: currentItem.orderId,
              platform: currentItem.platform,
              recordingType: currentItem.recordingType || 'Forward',
              fileName: currentItem.fileName,
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
              chunkSuccess = true;
              if (chunkRes?.fileId) {
                finalFileId = chunkRes.fileId;
                finalWebViewLink = chunkRes.webViewLink || chunkRes.playbackUrl;
              }
            } else if (chunkRes?.sessionExpired || chunkRes?.needRestart) {
              if (chunkRes?.fileId) {
                finalFileId = chunkRes.fileId;
                finalWebViewLink = chunkRes.webViewLink || chunkRes.playbackUrl;
                chunkSuccess = true;
              } else {
                throw new Error(chunkRes?.error || 'Drive upload session expired');
              }
            } else {
              throw new Error(chunkRes?.error || 'Chunk upload returned false');
            }
          } catch (cErr: any) {
            console.warn(`Upload chunk ${c + 1} attempt ${attempt} note:`, cErr);

            const errStr = String(cErr?.message || cErr || '');
            const isSessionExpired =
              errStr.toLowerCase().includes('expired') ||
              errStr.toLowerCase().includes('session') ||
              errStr.toLowerCase().includes('404') ||
              errStr.toLowerCase().includes('410');

            // CRITICAL: Always check if the video already reached Google Drive / Sheets!
            // (Happens on the final chunk when Apps Script finalizes and saves the record,
            // or when a previous attempt completed despite a client-side network glitch)
            try {
              const verified = await checkDuplicate({
                orderId: currentItem.orderId,
                platform: currentItem.platform,
                recordingType: currentItem.recordingType || 'Forward',
              });
              if (verified && verified.fileId) {
                finalFileId = verified.fileId;
                finalWebViewLink =
                  verified.webViewLink ||
                  verified.playbackUrl ||
                  `https://drive.google.com/file/d/${verified.fileId}/preview`;
                chunkSuccess = true;
                break;
              }
            } catch (_) {}

            // If session expired and not verified completed:
            if (isSessionExpired) {
              // On later chunks, do a quick retry check before assuming failed
              if (isFinalChunk) {
                await new Promise((r) => setTimeout(r, 1500));
                try {
                  const verifiedFinal = await checkDuplicate({
                    orderId: currentItem.orderId,
                    platform: currentItem.platform,
                    recordingType: currentItem.recordingType || 'Forward',
                  });
                  if (verifiedFinal && verifiedFinal.fileId) {
                    finalFileId = verifiedFinal.fileId;
                    finalWebViewLink =
                      verifiedFinal.webViewLink ||
                      verifiedFinal.playbackUrl ||
                      `https://drive.google.com/file/d/${verifiedFinal.fileId}/preview`;
                    chunkSuccess = true;
                    break;
                  }
                } catch (_) {}
              }

              // Auto-renew expired upload session and restart stream with fresh session tokens
              if (sessionRecoveryCount < 3) {
                sessionRecoveryCount++;
                console.warn(
                  `Drive upload session expired on chunk ${c + 1}. Auto-healing with fresh session tokens (${sessionRecoveryCount}/3)...`
                );
                currentItem.stage = `Auto-recovering upload session (${sessionRecoveryCount}/3)...`;
                await safePutQueue(currentItem);
                updateState({
                  isProcessing: true,
                  activeItemId: currentItem.id,
                  activeProgress: currentItem.progress,
                  activeStage: currentItem.stage,
                  activeChunk: 1,
                  totalChunks: totalChunks,
                });

                try {
                  const freshStartRes: any = await requestApi('startUpload', {
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
                    bypassDuplicate: true,
                    queueJobId: currentItem.id,
                    createdAt: currentItem.createdAt,
                  });

                  if (freshStartRes?.success && freshStartRes.uploadId) {
                    uploadId = freshStartRes.uploadId;
                    currentItem.uploadId = uploadId;
                    if (freshStartRes.uploadUrl) {
                      startRes.uploadUrl = freshStartRes.uploadUrl;
                      directUploadDisabled = false;
                    }
                    await safePutQueue(currentItem);
                    c = -1; // Restart chunk loop with fresh uploadUrl
                    chunkSuccess = true;
                    break;
                  }
                } catch (renewErr) {
                  console.warn('Session auto-renewal error:', renewErr);
                }
              }
            }

            if (attempt >= 4 && !chunkSuccess) {
              // Final fallback check before throwing:
              try {
                const lastCheck = await checkDuplicate({
                  orderId: currentItem.orderId,
                  platform: currentItem.platform,
                  recordingType: currentItem.recordingType || 'Forward',
                });
                if (lastCheck && lastCheck.fileId) {
                  finalFileId = lastCheck.fileId;
                  finalWebViewLink =
                    lastCheck.webViewLink ||
                    lastCheck.playbackUrl ||
                    `https://drive.google.com/file/d/${lastCheck.fileId}/preview`;
                  chunkSuccess = true;
                  break;
                }
              } catch (_) {}

              throw new Error(
                `Chunk ${c + 1}/${totalChunks} failed after 4 attempts: ${cErr.message || cErr}`
              );
            }
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }

      if (deletedItemIds.has(currentItem.id)) {
        isWorkerBusy = false;
        return;
      }

        // Final chunk or file ID obtained: verify Google Drive completion with multi-step proof
        if (isFinalChunk || finalFileId) {
          let resolvedFileId = finalFileId || '';
          let resolvedWebLink =
            finalWebViewLink ||
            (resolvedFileId ? `https://drive.google.com/file/d/${resolvedFileId}/preview` : '');

          // 1. If fileId missing, try finishUpload to finalize Sheets row and retrieve fileId
          if (!resolvedFileId) {
            try {
              const fin = await requestApi('finishUpload', {
                uploadId: uploadId,
                orderId: currentItem.orderId,
                platform: currentItem.platform,
                recordingType: currentItem.recordingType || 'Forward',
                fileName: currentItem.fileName,
                fileSize: totalBytes,
                mimeType: currentItem.mimeType,
                source: currentItem.source || 'Automatic Recording',
                driveFolderId: driveFolderId,
                queueJobId: currentItem.id,
                createdAt: currentItem.createdAt,
              });
              if (fin && fin.fileId) {
                resolvedFileId = fin.fileId;
                resolvedWebLink = fin.webViewLink || fin.playbackUrl || `https://drive.google.com/file/d/${fin.fileId}/preview`;
              }
            } catch (_) {}
          }

          // 2. Multi-attempt verification with checkDuplicate (polls sheet up to 3 times)
          if (!resolvedFileId) {
            for (let vAttempt = 1; vAttempt <= 3; vAttempt++) {
              try {
                const finalVerify = await checkDuplicate({
                  orderId: currentItem.orderId,
                  platform: currentItem.platform,
                  recordingType: currentItem.recordingType || 'Forward',
                });
                if (finalVerify && finalVerify.fileId) {
                  resolvedFileId = finalVerify.fileId;
                  resolvedWebLink =
                    finalVerify.webViewLink ||
                    finalVerify.playbackUrl ||
                    `https://drive.google.com/file/d/${resolvedFileId}/preview`;
                  break;
                }
              } catch (_) {}
              if (vAttempt < 3) {
                await new Promise((r) => setTimeout(r, 1200));
              }
            }
          }

          if (!resolvedWebLink && resolvedFileId) {
            resolvedWebLink = `https://drive.google.com/file/d/${resolvedFileId}/preview`;
          }

          // CRITICAL: Only mark as 100% completed if valid Google Drive fileId is confirmed!
          if (resolvedFileId && resolvedFileId.length > 5) {
            currentItem.status = 'completed';
            currentItem.progress = 100;
            currentItem.stage = 'Uploaded to Google Drive';
            currentItem.error = undefined;
            currentItem.isDuplicate = false;
            currentItem.webViewLink = resolvedWebLink;
            currentItem.fileId = resolvedFileId;

            await safePutQueue(currentItem);

            updateState({
              isProcessing: false,
              activeItemId: null,
              activeProgress: 100,
              activeStage: 'Upload completed',
            });
            window.dispatchEvent(
              new CustomEvent('ops_upload_finished', {
                detail: { orderId: currentItem.orderId, uploadId: uploadId, fileId: resolvedFileId },
              })
            );

            notify(`✅ Successfully uploaded ${currentItem.fileName} to Google Drive!`, 'success');
            break;
          } else if (!chunkSuccess) {
            throw new Error(
              `Final chunk transmission did not receive Google Drive completion confirmation. Click Resume to re-verify.`
            );
          }
        }
      }
  } catch (err: any) {
    console.error('Upload worker process error:', err);

    // Fallback verification: did the file actually make it to Google Drive despite connection error?
    let verifiedAfterError = false;
    for (let checkAttempt = 1; checkAttempt <= 3; checkAttempt++) {
      try {
        const allItems = await dbGetAllQueue();
        const currentItem = allItems.find(
          (i) => (i.id === currentState.activeItemId || i.status === 'uploading') && !deletedItemIds.has(i.id)
        );
        if (currentItem && !deletedItemIds.has(currentItem.id)) {
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
            await safePutQueue(currentItem);
            verifiedAfterError = true;
            notify(`✅ Order ${currentItem.orderId} verified as uploaded to Google Drive!`, 'success');
            break;
          }
        }
      } catch (_) {}
      if (checkAttempt < 3) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    if (!verifiedAfterError) {
      try {
        const allItems = await dbGetAllQueue();
        const currentItem = allItems.find(
          (i) => (i.id === currentState.activeItemId || i.status === 'uploading') && !deletedItemIds.has(i.id)
        );
        if (currentItem && !deletedItemIds.has(currentItem.id)) {
          currentItem.status = 'failed';
          currentItem.error = err.message || 'Upload transmission error';
          currentItem.stage = 'Upload interrupted - Ready to resume';
          await safePutQueue(currentItem);
        }
      } catch (_) {}
    }

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
        const hasMorePending = items.some((i) => i.status === 'pending' && !deletedItemIds.has(i.id));
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
  if (item && !deletedItemIds.has(id)) {
    item.status = 'paused';
    item.stage = 'Paused by operator';
    await safePutQueue(item);
  }
}

/**
 * Resume an item
 */
export async function resumeUploadItem(id: string): Promise<void> {
  const items = await dbGetAllQueue();
  const item = items.find((i) => i.id === id);
  if (item && !deletedItemIds.has(id)) {
    item.status = 'pending';
    item.error = undefined;
    item.stage = 'Queued for upload';
    await safePutQueue(item);
    triggerUploadWorker();
  }
}

/**
 * Retry or Force bypass an upload item
 */
export async function retryUploadItem(id: string, bypassDuplicate = false): Promise<void> {
  const items = await dbGetAllQueue();
  const item = items.find((i) => i.id === id);
  if (item && !deletedItemIds.has(id)) {
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
    await safePutQueue(item);
    isWorkerBusy = false;
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
    if (deletedItemIds.has(item.id)) continue;
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
      await safePutQueue(item);
      count++;
    }
  }
  isWorkerBusy = false;
  updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
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
    if (deletedItemIds.has(item.id)) continue;
    if (item.status === 'uploading' || (item.status === 'failed' && item.blob)) {
      item.status = 'pending';
      item.stage = 'Queued for upload';
      item.error = undefined;
      item.isDuplicate = false;
      item.bypassDuplicate = true; // allow retrying
      item.currentChunk = 0;
      item.uploadedBytes = 0;
      item.progress = 0;
      await safePutQueue(item);
      count++;
    }
  }
  isWorkerBusy = false;
  updateState({ isProcessing: false, activeItemId: null, activeProgress: 0, activeStage: '' });
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
