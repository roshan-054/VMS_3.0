import React, { useState } from 'react';
import { HardDrive } from 'lucide-react';

export interface SupabaseStorageInfo {
  databaseBytes: number;
  vmsBytes: number;
  tabBytes: Record<string, number>;
}

const MB = 1024 * 1024;
export const SUPABASE_PLANS = [
  { key: 'free', label: 'Free plan · 500 MB', bytes: 500 * MB },
  { key: 'pro', label: 'Pro plan · 8 GB', bytes: 8 * 1024 * MB },
] as const;
const PLAN_KEY = 'vms_supabase_plan';

/** 12.4 MB, 1.2 GB, 640 KB. */
export function fmtBytes(n: number): string {
  const b = Number(n) || 0;
  const trim = (x: string) => x.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (b >= 1024 * MB) return `${trim((b / (1024 * MB)).toFixed(2))} GB`;
  if (b >= MB) return `${trim((b / MB).toFixed(1))} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

export function storageLevel(used: number, limit: number): 'ok' | 'warn' | 'full' {
  const p = limit > 0 ? used / limit : 0;
  return p >= 0.9 ? 'full' : p >= 0.7 ? 'warn' : 'ok';
}

function readPlan(): string {
  try { return localStorage.getItem(PLAN_KEY) || 'free'; } catch { return 'free'; }
}

/** Settings > Supabase: how much of the database plan is used, and by which Sheet tabs. */
export const SupabaseStorage: React.FC<{ storage?: SupabaseStorageInfo | null; schemaVersion: number }> = ({ storage, schemaVersion }) => {
  const [plan, setPlan] = useState(readPlan);
  const limit = (SUPABASE_PLANS.find((p) => p.key === plan) || SUPABASE_PLANS[0]).bytes;
  const choose = (k: string) => {
    setPlan(k);
    try { localStorage.setItem(PLAN_KEY, k); } catch { /* private window */ }
  };

  if (!storage) {
    return (
      <div id="supabase-storage" data-missing className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-slate-400 shrink-0" />
        {schemaVersion < 3
          ? <span>Storage used appears after you run the newer database script (see the note below).</span>
          : <span>Storage used is not available right now.</span>}
      </div>
    );
  }

  const used = Number(storage.databaseBytes) || 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const level = storageLevel(used, limit);
  const bar = level === 'full' ? 'bg-rose-500' : level === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';
  const tabs = Object.entries(storage.tabBytes || {})
    .map(([tab, b]) => [tab, Number(b) || 0] as const)
    .filter(([, b]) => b > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = tabs.slice(0, 5);
  const rest = tabs.slice(5).reduce((t, [, b]) => t + b, 0);

  return (
    <div id="supabase-storage" data-used={used} data-level={level} className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-700">
          <HardDrive className="w-4 h-4 text-slate-500" /> Storage used
        </div>
        <select id="supabase-plan" value={plan} onChange={(e) => choose(e.target.value)} title="Your Supabase plan's database size"
          className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer">
          {SUPABASE_PLANS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span id="supabase-storage-used" className="text-lg font-bold text-slate-900">{fmtBytes(used)}</span>
        <span className="text-slate-500">of {fmtBytes(limit)}</span>
        <span id="supabase-storage-pct" className={`ml-auto font-bold ${level === 'full' ? 'text-rose-600' : level === 'warn' ? 'text-amber-600' : 'text-emerald-700'}`}>
          {pct < 1 && used > 0 ? '<1' : Math.round(pct)}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${bar}`} style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
      <div className="text-slate-500">
        VMS data and its indexes take <b className="text-slate-700">{fmtBytes(storage.vmsBytes)}</b>; the rest is Supabase's own system tables.
        {level !== 'ok' && <span className="text-rose-600 font-semibold"> Getting close to the limit: Supabase makes the database read-only when it is full.</span>}
      </div>
      {top.length > 0 && (
        <div className="flex flex-wrap gap-1" id="supabase-storage-tabs">
          {top.map(([tab, b]) => (
            <span key={tab} data-tab={tab} className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-700">
              {tab} <b>{fmtBytes(b)}</b>
            </span>
          ))}
          {rest > 0 && <span className="px-1.5 py-0.5 text-slate-500">others {fmtBytes(rest)}</span>}
        </div>
      )}
    </div>
  );
};
