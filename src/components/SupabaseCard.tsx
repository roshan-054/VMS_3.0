import React, { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw, CheckCircle2, AlertTriangle, Copy, UploadCloud, Download, Zap, ExternalLink } from 'lucide-react';
import { requestApi } from '../lib/api';
import { getStoredToken } from '../lib/storage';
import { fmtDateTime } from '../lib/dateFormat';
import { getSupabaseConfig, isSupabaseOffHere, setSupabaseOffHere, normalizeSupabaseUrl } from '../lib/supabase/client';
import { supabaseRouteStatus, resetSupabaseCopy } from '../lib/supabase/router';
import { downloadBackup, REFERENCE_TABS } from '../lib/supabase/backup';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface Config {
  url: string;
  anonKey: string;
  hasServiceKey: boolean;
  enabled: boolean;
  connected?: boolean;
  connectionError?: string;
  triggerInstalled: boolean;
  lastSweep: number | null;
  importedAt: string | null;
  status?: {
    tabs: Record<string, number>;
    schemaVersion?: number;
    pendingSheetWrites: number;
    oldestPending: string | null;
    state: Record<string, any>;
  };
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';
const input = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const today = () => new Date().toISOString().slice(0, 10);

/** Settings > Fast database (Supabase): connect, first copy, sync status. */
export const SupabaseCard: React.FC<Props> = ({ onShowToast }) => {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [oldBackend, setOldBackend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ url: '', anonKey: '', serviceKey: '' });
  const [offHere, setOffHere] = useState(isSupabaseOffHere());
  const [station, setStation] = useState(supabaseRouteStatus());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r: any = await requestApi('getSupabaseConfig', {});
      setOldBackend(false);
      setCfg(r as Config);
      setForm((f) => ({ url: f.url || r.url || '', anonKey: f.anonKey || r.anonKey || '', serviceKey: '' }));
    } catch (e: any) {
      if (/Unknown action/i.test(e?.message || '')) setOldBackend(true);
      else setError(e?.message || 'Could not read the Supabase settings.');
    } finally {
      setLoading(false);
      setStation(supabaseRouteStatus());
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setStation(supabaseRouteStatus()), 3000);
    return () => clearInterval(t);
  }, []);

  const refreshBranding = async () => {
    // Every station reads the Supabase address from here; refresh it on this one now.
    try { await requestApi('getBranding', {}); } catch (_) {}
  };

  const save = async (enabled = true) => {
    setBusy(enabled ? 'save' : 'off');
    setError('');
    setNote('');
    try {
      const r: any = await requestApi('saveSupabaseConfig', enabled
        ? { url: normalizeSupabaseUrl(form.url) || form.url.trim(), anonKey: form.anonKey.trim(), serviceKey: form.serviceKey.trim(), enabled: true }
        : { enabled: false });
      setCfg(r as Config);
      setForm((f) => ({ ...f, serviceKey: '' }));
      await refreshBranding();
      if (!enabled) await resetSupabaseCopy();
      const msg = enabled ? 'Supabase connected. The keys are stored in Apps Script.' : 'Supabase turned off. The app uses the Google Sheet only.';
      setNote(msg);
      onShowToast(msg, 'success');
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy('');
      setStation(supabaseRouteStatus());
    }
  };

  const run = async (action: 'supabaseImport' | 'syncSheetNow' | 'supabaseSweep', done: (r: any) => string) => {
    setBusy(action);
    setError('');
    setNote('');
    try {
      const r: any = await requestApi(action, {});
      const msg = done(r);
      setNote(msg);
      onShowToast(msg, 'success');
      if (action === 'supabaseImport') await refreshBranding();
    } catch (e: any) {
      setError(e?.message || 'Did not finish.');
    } finally {
      setBusy('');
      load();
    }
  };

  const copySql = async () => {
    try {
      const mod = await import('../../supabase/vms_schema.sql?raw');
      await navigator.clipboard.writeText(mod.default as string);
      onShowToast('Database script copied. Paste it into the Supabase SQL Editor and click Run.', 'success');
    } catch (_) {
      onShowToast('Could not copy. Open supabase/vms_schema.sql on GitHub instead.', 'error');
    }
  };

  const connected = !!cfg?.connected && cfg.enabled;
  const pill = oldBackend
    ? { text: 'Update the backend first', cls: 'bg-amber-100 text-amber-800' }
    : !cfg
      ? null
      : !cfg.url || !cfg.hasServiceKey
        ? { text: 'Not set up', cls: 'bg-slate-100 text-slate-700' }
        : !cfg.enabled
          ? { text: 'Turned off', cls: 'bg-slate-100 text-slate-700' }
          : connected
            ? { text: 'Connected', cls: 'bg-emerald-100 text-emerald-800' }
            : { text: 'Not reachable', cls: 'bg-rose-100 text-rose-800' };
  const total = cfg?.status ? Object.values(cfg.status.tabs || {}).reduce((a: number, b) => a + Number(b || 0), 0) : 0;
  const lastSync = cfg?.status?.state?.lastSheetSync?.at;
  const projectRef = (cfg?.url || form.url).match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];

  return (
    <section id="supabase-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Fast database (Supabase)</h3>
          {pill && <span id="supabase-status" className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.text}</span>}
        </div>
        <button type="button" onClick={load} disabled={loading || !!busy} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Check
        </button>
      </div>

      <p className="text-xs text-slate-600">
        Search, upload logs, reports, analytics, orders, pack checks and the catalog read and save in Supabase, so they are much faster.
        The Google Sheet stays exactly as it is and is updated in the background within seconds, as your backup. Videos stay in Google Drive.
        If Supabase is ever unreachable, the app uses the Google Sheet automatically.
      </p>

      {oldBackend && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>Click <b>Update backend now</b> under Backend code (below) first, then come back here.</div>
        </div>
      )}

      {cfg && connected && cfg.status && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <dt className="text-slate-500 font-semibold">Rows in Supabase</dt>
            <dd id="supabase-rows" className="mt-1 text-lg font-bold text-slate-900">{total.toLocaleString()}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <dt className="text-slate-500 font-semibold">Waiting for the Sheet</dt>
            <dd id="supabase-pending" className="mt-1 text-lg font-bold text-slate-900">{Number(cfg.status.pendingSheetWrites || 0).toLocaleString()}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <dt className="text-slate-500 font-semibold">Sheet last updated</dt>
            <dd className="mt-1 font-semibold text-slate-800">{lastSync ? fmtDateTime(lastSync) : Number(cfg.status.pendingSheetWrites || 0) === 0 ? 'Up to date' : '—'}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <dt className="text-slate-500 font-semibold">First copy</dt>
            <dd className="mt-1 font-semibold text-slate-800">{cfg.importedAt ? fmtDateTime(cfg.importedAt) : 'Not done yet'}</dd>
          </div>
        </dl>
      )}

      {cfg && connected && Number(cfg.status?.schemaVersion || 0) < 2 && (
        <div id="supabase-schema-old" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <div>The database script has a newer version (Supabase has version {Number(cfg.status?.schemaVersion || 1)}, this app needs version 2). Copy it, paste it in the Supabase SQL Editor as a new query, click <b>Run</b> and wait for <b>Success</b>, then click <b>Check</b> above. Your data is kept.</div>
            <div className="flex flex-wrap gap-2">
              <button id="supabase-copy-sql-note" type="button" onClick={copySql} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 cursor-pointer">
                <Copy className="w-3 h-3" /> Copy database script
              </button>
              {projectRef && (
                <a href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 font-semibold hover:bg-amber-100">
                  <ExternalLink className="w-3 h-3" /> Open SQL Editor
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {cfg && connected && !cfg.importedAt && (
        <div className="flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>Last step: click <b>Copy Sheet data to Supabase</b> once so Supabase starts with everything that is in the Sheet today.</div>
        </div>
      )}

      {cfg && !oldBackend && (
        <details className="rounded-xl border border-slate-200 p-3 text-xs" open={!connected}>
          <summary className="cursor-pointer font-semibold text-slate-800">{connected ? 'Connection details' : 'Connect your Supabase project'}</summary>
          <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-slate-700">
            <li>
              In Supabase open <b>SQL Editor</b> → <b>New query</b>, paste the database script and click <b>Run</b>.{' '}
              <button type="button" onClick={copySql} className="inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline cursor-pointer">
                <Copy className="w-3 h-3" /> Copy database script
              </button>
              {projectRef && (
                <a href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 ml-2 text-blue-700 font-semibold hover:underline">
                  <ExternalLink className="w-3 h-3" /> Open SQL Editor
                </a>
              )}
            </li>
            <li>In Supabase open <b>Project Settings</b> → <b>API Keys</b> (or <b>Data API</b>) and copy the Project URL, the <b>anon / publishable</b> key and the <b>service_role / secret</b> key into the boxes below.</li>
            <li>Click <b>Save and test</b>, then <b>Copy Sheet data to Supabase</b>.</li>
          </ol>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <label className="space-y-1">
              <span className="font-semibold text-slate-600">Project URL</span>
              <input id="supabase-url" className={input} placeholder="https://abcd1234.supabase.co" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              {form.url.trim() && (normalizeSupabaseUrl(form.url)
                ? (normalizeSupabaseUrl(form.url) !== form.url.trim() && <span id="supabase-url-hint" className="block text-[11px] text-slate-500">Will use {normalizeSupabaseUrl(form.url)}</span>)
                : <span id="supabase-url-hint" className="block text-[11px] text-red-600">This doesn't look like a Supabase Project URL.</span>)}
            </label>
            <label className="space-y-1">
              <span className="font-semibold text-slate-600">anon / publishable key</span>
              <input id="supabase-anon" className={input} placeholder="eyJ… or sb_publishable_…" value={form.anonKey} onChange={(e) => setForm({ ...form, anonKey: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="font-semibold text-slate-600">service_role / secret key</span>
              <input id="supabase-service" type="password" autoComplete="off" className={input}
                placeholder={cfg.hasServiceKey ? 'Saved (leave empty to keep it)' : 'eyJ… or sb_secret_…'}
                value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.target.value })} />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The service key is saved only in Apps Script (Script Properties) and is never sent to any browser. Stations only get the URL and the public anon key.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button id="supabase-save" type="button" disabled={!!busy || !form.url || !form.anonKey || (!form.serviceKey && !cfg.hasServiceKey)}
              onClick={() => save(true)} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
              <CheckCircle2 className="w-3.5 h-3.5" /> {busy === 'save' ? 'Testing…' : 'Save and test'}
            </button>
            {cfg.enabled && cfg.hasServiceKey && (
              <button type="button" disabled={!!busy} onClick={() => save(false)} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                {busy === 'off' ? 'Turning off…' : 'Turn off Supabase'}
              </button>
            )}
          </div>
        </details>
      )}

      {connected && (
        <div className="flex flex-wrap gap-2">
          <button id="supabase-import" type="button" disabled={!!busy} className={`${btn} ${cfg?.importedAt ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            onClick={() => run('supabaseImport', (r) => {
              const rows = (r.results || []).reduce((n: number, x: any) => n + Number(x?.total || 0), 0);
              return `Supabase now has the Sheet data (${rows.toLocaleString()} rows).`;
            })}>
            <UploadCloud className={`w-3.5 h-3.5 ${busy === 'supabaseImport' ? 'animate-pulse' : ''}`} />
            {busy === 'supabaseImport' ? 'Copying… (can take a minute)' : 'Copy Sheet data to Supabase'}
          </button>
          <button id="supabase-sync-now" type="button" disabled={!!busy} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            onClick={() => run('syncSheetNow', (r) => r?.skipped ? 'Another update of the Sheet is running; it will finish on its own.' : `Sheet updated (${Number(r?.appended || 0) + Number(r?.updated || 0) + Number(r?.removed || 0)} changes).`)}>
            <Zap className="w-3.5 h-3.5" /> {busy === 'syncSheetNow' ? 'Updating…' : 'Update the Sheet now'}
          </button>
          <button type="button" disabled={!!busy} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            onClick={() => run('supabaseSweep', (r) => `Compared ${(r.results || []).length} tabs; differences fixed.`)}>
            <RefreshCw className="w-3.5 h-3.5" /> {busy === 'supabaseSweep' ? 'Comparing…' : 'Compare Sheet and Supabase'}
          </button>
        </div>
      )}

      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs">
          <div id="supabase-station" className="text-slate-700">
            <b>This computer:</b>{' '}
            {offHere ? 'uses the Google Sheet only' : !getSupabaseConfig() ? 'not connected yet (reload the page)' : station.paused ? `using the Google Sheet for a moment (${station.pauseReason})` : station.ready ? `using Supabase, ${station.rows.toLocaleString()} rows copied${station.lastPull ? `, refreshed ${fmtDateTime(station.lastPull, true)}` : ''}` : 'downloads its copy on first use'}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-slate-700">
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={!offHere} onChange={(e) => { setSupabaseOffHere(!e.target.checked); setOffHere(!e.target.checked); }} />
            Use Supabase on this computer
          </label>
        </div>
      )}

      {error && (
        <div id="supabase-error" className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {cfg?.connectionError && cfg.enabled && !error && (
        <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{cfg.connectionError}</span>
        </div>
      )}
      {note && (
        <div id="supabase-note" className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> <span>{note}</span>
        </div>
      )}
    </section>
  );
};

/** Settings > Download backup: all data or a date range, as Excel in the Sheet's layout. */
export const BackupCard: React.FC<Props> = ({ onShowToast }) => {
  const [mode, setMode] = useState<'all' | 'range'>('all');
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const ready = !!getSupabaseConfig();

  const go = async () => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      if (mode === 'range' && from > to) throw new Error('The From date is after the To date.');
      const r = await downloadBackup({
        token: getStoredToken(),
        fromDate: mode === 'range' ? from : undefined,
        toDate: mode === 'range' ? to : undefined,
        onProgress: setProgress,
      });
      const msg = `${r.fileName} downloaded: ${r.rows.toLocaleString()} rows in ${r.tabs} tabs.`;
      setDone(msg);
      onShowToast(msg, 'success');
    } catch (e: any) {
      setError(e?.message || 'The backup did not finish.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <section id="backup-card" className={card}>
      <div className="flex items-center gap-2">
        <Download className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-bold text-slate-800">Download backup</h3>
      </div>
      <p className="text-xs text-slate-600">
        An Excel file with the same tabs and columns as your Google Sheet, with dates as DD-MMM-YY. For a date range,
        the log tabs keep only rows from those days; {REFERENCE_TABS.join(', ')} are always included in full. Passwords are never included.
      </p>
      {!ready ? (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">Connect Supabase above to download backups from it.</div>
      ) : (
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="backup-mode" checked={mode === 'all'} onChange={() => setMode('all')} className="accent-blue-600" /> All data
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input id="backup-mode-range" type="radio" name="backup-mode" checked={mode === 'range'} onChange={() => setMode('range')} className="accent-blue-600" /> Date range
          </label>
          {mode === 'range' && (
            <>
              <label className="space-y-1">
                <span className="block font-semibold text-slate-600">From</span>
                <input id="backup-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200" />
              </label>
              <label className="space-y-1">
                <span className="block font-semibold text-slate-600">To</span>
                <input id="backup-to" type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200" />
              </label>
            </>
          )}
          <button id="backup-download" type="button" disabled={busy} onClick={go} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            <Download className={`w-3.5 h-3.5 ${busy ? 'animate-pulse' : ''}`} /> {busy ? progress || 'Preparing…' : 'Download backup (.xlsx)'}
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {done && (
        <div id="backup-done" className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> <span>{done}</span>
        </div>
      )}
    </section>
  );
};
