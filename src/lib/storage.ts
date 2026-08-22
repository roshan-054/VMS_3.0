import { QueueItem } from '../types';

const DB_NAME = 'OrderPackingVideoSystemCleanDB';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

export function getStoredApiUrl(): string {
  let url = (
    localStorage.getItem('ops_api_url') ||
    'https://script.google.com/macros/s/AKfycbwZFm2t3o2vLFC7blM1AOzmgDMxB0UiZ_scWkLYasPGn7iB9XPoCCIi3mggjObpaMP_/exec'
  ).trim();

  // Automatically fix any versioned deployment URLs (e.g. ending in /1, /2) to use /exec
  if (url.includes('/macros/s/') && /\/\d+\/?$/.test(url)) {
    url = url.replace(/\/\d+\/?$/, '/exec');
    localStorage.setItem('ops_api_url', url);
  }
  return url;
}

export function setStoredApiUrl(url: string): void {
  let cleaned = url.trim();
  if (cleaned.includes('/macros/s/') && /\/\d+\/?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+\/?$/, '/exec');
  }
  localStorage.setItem('ops_api_url', cleaned);
}

export function getStoredDriveFolderId(): string {
  return localStorage.getItem('ops_drive_folder_id') || '1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA';
}

export function setStoredDriveFolderId(folderId: string): void {
  localStorage.setItem('ops_drive_folder_id', folderId.trim());
}

export const DEFAULT_CHUNK_SIZE_MB = 8;
export const DEFAULT_CHUNK_SIZE_BYTES = DEFAULT_CHUNK_SIZE_MB * 1024 * 1024; // 8 MB

export function getStoredChunkSize(): number {
  const stored = localStorage.getItem('ops_upload_chunk_size_mb');
  if (stored) {
    const parsedMb = parseFloat(stored);
    if (!isNaN(parsedMb) && parsedMb > 0) {
      return parsedMb * 1024 * 1024;
    }
  }
  return DEFAULT_CHUNK_SIZE_BYTES;
}

export function getStoredChunkSizeMb(): number {
  const stored = localStorage.getItem('ops_upload_chunk_size_mb');
  if (stored) {
    const parsedMb = parseFloat(stored);
    if (!isNaN(parsedMb) && parsedMb > 0) {
      return parsedMb;
    }
  }
  return DEFAULT_CHUNK_SIZE_MB;
}

export function setStoredChunkSizeMb(sizeMb: number): void {
  localStorage.setItem('ops_upload_chunk_size_mb', String(sizeMb));
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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbPutQueue(item: QueueItem): Promise<QueueItem> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
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

export async function dbDeleteQueueItem(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
