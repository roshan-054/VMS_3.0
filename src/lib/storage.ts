import { QueueItem } from '../types';

export const manualFileCache = new Map<string, File>();

const DB_NAME = 'OrderPackingVideoSystemCleanDB';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

export function getStoredApiUrl(): string {
  let url = (
    localStorage.getItem('ops_api_url') ||
    'https://script.google.com/macros/s/AKfycbwZFm2t3o2vLFC7blM1AOzmgDMxB0UiZ_scWkLYasPGn7iB9XPoCCIi3mggjObpaMP_/exec'
  ).trim();

  // Automatically clean and normalize any Google Apps Script URL (removing version numbers like /1, /2, /exec/1)
  if (url.includes('/macros/s/')) {
    const [baseUrl, query] = url.split('?');
    let cleanedBase = baseUrl
      .replace(/\/exec\/\d+\/?$/, '/exec')
      .replace(/\/\d+\/?$/, '/exec');
    
    if (!cleanedBase.endsWith('/exec')) {
      cleanedBase = cleanedBase.replace(/\/+$/, '') + '/exec';
    }
    
    url = query ? `${cleanedBase}?${query}` : cleanedBase;
    localStorage.setItem('ops_api_url', url);
  }
  return url;
}

export function setStoredApiUrl(url: string): void {
  let cleaned = url.trim();
  if (cleaned.includes('/macros/s/')) {
    const [baseUrl, query] = cleaned.split('?');
    let cleanedBase = baseUrl
      .replace(/\/exec\/\d+\/?$/, '/exec')
      .replace(/\/\d+\/?$/, '/exec');
    
    if (!cleanedBase.endsWith('/exec')) {
      cleanedBase = cleanedBase.replace(/\/+$/, '') + '/exec';
    }
    
    cleaned = query ? `${cleanedBase}?${query}` : cleanedBase;
  }
  localStorage.setItem('ops_api_url', cleaned);
}

export function getStoredDriveFolderId(): string {
  return localStorage.getItem('ops_drive_folder_id') || '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA';
}

export function setStoredDriveFolderId(folderId: string): void {
  localStorage.setItem('ops_drive_folder_id', folderId.trim());
}

export const DEFAULT_CHUNK_SIZE_MB = 16;
export const DEFAULT_CHUNK_SIZE_BYTES = DEFAULT_CHUNK_SIZE_MB * 1024 * 1024;

export function getCustomStoredChunkSizeMb(): number | null {
  const stored = localStorage.getItem('ops_upload_chunk_size_mb');
  if (stored !== null && stored !== '') {
    const parsedMb = parseFloat(stored);
    if (!isNaN(parsedMb) && parsedMb > 0) {
      return parsedMb;
    }
  }
  return null;
}

export function getStoredChunkSize(): number {
  const custom = getCustomStoredChunkSizeMb();
  if (custom !== null) {
    return custom * 1024 * 1024;
  }
  return DEFAULT_CHUNK_SIZE_BYTES;
}

export function getStoredChunkSizeMb(): number {
  const custom = getCustomStoredChunkSizeMb();
  if (custom !== null) {
    return custom;
  }
  return DEFAULT_CHUNK_SIZE_MB;
}

export function setStoredChunkSizeMb(sizeMb: number): void {
  localStorage.setItem('ops_upload_chunk_size_mb', String(sizeMb));
  window.dispatchEvent(new CustomEvent('ops_config_updated', { detail: { chunkSizeMb: sizeMb } }));
  window.dispatchEvent(new CustomEvent('ops_queue_updated'));
}

export function getStoredAutoUpload(): boolean {
  const val = localStorage.getItem('ops_auto_upload');
  return val === null ? true : val === 'true';
}

export function setStoredAutoUpload(enabled: boolean): void {
  localStorage.setItem('ops_auto_upload', String(enabled));
}

export function getStoredAutoResume(): boolean {
  const val = localStorage.getItem('ops_auto_resume');
  return val === null ? true : val === 'true';
}

export function setStoredAutoResume(enabled: boolean): void {
  localStorage.setItem('ops_auto_resume', String(enabled));
}

export function getStoredAutoRefreshInterval(): number {
  const stored = localStorage.getItem('ops_auto_refresh_sec');
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= 2 && parsed <= 300) {
      return parsed;
    }
  }
  return 6; // Default 6 seconds auto-refresh interval
}

export function setStoredAutoRefreshInterval(seconds: number): void {
  const clean = Math.max(2, Math.min(300, Math.round(seconds || 6)));
  localStorage.setItem('ops_auto_refresh_sec', String(clean));
}

export type DuplicatePolicy = 'strict_block' | 'admin_override' | 'warn_only';

export function getStoredDuplicatePolicy(): DuplicatePolicy {
  const p = localStorage.getItem('ops_duplicate_policy');
  if (p === 'admin_override' || p === 'warn_only' || p === 'strict_block') {
    return p;
  }
  return 'strict_block';
}

export function setStoredDuplicatePolicy(policy: DuplicatePolicy): void {
  localStorage.setItem('ops_duplicate_policy', policy);
}

export function getStoredToken(): string {
  return localStorage.getItem('ops_token') || '';
}

export function setStoredToken(token: string): void {
  if (token) {
    localStorage.setItem('ops_token', token);
  } else {
    localStorage.removeItem('ops_token');
  }
}

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      dbPromise = null;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

export async function dbPutQueue(item: QueueItem): Promise<QueueItem> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(item);

    tx.oncomplete = () => {
      resolve(item);
    };
    tx.onerror = () => {
      reject(tx.error || req.error || new Error('Failed to save item to queue database'));
    };
    tx.onabort = () => {
      reject(tx.error || new Error('Queue transaction was aborted'));
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

export async function dbGetAllQueue(): Promise<QueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGetQueueItem(id: string): Promise<QueueItem | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllApplicationCacheAndStorage(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbPromise = null;

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('ops_') || key.startsWith('vms_') || key.includes('user') || key.includes('auth'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));

  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export async function dbDeleteQueueItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}
export function getStoredMaxVideoSizeMb(): number {
  return parseInt(localStorage.getItem('ops_max_video_size_mb') || '1024', 10);
}

export function setStoredMaxVideoSizeMb(sizeMb: number): void {
  localStorage.setItem('ops_max_video_size_mb', sizeMb.toString());
}
