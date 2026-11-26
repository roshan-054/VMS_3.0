import React, { useEffect, useMemo, useState } from 'react';
import { Users, Radio, Video, PackageCheck, ScanLine, WifiOff, Search, RefreshCw } from 'lucide-react';
import { requestApi } from '../lib/api';
import { fmtDateTime } from '../lib/dateFormat';
import { useStationReports, stationCounts, type StationReport } from './LiveStationQueues';
import { stationSupabaseUsable } from '../lib/supabase/stations';

interface TeamUser {
  email: string;
  name: string;
  role: string;
  today: { recorded: number; returns: number; uploaded: number; uploadFailed: number; packed: number };
  lastAction: string;
  lastActionAt: number;
}

interface Row {
  key: string;
  name: string;
  email: string;
  role: string;
  station: StationReport | null;
  team: TeamUser | null;
  online: boolean;
  state: '' | 'scanning' | 'recording' | 'packing';
  lastAction: string;
  lastActionAt: number;
}

const TEAM_POLL_SUPABASE_MS = 10000; // answered from this computer's Supabase copy
const TEAM_POLL_GAS_MS = 30000; // Apps Script reads the Sheet, so less often

function isAdminRoleName(role: string): boolean {
  const r = String(role || '').toLowerCase().replace(/[\s_-]/g, '');
  return r === 'admin' || r === 'administrator' || r === 'superadmin' || r === 'masteradmin';
}

function ago(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return '';
}

function when(at: number): string {
  if (!at) return '';
  const a = ago(Date.now() - at);
  return a || fmtDateTime(new Date(at));
}

/**
 * Admins: every user's work as it happens. Who is online, what they have open, the order they are
 * scanning, recording or packing, today's totals, their upload queue and their last action.
 */
export const LiveTeam: React.FC<{ onShowToast?: (m: string, t: 'success' | 'error' | 'info') => void }> = () => {
  const { stations, error, viaSupabase } = useStationReports();
  const [team, setTeam] = useState<TeamUser[] | null>(null);
  const [teamDate, setTeamDate] = useState('');
  const [teamError, setTeamError] = useState('');
  const [teamLoading, setTeamLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [, setTick] = useState(0);

  const loadTeam = async () => {
    setTeamLoading(true);
    try {
      const res: any = await requestApi('getTeamActivity', {});
      if (!res?.success) throw new Error(res?.error || 'Could not load today\'s work.');
      setTeam(res.users || []);
      setTeamDate(res.date || '');
      setTeamError('');
    } catch (e: any) {
      setTeamError(/Unknown action/i.test(e?.message || '') ? "Today's totals appear after the live backend is updated." : e?.message || "Could not load today's work.");
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === 'visible') await loadTeam();
      if (alive) timer = setTimeout(run, stationSupabaseUsable() ? TEAM_POLL_SUPABASE_MS : TEAM_POLL_GAS_MS);
    };
    run();
    const t = setInterval(() => setTick((n) => n + 1), 1000); // keeps "12s ago" moving
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(t);
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>();
    for (const u of team || []) {
      const k = u.email.toLowerCase();
      by.set(k, { key: k, name: u.name, email: u.email, role: u.role, station: null, team: u, online: false, state: '', lastAction: u.lastAction, lastActionAt: u.lastActionAt });
    }
    for (const st of stations || []) {
      const k = String(st.email || '').toLowerCase();
      const row = by.get(k) || { key: k, name: st.name || st.email, email: st.email, role: '', station: null, team: null, online: false, state: '' as Row['state'], lastAction: '', lastActionAt: 0 };
      row.station = st;
      row.online = !!(st.live && st.online);
      const act = st.activity;
      if (row.online) row.state = st.recording ? 'recording' : (act?.state || '');
      if (act?.lastActionAt && act.lastActionAt > row.lastActionAt) {
        row.lastAction = act.lastAction;
        row.lastActionAt = act.lastActionAt;
      }
      by.set(k, row);
    }
    // Only packer accounts (role User): Admin and Super Admin are not shown, and a station is
    // shown only once the user list confirms it belongs to a packer.
    for (const [k, row] of by) {
      if (!row.team || isAdminRoleName(row.role)) by.delete(k);
    }
    const rank = (r: Row) => (r.state === 'recording' ? 0 : r.state === 'packing' ? 1 : r.online ? 2 : 3);
    return Array.from(by.values()).sort((a, b) => rank(a) - rank(b) || (b.lastActionAt - a.lastActionAt) || a.name.localeCompare(b.name));
  }, [team, stations]);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyOnline || r.online) && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.station?.activity?.orderId || '').toLowerCase().includes(q)));
  const sum = rows.reduce(
    (t, r) => {
      const c = r.station ? stationCounts(r.station) : null;
      return {
        online: t.online + (r.online ? 1 : 0),
        recording: t.recording + (r.state === 'recording' ? 1 : 0),
        recorded: t.recorded + (r.team ? r.team.today.recorded + r.team.today.returns : 0),
        uploaded: t.uploaded + (r.team?.today.uploaded || 0),
        packed: t.packed + (r.team?.today.packed || 0),
        waiting: t.waiting + (c ? c.waiting + c.uploading : 0),
        failed: t.failed + (c?.failed || 0),
      };
    },
    { online: 0, recording: 0, recorded: 0, uploaded: 0, packed: 0, waiting: 0, failed: 0 },
  );

  const Stat = ({ id, label, value, tone }: { id: string; label: string; value: number; tone: string }) => (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="text-[11px] font-semibold opacity-80">{label}</div>
      <div id={id} className="text-xl font-bold">{value.toLocaleString()}</div>
    </div>
  );

  return (
    <div id="live-team" className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Live Team <span className="text-xs font-semibold text-slate-500">· packers</span></h2>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                <span id="live-team-mode">{viaSupabase ? 'Live' : 'Updates every 5 s'}</span>
                {teamDate && <span>· today's totals for {fmtDateTime(new Date(teamDate + 'T12:00:00')).split(' ')[0]}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input id="live-team-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email or order"
                className="pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg w-52" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} /> Online only
            </label>
            <button type="button" onClick={loadTeam} disabled={teamLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${teamLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <Stat id="team-online" label="Online now" value={sum.online} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
          <Stat id="team-recording" label="Recording now" value={sum.recording} tone="bg-red-50 border-red-200 text-red-700" />
          <Stat id="team-recorded" label="Recorded today" value={sum.recorded} tone="bg-slate-50 border-slate-200 text-slate-800" />
          <Stat id="team-uploaded" label="Uploaded today" value={sum.uploaded} tone="bg-blue-50 border-blue-200 text-blue-800" />
          <Stat id="team-packed" label="Packed today" value={sum.packed} tone="bg-indigo-50 border-indigo-200 text-indigo-800" />
          <Stat id="team-waiting" label="Waiting to upload" value={sum.waiting} tone="bg-amber-50 border-amber-200 text-amber-800" />
          <Stat id="team-failed" label="Failed uploads" value={sum.failed} tone="bg-rose-50 border-rose-200 text-rose-700" />
        </div>
        {(error || teamError) && <p className="text-xs text-rose-600">{teamError || error}</p>}
      </div>

      {team === null && stations === null && <p className="text-sm text-slate-500 px-1">Loading the team…</p>}
      {team !== null && shown.length === 0 && <p className="text-sm text-slate-500 px-1">{rows.length ? 'No packer matches.' : 'No packer accounts yet.'}</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const c = r.station ? stationCounts(r.station) : null;
          const act = r.station?.activity;
          const order = r.online ? act?.orderId || '' : '';
          return (
            <div key={r.key} data-user={r.email.toLowerCase()} data-state={r.state || (r.online ? 'online' : 'offline')}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-4 space-y-3 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{r.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{r.email}{r.role ? ` · ${r.role}` : ''}</div>
                </div>
                {r.state === 'recording' ? (
                  <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 text-[11px] font-bold flex items-center gap-1 shrink-0">
                    <Video className="w-3 h-3" /> Recording
                  </span>
                ) : r.state === 'packing' ? (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold flex items-center gap-1 shrink-0">
                    <PackageCheck className="w-3 h-3" /> Packing
                  </span>
                ) : r.online ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold shrink-0">Online</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[11px] font-bold flex items-center gap-1 shrink-0">
                    <WifiOff className="w-3 h-3" /> {r.station ? `Offline · ${when(Date.now() - r.station.ageMs)}` : 'Offline'}
                  </span>
                )}
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs" data-now>
                {r.online ? (
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-700">
                    <span className="text-slate-500">On</span>
                    <b data-page>{act?.page || '—'}</b>
                    {order && (
                      <>
                        <span className="text-slate-400">·</span>
                        {r.state !== 'recording' && r.state !== 'packing' && <ScanLine className="w-3.5 h-3.5 text-slate-500" />}
                        <span className="text-slate-500">{r.state === 'recording' ? 'recording' : r.state === 'packing' ? 'packing' : 'scanning'}</span>
                        <b className="font-mono" data-order>{order}</b>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-500">Not signed in on any computer right now</span>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-center" data-today={r.team ? `${r.team.today.recorded}/${r.team.today.uploaded}/${r.team.today.packed}` : ''}>
                {[
                  ['Recorded', r.team ? r.team.today.recorded + r.team.today.returns : null],
                  ['Uploaded', r.team ? r.team.today.uploaded : null],
                  ['Packed', r.team ? r.team.today.packed : null],
                  ['Failed', r.team ? r.team.today.uploadFailed : null],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-lg border border-slate-100 py-1.5">
                    <div className="text-sm font-bold text-slate-900">{v === null ? '—' : String(v)}</div>
                    <div className="text-[10px] text-slate-500">{label} today</div>
                  </div>
                ))}
              </div>

              {c && (
                <div className="flex flex-wrap gap-1 text-[10px] font-semibold" data-station-counts={`${c.waiting}/${c.uploading}/${c.failed}`}>
                  <span className="text-slate-500 font-medium mr-0.5">Upload queue:</span>
                  <span className="px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">{c.waiting} waiting</span>
                  <span className="px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">{c.uploading} uploading</span>
                  <span className="px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">{c.failed} failed</span>
                </div>
              )}

              <div className="text-[11px] text-slate-600 truncate" data-last>
                {r.lastAction ? (
                  <>Last: <b className="text-slate-800">{r.lastAction}</b> · {when(r.lastActionAt)}</>
                ) : (
                  <span className="text-slate-400">No activity recorded yet</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
