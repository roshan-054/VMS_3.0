import React, { useEffect, useRef, useState } from 'react';
import { Radio, Upload, Clock, AlertTriangle, CheckCircle2, Video, WifiOff } from 'lucide-react';
import { requestApi, requestAppsScript } from '../lib/api';
import { getStoredToken } from '../lib/storage';
import type { StationQueueItem, StationQueueCounts } from '../lib/stationReporter';
import type { StationActivity } from '../lib/stationActivity';
import { listStationsFromSupabase, mergeStationReports, stationSupabaseUsable } from '../lib/supabase/stations';

export interface StationReport {
  email: string;
  name: string;
  recording: boolean;
  online: boolean;
  live: boolean;
  ageMs: number;
  worker: string;
  items: StationQueueItem[];
  counts?: StationQueueCounts | null;
  activity?: StationActivity | null;
  reportedAt?: number;
}

const POLL_MS = 5000; // Apps Script
const POLL_SUPABASE_MS = 1000; // Supabase: a check costs one tiny call when nothing changed
const GAS_WITH_SUPABASE_MS = 15000; // still read Apps Script now and then for stations that fell back to it
const LIVE_MS = 45000;

/** The station's own totals; older stations that do not send them are counted from their list. */
export function stationCounts(st: StationReport): StationQueueCounts {
  if (st.counts) return st.counts;
  const c: StationQueueCounts = { waiting: 0, uploading: 0, failed: 0, duplicate: 0, completed: 0, total: st.items.length };
  for (const i of st.items) {
    if (i.status === 'pending') c.waiting++;
    else if (i.status === 'uploading') c.uploading++;
    else if (i.status === 'failed' || i.status === 'paused') c.failed++;
    else if (i.status === 'completed') c.completed++;
  }
  return c;
}

/** Puts reportedAt on this computer's clock so ages tick correctly between answers. */
function toLocal(list: any[], serverTime: number): StationReport[] {
  const now = Date.now();
  const st = Number(serverTime) || now;
  return (list || []).map((x) => {
    const reported = x.reportedAt ? Number(x.reportedAt) : st - Number(x.ageMs || 0);
    return { ...x, items: Array.isArray(x.items) ? x.items : [], reportedAt: reported - st + now };
  });
}

function withLive(list: StationReport[]): StationReport[] {
  const now = Date.now();
  return list.map((x) => {
    const ageMs = Math.max(0, now - Number(x.reportedAt || 0));
    return { ...x, ageMs, live: ageMs < LIVE_MS };
  });
}

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
 * Every station's latest report, kept fresh: Supabase checked every second when set up, Apps
 * Script every 5 s otherwise (and every 15 s alongside Supabase for stations that fell back).
 */
export function useStationReports(onStations?: (stations: StationReport[]) => void) {
  const [stations, setStations] = useState<StationReport[] | null>(null);
  const [error, setError] = useState('');
  const [viaSupabase, setViaSupabase] = useState(false);
  const onStationsRef = useRef(onStations);
  onStationsRef.current = onStations;

  useEffect(() => {
    let alive = true;
    let sbList: StationReport[] = [];
    let gasList: StationReport[] = [];
    let sbVersion = 0;
    let gasAt = 0;
    let gotAny = false;
    let timer: ReturnType<typeof setTimeout>;
    const publish = () => {
      if (!alive || !gotAny) return;
      const merged = withLive(mergeStationReports(sbList, gasList));
      setStations(merged);
      onStationsRef.current?.(merged);
    };
    const tick = async () => {
      let delay = POLL_MS;
      if (document.visibilityState === 'visible') {
        const token = getStoredToken() || '';
        let sbOk = false;
        try {
          const res = await listStationsFromSupabase(sbVersion, token, (a, p) => requestAppsScript(a, p));
          if (res) {
            sbOk = true;
            if (res.changed) {
              sbVersion = res.version;
              sbList = toLocal(res.stations || [], res.serverTime);
            }
            gotAny = true;
          }
        } catch (e: any) {
          if (alive) setError(e?.message || 'Could not load live station status.');
        }
        if (alive) setViaSupabase(sbOk);
        const gasEvery = sbOk ? GAS_WITH_SUPABASE_MS : POLL_MS;
        if (Date.now() - gasAt >= gasEvery - 50) {
          gasAt = Date.now();
          try {
            const res: any = await requestApi('getStationQueues', {});
            if (!alive) return;
            gasList = toLocal(res.stations || [], res.serverTime);
            gotAny = true;
            setError('');
          } catch (e: any) {
            if (alive && !sbOk) setError(e?.message || 'Could not load live station status.');
          }
        }
        publish();
        delay = sbOk ? POLL_SUPABASE_MS : POLL_MS;
      }
      if (alive) timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return { stations, error, viaSupabase };
}

/**
 * Admin view of every packing station's own upload queue, refreshed every 5 seconds: what is
 * uploading right now (with progress), what is waiting, and what failed (with the reason).
 */
export const LiveStationQueues: React.FC<{ onStations?: (stations: StationReport[]) => void }> = ({ onStations }) => {
  const { stations, error, viaSupabase } = useStationReports(onStations);
  const [showDone, setShowDone] = useState(false);


  const totals = (stations || []).map(stationCounts).reduce(
    (t, c) => ({ waiting: t.waiting + c.waiting, uploading: t.uploading + c.uploading, failed: t.failed + c.failed }),
    { waiting: 0, uploading: 0, failed: 0 },
  );

  return (
    <div id="live-station-queues" className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
          <h3 className="text-sm font-bold text-slate-800">Live packer stations</h3>
          <span className="text-[11px] text-slate-500" id="live-station-mode">{viaSupabase ? 'live' : 'updates every 5 s'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200" id="live-count-uploading">
            {totals.uploading} uploading
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200" id="live-count-pending">
            {totals.waiting} waiting
          </span>
          <span className="px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200" id="live-count-failed">
            {totals.failed} failed
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
          const c = stationCounts(st);
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
              <div className="flex flex-wrap gap-1 text-[10px] font-semibold" data-station-counts={`${c.waiting}/${c.uploading}/${c.failed}`}>
                <span className="px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">{c.waiting} waiting</span>
                <span className="px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">{c.uploading} uploading</span>
                <span className="px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">{c.failed} failed</span>
                {c.duplicate > 0 && <span className="px-1.5 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">{c.duplicate} duplicate</span>}
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
