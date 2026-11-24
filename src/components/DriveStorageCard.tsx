import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { requestApi } from '../lib/api';

export interface DriveStorageStatus {
  account: { used: number; limit: number; free: number; unlimited: boolean; percent: number; error?: string };
  videos: { count: number; bytes: number; monthBytes: number; monthCount: number; last7Bytes: number; unknownSize: number };
  byPlatform: { platform: string; bytes: number }[];
  perDayBytes: number;
  daysLeft: number;
  folder: { id: string; name: string; url: string };
  checkedAt: string;
  cached?: boolean;
}

export function formatBytes(n: number): string {
  if (!(n >= 0)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Admin card: how much Google Drive space is used, and how much of it is VMS videos. */
export const DriveStorageCard: React.FC = () => {
  const [data, setData] = useState<DriveStorageStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      const res: any = await requestApi('getDriveStorage', refresh ? { refresh: true } : {});
      if (res && res.success === false) throw new Error(res.error || 'Could not read Drive storage.');
      setData(res as DriveStorageStatus);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not read Drive storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const acc = data?.account;
  const pct = acc && !acc.unlimited && acc.percent >= 0 ? Math.min(100, acc.percent) : -1;
  const videoPct = acc && !acc.unlimited && acc.limit > 0 && data ? Math.min(100, (data.videos.bytes / acc.limit) * 100) : -1;
  const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-600';

  return (
    <div id="drive-storage-card" className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-600" />
          <h3 className="text-sm font-bold text-slate-800">Google Drive storage</h3>
          {data && (
            <span className="text-[11px] text-slate-500">
              checked {new Date(data.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
        </div>
        <button
          id="drive-storage-refresh"
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Reading Drive storage…</p>}

      {data && acc && (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-lg font-bold text-slate-900" id="drive-storage-used">
                {formatBytes(acc.used)}
                <span className="text-xs font-semibold text-slate-500">
                  {acc.unlimited ? ' used (no fixed limit on this account)' : ` of ${formatBytes(acc.limit)} used`}
                </span>
              </div>
              {pct >= 0 && (
                <span
                  id="drive-storage-percent"
                  className={`text-xs font-bold ${pct >= 90 ? 'text-rose-600' : pct >= 75 ? 'text-amber-600' : 'text-slate-700'}`}
                >
                  {acc.percent}%
                </span>
              )}
            </div>
            {pct >= 0 && (
              <div className="relative h-2.5 rounded-full bg-slate-100 overflow-hidden" title="Dark part: VMS videos">
                <div className={`absolute inset-y-0 left-0 ${barColor} opacity-40`} style={{ width: `${pct}%` }} />
                {videoPct >= 0 && <div className={`absolute inset-y-0 left-0 ${barColor}`} style={{ width: `${videoPct}%` }} />}
              </div>
            )}
            {acc.error && <p className="text-[11px] text-amber-600">Account quota unavailable: {acc.error}</p>}
            {pct >= 90 && (
              <p className="flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                <AlertTriangle className="w-3 h-3" /> Drive is almost full. Uploads will fail when it is full.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat id="drive-storage-videos" label="VMS videos" value={formatBytes(data.videos.bytes)} sub={`${data.videos.count} videos`} />
            <Stat label="This month" value={formatBytes(data.videos.monthBytes)} sub={`${data.videos.monthCount} videos`} />
            <Stat label="Free" value={acc.unlimited ? 'No limit' : formatBytes(acc.free)} sub={`~${formatBytes(data.perDayBytes)} / day lately`} />
            <Stat
              id="drive-storage-days-left"
              label="Full in"
              value={data.daysLeft >= 0 ? `~${data.daysLeft} days` : '—'}
              sub="at the last 7 days' pace"
            />
          </div>

          {data.byPlatform.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {data.byPlatform.map((p) => (
                <span key={p.platform} className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700">
                  {p.platform}: <b>{formatBytes(p.bytes)}</b>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              VMS video sizes come from OrderLog and ReturnLog
              {data.videos.unknownSize > 0 ? ` (${data.videos.unknownSize} videos have no size recorded)` : ''}.
            </span>
            {data.folder.url && (
              <a
                href={data.folder.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-semibold text-blue-600 hover:underline"
              >
                Open {data.folder.name || 'video folder'} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ id?: string; label: string; value: string; sub: string }> = ({ id, label, value, sub }) => (
  <div className="rounded-xl border border-slate-200 p-2.5 min-w-0" id={id}>
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-sm font-bold text-slate-900 truncate">{value}</div>
    <div className="text-[10px] text-slate-500 truncate">{sub}</div>
  </div>
);
