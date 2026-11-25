import React, { useCallback, useEffect, useState } from 'react';
import { Server, RefreshCw, CheckCircle2, AlertTriangle, Undo2, UploadCloud, Play, Wrench } from 'lucide-react';
import { requestApi } from '../lib/api';
import { getStoredApiUrl } from '../lib/storage';
import { fmtDateTime } from '../lib/dateFormat';
import { appBuildLabel } from '../lib/appVersion';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface Status {
  live: { sha: string; updatedAt: string; updatedBy: string; version: number | null; previousVersion: number | null };
  latest: { sha: string; bytes: number } | null;
  latestError?: string;
  api: { ready: boolean; error: string; help: string };
  upToDate: boolean;
}

// Safe one-time backend functions an admin can run from here (each asks for confirmation first).
const MAINTENANCE: { action: string; label: string; detail: string }[] = [
  { action: 'setup', label: 'Run setup (setupSystem)', detail: 'Creates any missing sheet tabs and resets their header rows. Data rows are not touched.' },
  { action: 'applyDateFormats', label: 'Apply DD-MMM-YY to sheet dates', detail: 'Turns text dates in the log tabs into real dates shown as DD-MMM-YY.' },
  { action: 'repairPlaybackUrls', label: 'Repair video playback links', detail: 'Rebuilds the playback link from the Drive file ID where it is missing or wrong.' },
  { action: 'applyConditionalFormatting', label: 'Refresh duplicate highlighting', detail: 'Re-applies the red highlight for repeated Order IDs and tidies file sizes.' },
];

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';

/** Settings > Backend code: install the latest Code.gs from GitHub into Apps Script with one click. */
export const BackendUpdateCard: React.FC<Props> = ({ onShowToast }) => {
  const [status, setStatus] = useState<Status | null>(null);
  const [oldBackend, setOldBackend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'' | 'update' | 'rollback'>('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ error: string; help?: string } | null>(null);
  const [done, setDone] = useState('');
  const [mConfirm, setMConfirm] = useState('');
  const [mBusy, setMBusy] = useState('');
  const [mResult, setMResult] = useState<{ action: string; ok: boolean; text: string } | null>(null);

  const runMaintenance = async (action: string) => {
    setMConfirm('');
    setMBusy(action);
    setMResult(null);
    try {
      const r: any = await requestApi(action, {});
      const text = r?.message || (r?.success ? 'Done.' : r?.error || 'Did not finish.');
      setMResult({ action, ok: !!r?.success, text });
      onShowToast(text, r?.success ? 'success' : 'error');
    } catch (e: any) {
      setMResult({ action, ok: false, text: e?.message || 'Did not finish.' });
    } finally {
      setMBusy('');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r: any = await requestApi('getBackendUpdateStatus', {});
      if (!r?.success) {
        if (/Unknown action/i.test(r?.error || '')) setOldBackend(true);
        else setError({ error: r?.error || 'Could not check the backend.' });
        return;
      }
      setOldBackend(false);
      setStatus(r as Status);
    } catch (e: any) {
      if (/Unknown action/i.test(e?.message || '')) setOldBackend(true);
      else setError({ error: e?.message || 'Could not check the backend.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (action: 'updateBackend' | 'rollbackBackend') => {
    setBusy(action === 'updateBackend' ? 'update' : 'rollback');
    setConfirming(false);
    setError(null);
    setDone('');
    try {
      const r: any = await requestApi(action, { webAppUrl: getStoredApiUrl(), force: action === 'updateBackend' && !!status?.upToDate });
      if (!r?.success) {
        setError({ error: r?.error || 'The update did not finish.', help: r?.help });
        onShowToast(r?.error || 'Backend update failed.', 'error');
      } else {
        setDone(r.message || 'Done.');
        onShowToast(r.message || 'Backend updated.', 'success');
      }
    } catch (e: any) {
      setError({ error: e?.message || 'The update did not finish.' });
    } finally {
      setBusy('');
      load();
    }
  };

  const live = status?.live;
  const pill = oldBackend
    ? { text: 'Needs one manual update', cls: 'bg-amber-100 text-amber-800' }
    : !status
      ? null
      : !status.api.ready
        ? { text: 'Setup needed', cls: 'bg-amber-100 text-amber-800' }
      : status.upToDate
        ? { text: 'Up to date', cls: 'bg-emerald-100 text-emerald-800' }
        : status.latest
          ? { text: 'Update available', cls: 'bg-blue-100 text-blue-800' }
          : { text: 'Unknown', cls: 'bg-slate-100 text-slate-700' };
  const canUpdate = !!status && status.api.ready && !!status.latest && !busy;

  return (
    <section id="backend-update-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Backend code (Code.gs)</h3>
          {pill && <span id="backend-update-status" className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.text}</span>}
        </div>
        <button id="backend-update-check" type="button" onClick={load} disabled={loading || !!busy}
          className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Check
        </button>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <dt className="text-slate-500 font-semibold">Live backend</dt>
          <dd id="backend-live" className="mt-1 font-mono text-slate-800">
            {oldBackend ? 'Older version (no updater)' : live ? `${live.sha || 'unknown'}${live.version ? ` · v${live.version}` : ''}` : '…'}
          </dd>
          {live?.updatedAt && (
            <dd className="text-[11px] text-slate-500 mt-0.5">Updated {fmtDateTime(live.updatedAt)}{live.updatedBy ? ` by ${live.updatedBy}` : ''}</dd>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <dt className="text-slate-500 font-semibold">Latest on GitHub</dt>
          <dd id="backend-latest" className="mt-1 font-mono text-slate-800">{status?.latest?.sha || (status?.latestError ? 'not reachable' : '…')}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <dt className="text-slate-500 font-semibold">This web app</dt>
          <dd className="mt-1 font-mono text-slate-800">{appBuildLabel()}</dd>
        </div>
      </dl>

      {status && !status.api.ready && (
        <div id="backend-update-api-help" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">One-time setup needed before this button works.</div>
            <div className="mt-1">{status.api.help || status.api.error}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!confirming ? (
          <button id="backend-update-run" type="button" disabled={!canUpdate} onClick={() => setConfirming(true)}
            className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            <UploadCloud className={`w-3.5 h-3.5 ${busy === 'update' ? 'animate-pulse' : ''}`} />
            {busy === 'update' ? 'Updating…' : status?.upToDate ? 'Reinstall latest Code.gs' : 'Update backend now'}
          </button>
        ) : (
          <div id="backend-update-confirm" className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-700">{status?.upToDate ? 'Install the latest Code.gs again as a new version and switch the live web app to it?' : 'Install the latest Code.gs and switch the live web app to it?'}</span>
            <button id="backend-update-confirm-yes" type="button" onClick={() => run('updateBackend')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Yes, update</button>
            <button type="button" onClick={() => setConfirming(false)} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Cancel</button>
          </div>
        )}
        {live?.previousVersion && !confirming && (
          <button id="backend-update-rollback" type="button" disabled={!!busy || !status?.api.ready} onClick={() => run('rollbackBackend')}
            className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <Undo2 className="w-3.5 h-3.5" />
            {busy === 'rollback' ? 'Going back…' : `Go back to v${live.previousVersion}`}
          </button>
        )}
      </div>

      {done && (
        <div id="backend-update-result" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {done}
        </div>
      )}
      {error && (
        <div id="backend-update-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <div className="font-semibold">{error.error}</div>
          {error.help && <div className="mt-1">{error.help}</div>}
        </div>
      )}

      <div id="backend-maintenance" className="border-t border-slate-100 pt-4 space-y-2">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-blue-600" />
          <h4 className="text-xs font-bold text-slate-800">Run backend functions</h4>
        </div>
        {oldBackend && <p className="text-xs text-slate-500">Available after the live backend is updated.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {MAINTENANCE.map((m) => (
            <div key={m.action} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-800">{m.label}</div>
              <div className="text-[11px] text-slate-500">{m.detail}</div>
              {mConfirm === m.action ? (
                <div className="flex items-center gap-2">
                  <button id={`run-${m.action}-yes`} type="button" onClick={() => runMaintenance(m.action)} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Yes, run</button>
                  <button type="button" onClick={() => setMConfirm('')} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Cancel</button>
                </div>
              ) : (
                <button id={`run-${m.action}`} type="button" disabled={!!mBusy || !!busy} onClick={() => setMConfirm(m.action)}
                  className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                  <Play className={`w-3.5 h-3.5 ${mBusy === m.action ? 'animate-pulse' : ''}`} />
                  {mBusy === m.action ? 'Running…' : 'Run'}
                </button>
              )}
              {mResult?.action === m.action && (
                <div id={`run-${m.action}-result`} className={`text-[11px] font-medium ${mResult.ok ? 'text-emerald-700' : 'text-red-700'}`}>{mResult.text}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">One-time setup</summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1">
          <li>Open script.google.com/home/usersettings and turn on <b>Google Apps Script API</b>.</li>
          <li>In the Apps Script editor, Project Settings, tick <b>Show "appsscript.json"</b>. Replace its text with backend/appsscript.json from GitHub.</li>
          <li>Replace Code.gs with backend/Code.gs from GitHub and save.</li>
          <li>Pick <b>authorizeBackendUpdater</b> in the function list, click Run and allow access.</li>
          <li>Deploy, Manage deployments, edit the web app, Version: New version, Deploy.</li>
        </ol>
        <p className="mt-2">After this, updates are one click here. If Google says the Apps Script API is not enabled for the project, open the link in that message, click Enable, wait two minutes and try again.</p>
      </details>
    </section>
  );
};
