import React, { useEffect, useRef, useState } from 'react';
import { Radio, Upload, Clock, AlertTriangle, CheckCircle2, Video, WifiOff } from 'lucide-react';
import { requestApi } from '../lib/api';
import type { StationQueueItem } from '../lib/stationReporter';

export interface StationReport {
  email: string;
  name: string;
  recording: boolean;
  online: boolean;
  live: boolean;
  ageMs: number;
  worker: string;
  items: StationQueueItem[];
}

const POLL_MS = 5000;

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

const STATUS_STYLE: Record<string, string> = {
  uploading: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  paused: 'bg-rose-50 text-rose-700 border-rose-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const STATUS_LABEL: Record<string, string> = {
  uploading: 'Uploading',
  pending: 'Waiting',
  failed: 'Failed',
  paused: 'Paused',
  completed: 'Uploaded',
};

/**
 * Admin view of every packing station's own upload queue, refreshed every 5 seconds: what is
 * uploading right now (with progress), what is waiting, and what failed (with the reason).
 */
export const LiveStationQueues: React.FC<{ onStations?: (stations: StationReport[]) => void }> = ({ onStations }) => {
  const [stations, setStations] = useState<StationReport[] | null>(null);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const onStationsRef = useRef(onStations);
  onStationsRef.current = onStations;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const res: any = await requestApi('getStationQueues', {});
          if (!alive) return;
          setStations(res.stations || []);
          onStationsRef.current?.(res.stations || []);
          setError('');
        } catch (e: any) {
          if (alive) setError(e?.message || 'Could not load live station status.');
        }
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const all = (stations || []).flatMap((s) => s.items.map((it) => ({ ...it, station: s })));
  const count = (st: string) => all.filter((i) => i.status === st || (st === 'failed' && i.status === 'paused')).length;

  return (
    <div id="live-station-queues" className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
          <h3 className="text-sm font-bold text-slate-800">Live packer stations</h3>
          <span className="text-[11px] text-slate-500">updates every 5 s</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200" id="live-count-uploading">
            {count('uploading')} uploading
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200" id="live-count-pending">
            {count('pending')} waiting
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200" id="live-count-failed">
            {count('failed')} failed
          </span>
          <label className="ml-1 flex items-center gap-1 text-slate-500 font-medium cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="w-3 h-3" />
            show uploaded
          </label>
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      {stations === null && !error && <p className="text-xs text-slate-500">Loading station status…</p>}
      {stations && stations.length === 0 && (
        <p className="text-xs text-slate-500">No station has reported yet. Stations report as soon as a packer is signed in.</p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(stations || []).map((st) => {
          const items = st.items.filter((i) => showDone || i.status !== 'completed');
          return (
            <div key={st.email} className="rounded-xl border border-slate-200 p-3 space-y-2 min-w-0" data-station={st.email}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{st.name || st.email}</div>
                  <div className="text-[10px] text-slate-500 truncate">{st.email}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {st.recording && st.live && (
                    <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 text-[10px] font-bold flex items-center gap-1">
                      <Video className="w-3 h-3" /> Recording
                    </span>
                  )}
                  {st.live && st.online ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Online</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold flex items-center gap-1">
                      <WifiOff className="w-3 h-3" /> Offline · {ago(st.ageMs)}
                    </span>
                  )}
                </div>
              </div>
              {st.worker && st.live && <div className="text-[10px] text-blue-700 truncate">{st.worker}</div>}
              {items.length === 0 ? (
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Nothing waiting to upload
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {items.map((it) => (
                    <li key={it.id} className="text-[11px] space-y-0.5" data-order={it.orderId} data-status={it.status}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-800 truncate">
                          {it.orderId} <span className="text-slate-400 font-normal">{it.recordingType}</span>
                        </span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 flex items-center gap-1 ${STATUS_STYLE[it.status] || STATUS_STYLE.pending}`}>
                          {it.status === 'uploading' ? <Upload className="w-3 h-3" /> : it.status === 'failed' ? <AlertTriangle className="w-3 h-3" /> : it.status === 'pending' ? <Clock className="w-3 h-3" /> : null}
                          {STATUS_LABEL[it.status] || it.status}
                          {it.status === 'uploading' ? ` ${it.progress}%` : ''}
                        </span>
                      </div>
                      {it.status === 'uploading' && (
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${it.progress}%` }} />
                        </div>
                      )}
                      {(it.status === 'failed' || it.status === 'paused') && it.error && (
                        <div className="text-rose-600 break-words">{it.error}</div>
                      )}
                      {it.status === 'pending' && it.stage && <div className="text-slate-500 truncate">{it.stage}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
