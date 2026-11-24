import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { requestApi } from '../lib/api';
import { formatVideoSizeLimit, setStoredMaxVideoSizeMb, DEFAULT_MAX_VIDEO_SIZE_MB } from '../lib/storage';

const PRESETS: { mb: number; label: string }[] = [
  { mb: 500, label: '500 MB' },
  { mb: 1024, label: '1 GB' },
  { mb: 2048, label: '2 GB' },
  { mb: 5120, label: '5 GB' },
  { mb: 0, label: 'No limit' },
];

/**
 * Admin control for the largest video a station may upload. Saved centrally on the server
 * (Branding sheet, key MaxVideoSizeMb) so every station uses the same limit, and the server
 * enforces it too. 0 = no limit (Drive's own technical cap still applies).
 */
export const VideoSizeLimitSetting: React.FC<{
  value: number;
  onChange: (mb: number) => void;
  disabled?: boolean;
  onShowToast: (m: string, t?: 'info' | 'success' | 'error') => void;
}> = ({ value, onChange, disabled, onShowToast }) => {
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<string>('');

  const save = async (mb: number) => {
    if (!Number.isFinite(mb) || mb < 0 || (mb > 0 && mb < 50) || mb > 20480) {
      onShowToast('Enter a size between 50 MB and 20480 MB (20 GB), or choose No limit.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = (await requestApi('saveBranding', { maxVideoSizeMb: mb })) as any;
      if (!res?.success) {
        onShowToast(res?.error || 'Could not save the video size limit.', 'error');
        return;
      }
      const saved = typeof res.maxVideoSizeMb === 'number' ? res.maxVideoSizeMb : mb;
      setStoredMaxVideoSizeMb(saved);
      onChange(saved);
      setCustom('');
      onShowToast(
        saved ? `Videos up to ${formatVideoSizeLimit(saved)} will upload on every station.` : 'Video size limit removed for every station.',
        'success',
      );
    } catch (err: any) {
      onShowToast(err?.message || 'Could not save the video size limit.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="video-size-limit-setting">
      <label className="block text-xs font-semibold text-slate-700 mb-2">
        Max video size per recording
        <span className="ml-2 font-normal text-slate-500">
          Now: <strong id="video-size-limit-current">{formatVideoSizeLimit(value)}</strong> (all stations)
        </span>
      </label>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.mb}
            type="button"
            data-size-mb={p.mb}
            disabled={disabled || busy}
            onClick={() => save(p.mb)}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              value === p.mb
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <span>{p.label}</span>
            {p.mb === DEFAULT_MAX_VIDEO_SIZE_MB && (
              <span className={`text-[9px] uppercase tracking-wider ${value === p.mb ? 'text-indigo-100' : 'text-indigo-600'}`}>Default</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <input
          id="video-size-limit-custom"
          type="number"
          min={50}
          max={20480}
          inputMode="numeric"
          placeholder="Custom size in MB"
          value={custom}
          disabled={disabled || busy}
          onChange={(e) => setCustom(e.target.value)}
          className="flex-1 min-w-[140px] rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
        <button
          id="video-size-limit-save"
          type="button"
          disabled={disabled || busy || !custom.trim()}
          onClick={() => save(parseInt(custom, 10))}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 text-white disabled:opacity-50 flex items-center gap-1"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        A recording above this size is still saved on the station's computer but is not uploaded. The server checks the same limit.
      </p>
    </div>
  );
};
