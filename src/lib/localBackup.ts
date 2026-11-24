/**
 * Local backup of every recording on the packing station's own disk.
 *
 * If the station has picked a backup folder (Chrome/Edge File System Access API), each video is
 * written into the same folder structure used on Google Drive:
 *   <chosen folder>/VMS_Packing_Videos/<Platform>/<Type>/<MMM-YYYY>/<YYYY-MM-DD>/<OrderID>_<Platform>_<Type>.mp4
 * Otherwise (or if permission was withdrawn) it falls back to a normal browser download.
 */
const DB = 'vms_local_backup';
const STORE = 'handles';
const KEY = 'root';
export const ROOT_FOLDER_NAME = 'VMS_Packing_Videos';

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export function supportsFolderBackup(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getBackupFolder(): Promise<DirHandle | null> {
  try {
    return ((await idb<DirHandle | undefined>('readonly', (s) => s.get(KEY))) as DirHandle) || null;
  } catch {
    return null;
  }
}

export async function setBackupFolder(handle: FileSystemDirectoryHandle | null): Promise<void> {
  await idb('readwrite', (s) => (handle ? s.put(handle, KEY) : s.delete(KEY)));
  window.dispatchEvent(new CustomEvent('vms_local_backup_changed'));
}

export async function chooseBackupFolder(): Promise<DirHandle | null> {
  if (!supportsFolderBackup()) return null;
  const handle: DirHandle = await (window as any).showDirectoryPicker({ id: 'vms-backup', mode: 'readwrite' });
  await setBackupFolder(handle);
  return handle;
}

export async function backupFolderPermission(handle: DirHandle | null, request = false): Promise<PermissionState | 'none'> {
  if (!handle) return 'none';
  try {
    const q = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (q === 'granted' || !request || !handle.requestPermission) return q;
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Call from a click/keypress (user gesture) so Chrome can re-grant access after a browser restart. */
export async function ensureBackupPermission(): Promise<void> {
  const h = await getBackupFolder();
  if (h) await backupFolderPermission(h, true);
}

const safe = (s: string) => String(s || '').replace(/[\\/:*?"<>|#%{}[\]]/g, '_').trim() || 'Unknown';

/** Same folder names as the Drive upload (backend dateFolder_): Platform / Type / MMM-YYYY / YYYY-MM-DD */
export function backupPathParts(platform: string, recordingType: string, recordingDate: string): string[] {
  const [y, m, d] = recordingDate.split('-').map(Number);
  const month = new Date(y, (m || 1) - 1, d || 1).toLocaleString('en-US', { month: 'short' });
  return [ROOT_FOLDER_NAME, safe(platform), safe(recordingType || 'Forward'), `${month}-${y}`, recordingDate];
}

async function uniqueName(dir: FileSystemDirectoryHandle, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? fileName : `${base}_${i}${ext}`;
    try {
      await dir.getFileHandle(name);
    } catch {
      return name; // does not exist yet
    }
  }
  return `${base}_${Date.now()}${ext}`;
}

function browserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export interface LocalSaveResult {
  method: 'folder' | 'download';
  path: string;
}

export async function saveRecordingLocally(
  blob: Blob,
  meta: { fileName: string; platform: string; recordingType: string; recordingDate: string },
  rootOverride?: FileSystemDirectoryHandle | null
): Promise<LocalSaveResult> {
  const root = (rootOverride as DirHandle) || (await getBackupFolder());
  if (root && (await backupFolderPermission(root)) === 'granted') {
    try {
      let dir: FileSystemDirectoryHandle = root;
      const parts = backupPathParts(meta.platform, meta.recordingType, meta.recordingDate);
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const name = await uniqueName(dir, meta.fileName);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await (fh as any).createWritable();
      await w.write(blob);
      await w.close();
      return { method: 'folder', path: [root.name, ...parts, name].join('/') };
    } catch (err) {
      console.warn('Saving to the backup folder failed, downloading instead:', err);
    }
  }
  browserDownload(blob, meta.fileName);
  return { method: 'download', path: `Downloads/${meta.fileName}` };
}
