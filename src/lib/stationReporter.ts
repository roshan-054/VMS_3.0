/**
 * Reports this station's upload queue to the backend so admins see, in real time, what every
 * packer's computer is uploading, waiting to upload, or failed to upload (with the error).
 * The video data itself is never sent, only a short status line per video.
 */
import { requestApi, requestAppsScript } from './api';
import { dbGetAllQueue, getStoredToken } from './storage';
import { reportStationToSupabase, stationSupabaseUsable } from './supabase/stations';
import { getRecordingInProgress, getWorkerStatus, subscribeWorkerStatus } from './uploadWorker';
import type { QueueItem } from '../types';

const HEARTBEAT_MS = 20000; // keeps the station shown as online (server: offline after 45 s)
const MIN_GAP_MS = 3000; // Apps Script: at most one report every 3 s while uploads are moving
const MIN_GAP_SUPABASE_MS = 1000; // Supabase answers in ~50 ms, so report changes within a second
const RECENT_DONE_MS = 15 * 60 * 1000; // completed videos stay listed for 15 minutes

export interface StationQueueItem {
  id: string;
  orderId: string;
  platform: string;
  recordingType: string;
  fileName: string;
  fileSize: number;
  status: string;
  progress: number;
  stage: string;
  error: string;
  createdAt: number;
  uploadId: string;
  fileId: string;
}

export { queueCounts, type StationQueueCounts } from './queueCounts';
import { queueCounts } from './queueCounts';

export function summarizeQueue(items: QueueItem[], now = Date.now()): StationQueueItem[] {
  return items
    .filter((it) => it.status !== 'completed' || now - (it.createdAt || 0) < RECENT_DONE_MS)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 200)
    .map((it) => ({
      id: it.id,
      orderId: it.orderId,
      platform: it.platform,
      recordingType: it.recordingType,
      fileName: it.fileName,
      fileSize: it.fileSize || it.blob?.size || 0,
      status: it.status,
      progress: Math.round(it.progress || 0),
      stage: it.stage || '',
      error: it.error || '',
      createdAt: it.createdAt || 0,
      uploadId: it.uploadId || '',
      fileId: it.fileId || '',
    }));
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSentAt = 0;
let lastPayload = '';
let sending = false;
let stopped = true;

async function sendNow(): Promise<void> {
  if (sending || stopped) return;
  sending = true;
  try {
    const all = await dbGetAllQueue();
    const items = summarizeQueue(all);
    const payload = {
      items,
      counts: queueCounts(all),
      recording: getRecordingInProgress(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      worker: getWorkerStatus().activeStage || '',
    };
    const key = JSON.stringify(payload);
    if (key === lastPayload && Date.now() - lastSentAt < HEARTBEAT_MS) return;
    const token = getStoredToken() || '';
    const viaSupabase = await reportStationToSupabase(payload, token, (a, p) => requestAppsScript(a, p));
    if (!viaSupabase) await requestApi('reportStationQueue', payload);
    lastPayload = key;
    lastSentAt = Date.now();
  } catch {
    /* offline or old backend: try again on the next tick */
  } finally {
    sending = false;
  }
}

function schedule(delay: number) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    await sendNow();
    schedule(HEARTBEAT_MS);
  }, delay);
}

/** Starts reporting for the signed-in user; returns a stop function. */
export function startStationReporter(): () => void {
  stopped = false;
  lastPayload = '';
  const onChange = () => schedule(Math.max(0, (stationSupabaseUsable() ? MIN_GAP_SUPABASE_MS : MIN_GAP_MS) - (Date.now() - lastSentAt)));
  window.addEventListener('ops_queue_updated', onChange);
  window.addEventListener('ops_upload_finished', onChange);
  const unsub = subscribeWorkerStatus(onChange);
  schedule(1000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    window.removeEventListener('ops_queue_updated', onChange);
    window.removeEventListener('ops_upload_finished', onChange);
    unsub();
  };
}
