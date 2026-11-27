import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Radio, Video, PackageCheck, ScanLine, WifiOff, Search, RefreshCw, Clock, X } from 'lucide-react';
import { requestApi } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/dateFormat';
import { useStationReports, stationCounts, type StationReport } from './LiveStationQueues';
import { stationSupabaseUsable } from '../lib/supabase/stations';

interface TeamUser {
  email: string;
  name: string;
  role: string;
  today: { recorded: number; returns: number; uploaded: number; uploadFailed: number; packed: number };
  lastAction: string;
  lastActionAt: number;
  pendingOrders?: { orderId: string; platform: string; at: number }[];
  pendingOrderCount?: number;
  openUploads?: { orderId: string; status: string; type: string; error: string; at: number }[];
  openUploadCount?: number;
}

type Preset = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'CUSTOM';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'LAST_7_DAYS', label: 'Last 7 Days' },
  { key: 'THIS_MONTH', label: 'This Month' },
  { key: 'CUSTOM', label: 'Custom Range' },
];

/** yyyy-MM-dd on this computer's calendar. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function rangeFor(preset: Preset, customFrom: string, customTo: string, now = new Date()): { from: string; to: string } {
  const back = (n: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  if (preset === 'YESTERDAY') return { from: back(1), to: back(1) };
  if (preset === 'LAST_7_DAYS') return { from: back(6), to: back(0) };
  if (preset === 'THIS_MONTH') return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: back(0) };
  if (preset === 'CUSTOM' && customFrom) {
    const to = customTo || customFrom;
    return customFrom <= to ? { from: customFrom, to } : { from: to, to: customFrom };
  }
  return { from: back(0), to: back(0) };
}

const dayLabel = (k: string) => fmtDate(new Date(k + 'T12:00:00'));

/** Short age for the backlog: 40 min, 5 h, 3 d. */
export function ageShort(ms: number): string {
  if (!(ms > 0)) return 'now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

interface BacklogUpload { orderId: string; status: string; at: number; where: 'computer' | 'sheet'; error: string }

/** Unfinished uploads: what is still in the packer's queue, plus Sheet rows that never completed. */
export function backlogUploads(station: StationReport | null, team: TeamUser | null): BacklogUpload[] {
  const out = new Map<string, BacklogUpload>();
  for (const it of station?.items || []) {
    if (it.status !== 'pending' && it.status !== 'uploading' && it.status !== 'failed') continue;
    const k = String(it.orderId || it.id).toUpperCase();
    out.set(k, { orderId: it.orderId, status: it.status === 'pending' ? 'waiting' : it.status, at: it.createdAt || 0, where: 'computer', error: it.error || '' });
  }
  for (const u of team?.openUploads || []) {
    const k = String(u.orderId).toUpperCase();
    if (!out.has(k)) out.set(k, { orderId: u.orderId, status: String(u.status || 'pending').toLowerCase(), at: u.at, where: 'sheet', error: u.error || '' });
  }
  return Array.from(out.values()).sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** Every open order or unfinished upload of one packer, in a list that closes on an outside click. */
const OpenList: React.FC<{
  kind: 'orders' | 'uploads';
  name: string;
  orders: NonNullable<TeamUser['pendingOrders']>;
  orderTotal: number;
  uploads: BacklogUpload[];
  onClose: () => void;
}> = ({ kind, name, orders, orderTotal, uploads, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Next tick, so the click that opened the list does not close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', down);
      document.addEventListener('touchstart', down);
    }, 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const f = filter.trim().toLowerCase();
  const now = Date.now();
  const DAY = 86400000;
  const orderRows = orders.filter((o) => !f || o.orderId.toLowerCase().includes(f) || o.platform.toLowerCase().includes(f));
  const uploadRows = uploads.filter((u) => !f || u.orderId.toLowerCase().includes(f) || u.status.includes(f));
  const total = kind === 'orders' ? orderTotal : uploads.length;
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
    <div ref={ref} id="live-team-open-list" data-kind={kind} role="dialog" aria-label={kind === 'orders' ? 'Pending orders' : 'Unfinished uploads'}
      className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900 truncate">
          {name} · {total} {kind === 'orders' ? `pending order${total === 1 ? '' : 's'}` : `upload${total === 1 ? '' : 's'} not finished`}
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Close" data-close>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an order" data-filter
        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
      <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white text-slate-500">
            {kind === 'orders' ? (
              <tr><th className="text-left py-1 font-semibold">Order ID</th><th className="text-left font-semibold">Platform</th><th className="text-left font-semibold">Assigned</th><th className="text-right font-semibold">Age</th></tr>
            ) : (
              <tr><th className="text-left py-1 font-semibold">Order ID</th><th className="text-left font-semibold">Status</th><th className="text-left font-semibold">Since</th><th className="text-right font-semibold">Age</th></tr>
            )}
          </thead>
          <tbody>
            {kind === 'orders'
              ? orderRows.map((o) => (
                  <tr key={o.orderId} data-open-row={o.orderId} className={`border-t border-slate-100 ${o.at && now - o.at > DAY ? 'text-orange-800' : 'text-slate-700'}`}>
                    <td className="py-1 font-mono break-all pr-2">{o.orderId}</td>
                    <td className="pr-2">{o.platform || '—'}</td>
                    <td className="pr-2 whitespace-nowrap">{o.at ? fmtDateTime(new Date(o.at)) : '—'}</td>
                    <td className="text-right whitespace-nowrap">{o.at ? ageShort(now - o.at) : '—'}</td>
                  </tr>
                ))
              : uploadRows.map((u) => (
                  <tr key={u.orderId} data-open-row={u.orderId} title={u.error || ''} className={`border-t border-slate-100 ${u.status === 'failed' ? 'text-rose-700' : u.at && now - u.at > DAY ? 'text-orange-800' : 'text-slate-700'}`}>
                    <td className="py-1 font-mono break-all pr-2">{u.orderId}</td>
                    <td className="pr-2">{u.status}{u.where === 'sheet' ? ' (Sheet)' : ''}</td>
                    <td className="pr-2 whitespace-nowrap">{u.at ? fmtDateTime(new Date(u.at)) : '—'}</td>
                    <td className="text-right whitespace-nowrap">{u.at ? ageShort(now - u.at) : '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {(kind === 'orders' ? orderRows : uploadRows).length === 0 && <div className="text-xs text-slate-500 py-2">No order matches.</div>}
      </div>
      {kind === 'orders' && orderTotal > orders.length && (
        <div className="text-[10px] text-slate-500">Showing the oldest {orders.length} of {orderTotal}.</div>
      )}
    </div>
    </div>
  );
};

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
  const [openList, setOpenList] = useState<{ email: string; kind: 'orders' | 'uploads' } | null>(null);
  const closeList = React.useCallback(() => setOpenList(null), []);
  // The buttons that open the list toggle it themselves; they must not count as an outside click.
  const keepOpen = (e: React.SyntheticEvent) => e.stopPropagation();
  const toggleList = (email: string, kind: 'orders' | 'uploads') =>
    setOpenList((o) => (o && o.email === email && o.kind === kind ? null : { email, kind }));
  const [, setTick] = useState(0);
  const [preset, setPreset] = useState<Preset>('TODAY');
  const [customFrom, setCustomFrom] = useState(() => dayKey(new Date()));
  const [customTo, setCustomTo] = useState(() => dayKey(new Date()));
  const range = rangeFor(preset, customFrom, customTo);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [teamRange, setTeamRange] = useState<{ from: string; to: string } | null>(null);
  const loadSeq = useRef(0);

  const loadTeam = async () => {
    const seq = ++loadSeq.current;
    const want = rangeRef.current;
    setTeamLoading(true);
    try {
      const res: any = await requestApi('getTeamActivity', { from: want.from, to: want.to });
      if (seq !== loadSeq.current) return; // the range changed while this was loading
      if (!res?.success) throw new Error(res?.error || 'Could not load the team\'s work.');
      setTeam(res.users || []);
      setTeamDate(res.date || '');
      setTeamRange({ from: res.from || want.from, to: res.to || want.to });
      setTeamError('');
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setTeamError(/Unknown action/i.test(e?.message || '') ? "Today's totals appear after the live backend is updated." : e?.message || "Could not load today's work.");
    } finally {
      if (seq === loadSeq.current) setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (teamRange && (teamRange.from !== range.from || teamRange.to !== range.to)) loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const shownRange = teamRange || range;
  const rangeWord =
    preset === 'TODAY' ? 'today' : preset === 'YESTERDAY' ? 'yesterday' : preset === 'LAST_7_DAYS' ? 'last 7 days' : preset === 'THIS_MONTH' ? 'this month' : 'in range';
  const rangeText = shownRange.from === shownRange.to ? dayLabel(shownRange.from) : `${dayLabel(shownRange.from)} to ${dayLabel(shownRange.to)}`;

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
        pending: t.pending + (r.team?.pendingOrderCount ?? r.team?.pendingOrders?.length ?? 0),
      };
    },
    { online: 0, recording: 0, recorded: 0, uploaded: 0, packed: 0, waiting: 0, failed: 0, pending: 0 },
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
                {teamDate && <span id="live-team-range-text">· totals for {rangeText}</span>}
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
            <div id="live-team-range" className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 flex-wrap">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" data-preset={p.key} onClick={() => setPreset(p.key)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                    preset === p.key ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'CUSTOM' && (
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 p-1 rounded-xl">
                <input id="live-team-from" type="date" value={customFrom} max={dayKey(new Date())} onChange={(e) => setCustomFrom(e.target.value)} title="Start Date"
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer" />
                <span className="text-xs text-slate-400 font-bold">to</span>
                <input id="live-team-to" type="date" value={customTo} max={dayKey(new Date())} onChange={(e) => setCustomTo(e.target.value)} title="End Date"
                  className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer" />
              </div>
            )}
            <button type="button" onClick={loadTeam} disabled={teamLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${teamLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <Stat id="team-online" label="Online now" value={sum.online} tone="bg-emerald-50 border-emerald-200 text-emerald-800" />
          <Stat id="team-recording" label="Recording now" value={sum.recording} tone="bg-red-50 border-red-200 text-red-700" />
          <Stat id="team-recorded" label={`Recorded ${rangeWord}`} value={sum.recorded} tone="bg-slate-50 border-slate-200 text-slate-800" />
          <Stat id="team-uploaded" label={`Uploaded ${rangeWord}`} value={sum.uploaded} tone="bg-blue-50 border-blue-200 text-blue-800" />
          <Stat id="team-packed" label={`Packed ${rangeWord}`} value={sum.packed} tone="bg-indigo-50 border-indigo-200 text-indigo-800" />
          <Stat id="team-waiting" label="Waiting to upload" value={sum.waiting} tone="bg-amber-50 border-amber-200 text-amber-800" />
          <Stat id="team-failed" label="Failed uploads" value={sum.failed} tone="bg-rose-50 border-rose-200 text-rose-700" />
          <Stat id="team-pending" label="Pending orders" value={sum.pending} tone="bg-orange-50 border-orange-200 text-orange-800" />
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
          const ups = backlogUploads(r.station, r.team);
          const pend = r.team?.pendingOrders || [];
          const pendCount = r.team?.pendingOrderCount ?? pend.length;
          const DAY = 86400000;
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
                    <div className="text-[10px] text-slate-500">{label} {rangeWord}</div>
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

              <div className="relative">
              <div className="rounded-xl border border-orange-100 bg-orange-50/40 px-3 py-2 space-y-1.5 text-[11px]" data-backlog
                data-backlog-orders={pendCount} data-backlog-uploads={ups.length}>
                <div className="flex items-center gap-1 font-semibold text-slate-700">
                  <Clock className="w-3.5 h-3.5 text-orange-600" /> Still open
                  <span className="text-slate-400 font-normal">· any date</span>
                </div>
                {pendCount === 0 && ups.length === 0 ? (
                  <div className="text-slate-500">Nothing pending</div>
                ) : (
                  <>
                    {pendCount > 0 && (
                      <div data-backlog-pending>
                        <button type="button" data-open-orders onMouseDown={keepOpen} onTouchStart={keepOpen} onClick={() => toggleList(r.key, 'orders')} title="See every pending order"
                          className="text-slate-700 font-semibold underline decoration-dotted underline-offset-2 hover:text-indigo-700 cursor-pointer">
                          {pendCount} pending order{pendCount === 1 ? '' : 's'}
                        </button>
                        {pend[0]?.at > 0 && <span className="text-slate-500"> · oldest {ageShort(Date.now() - pend[0].at)}</span>}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {pend.slice(0, 4).map((o) => {
                            const old = o.at > 0 && Date.now() - o.at > DAY;
                            return (
                              <span key={o.orderId} data-backlog-item={o.orderId} title={o.at ? `Assigned ${fmtDateTime(new Date(o.at))}` : ''}
                                className={`px-1.5 py-0.5 rounded border font-mono ${old ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-white text-slate-700 border-slate-200'}`}>
                                {o.orderId}{o.at ? ` · ${ageShort(Date.now() - o.at)}` : ''}
                              </span>
                            );
                          })}
                          {pendCount > 4 && (
                            <button type="button" data-more-orders onMouseDown={keepOpen} onTouchStart={keepOpen} onClick={() => toggleList(r.key, 'orders')}
                              className="px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100 cursor-pointer">
                              +{pendCount - 4} more
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {ups.length > 0 && (
                      <div data-backlog-upload-list>
                        <button type="button" data-open-uploads onMouseDown={keepOpen} onTouchStart={keepOpen} onClick={() => toggleList(r.key, 'uploads')} title="See every unfinished upload"
                          className="text-slate-700 font-semibold underline decoration-dotted underline-offset-2 hover:text-indigo-700 cursor-pointer">
                          {ups.length} upload{ups.length === 1 ? '' : 's'} not finished
                        </button>
                        {ups[0]?.at > 0 && <span className="text-slate-500"> · oldest {ageShort(Date.now() - ups[0].at)}</span>}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {ups.slice(0, 4).map((u) => {
                            const old = u.at > 0 && Date.now() - u.at > DAY;
                            const failed = u.status === 'failed';
                            return (
                              <span key={u.orderId} data-backlog-item={u.orderId} data-backlog-status={u.status}
                                title={`${u.where === 'computer' ? 'In the upload queue on their computer' : 'Upload log in the Sheet'}${u.at ? ` · ${fmtDateTime(new Date(u.at))}` : ''}${u.error ? ` · ${u.error}` : ''}`}
                                className={`px-1.5 py-0.5 rounded border font-mono ${failed ? 'bg-rose-50 text-rose-700 border-rose-200' : old ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-white text-slate-700 border-slate-200'}`}>
                                {u.orderId} · {u.status}{u.at ? ` · ${ageShort(Date.now() - u.at)}` : ''}
                              </span>
                            );
                          })}
                          {ups.length > 4 && (
                            <button type="button" data-more-uploads onMouseDown={keepOpen} onTouchStart={keepOpen} onClick={() => toggleList(r.key, 'uploads')}
                              className="px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100 cursor-pointer">
                              +{ups.length - 4} more
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {openList?.email === r.key && (
                <OpenList kind={openList.kind} name={r.name} orders={pend} orderTotal={pendCount} uploads={ups} onClose={closeList} />
              )}
              </div>

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
