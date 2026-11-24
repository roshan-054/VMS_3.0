import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, FolderSync, ExternalLink, Loader2 } from 'lucide-react';
import { requestApi } from '../lib/api';
import { setStoredDriveFolderId } from '../lib/storage';

interface FolderCheck {
  success: boolean;
  folderId?: string;
  name?: string;
  url?: string;
  owner?: string;
  canWrite?: boolean;
  error?: string;
}

/**
 * Admin control for where every station's videos go on Google Drive. The folder is checked
 * (opens + this Apps Script account can add files) before it is saved centrally, and all stations
 * pick it up on their next upload. No redeploy or per-station change needed.
 */
export const DriveLocationSetting: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  onShowToast: (m: string, t?: 'info' | 'success' | 'error') => void;
}> = ({ value, onChange, disabled, onShowToast }) => {
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<FolderCheck | null>(null);

  const checkAndSave = async () => {
    const folder = value.trim();
    if (!folder) {
      onShowToast('Paste the Google Drive folder link first.', 'error');
      return;
    }
    setBusy(true);
    setCheck(null);
    try {
      const res = (await requestApi('checkDriveFolder', { folder })) as unknown as FolderCheck;
      setCheck(res);
      if (!res.success) {
        onShowToast(res.error || 'That folder cannot be used.', 'error');
        return;
      }
      const saved = (await requestApi('saveBranding', { videoDriveFolderId: res.folderId })) as any;
      if (!saved?.success) {
        onShowToast(saved?.error || 'Could not save the folder.', 'error');
        return;
      }
      setStoredDriveFolderId(res.folderId!);
      onChange(res.folderId!);
      onShowToast(`All stations will now upload videos to "${res.name}".`, 'success');
    } catch (err: any) {
      setCheck({ success: false, error: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="drive-location-setting" className="space-y-2">
      <label className="block text-xs font-semibold text-slate-700">Video storage location (Google Drive folder link or ID)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          disabled={disabled || busy}
          value={value}
          onChange={(e) => {
            setCheck(null);
            const v = e.target.value.trim();
            const m = v.match(/folders\/([a-zA-Z0-9_-]+)/);
            onChange(m ? m[1] : e.target.value);
          }}
          placeholder="https://drive.google.com/drive/folders/…"
          className="flex-1 min-w-0 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={checkAndSave}
          disabled={disabled || busy}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderSync className="w-3.5 h-3.5" />}
          Check &amp; use this folder
        </button>
      </div>

      {check && (
        <div
          role="status"
          className={`rounded-xl p-3 border text-[11px] space-y-1 ${
            check.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <p className="font-bold flex items-center gap-1.5">
            {check.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {check.success ? `Active: "${check.name}"` : 'Folder not changed'}
          </p>
          {check.error && <p>{check.error}</p>}
          {check.success && (
            <p>
              Owner: {check.owner || 'shared drive'} ·{' '}
              <a href={check.url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">
                open folder <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        All stations upload here from their next video. The folder must be shared with the Apps Script account as Editor.
      </p>
    </div>
  );
};
