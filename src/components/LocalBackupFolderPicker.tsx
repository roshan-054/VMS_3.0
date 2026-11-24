import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, HardDrive } from 'lucide-react';
import {
  backupFolderPermission,
  chooseBackupFolder,
  getBackupFolder,
  setBackupFolder,
  supportsFolderBackup,
} from '../lib/localBackup';

/** Lets a packing station choose the local folder where every recording is saved. */
export const LocalBackupFolderPicker: React.FC<{ onShowToast: (m: string, t?: 'info' | 'success' | 'error') => void }> = ({ onShowToast }) => {
  const [name, setName] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>('none');

  const refresh = useCallback(async () => {
    const h = await getBackupFolder();
    setName(h?.name || null);
    setPermission(await backupFolderPermission(h));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('vms_local_backup_changed', refresh);
    return () => window.removeEventListener('vms_local_backup_changed', refresh);
  }, [refresh]);

  if (!supportsFolderBackup()) {
    return <p className="text-[11px] text-slate-500">Local copy: browser Downloads folder (use Chrome or Edge to pick a backup folder).</p>;
  }

  const pick = async () => {
    try {
      const h = await chooseBackupFolder();
      if (h) onShowToast(`Recordings will be saved in "${h.name}/VMS_Packing_Videos"`, 'success');
    } catch (err: any) {
      if (err?.name !== 'AbortError') onShowToast(`Could not use that folder: ${err?.message || err}`, 'error');
    }
    refresh();
  };

  const regrant = async () => {
    const h = await getBackupFolder();
    await backupFolderPermission(h, true);
    refresh();
  };

  return (
    <div id="local-backup-folder" className="flex items-center gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200">
      <HardDrive className="w-3.5 h-3.5 shrink-0 text-slate-500" />
      <span className="truncate flex-1">
        Local copy:{' '}
        {name ? (
          <b className="font-mono">{name}/VMS_Packing_Videos</b>
        ) : (
          <span>Downloads folder</span>
        )}
        {name && permission !== 'granted' && (
          <button type="button" onClick={regrant} className="ml-1 text-amber-700 underline cursor-pointer">
            allow access
          </button>
        )}
      </span>
      <button type="button" onClick={pick} className="inline-flex items-center gap-1 text-blue-700 hover:underline cursor-pointer shrink-0">
        <FolderOpen className="w-3.5 h-3.5" />
        {name ? 'Change' : 'Choose folder'}
      </button>
      {name && (
        <button
          type="button"
          onClick={async () => {
            await setBackupFolder(null);
            refresh();
          }}
          className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
          title="Stop using this folder (save to Downloads instead)"
        >
          ✕
        </button>
      )}
    </div>
  );
};
