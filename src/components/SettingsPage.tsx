import React, { useState } from 'react';
import { Eraser, RefreshCw, Archive, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BackendUpdateCard } from './BackendUpdateCard';
import { scanSheetCleanup, runSheetCleanup, getSheetCleanupProgress, SheetCleanupScan, SheetCleanupResult, SheetCleanupLiveProgress } from '../lib/api';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';

/** Settings: maintenance tools for the Google Sheet. */
export const SettingsPage: React.FC<Props> = ({ onShowToast }) => {
  const [scan, setScan] = useState<SheetCleanupScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ removed: number; remaining: number } | null>(null);
  const [live, setLive] = useState<SheetCleanupLiveProgress | null>(null);
  const [result, setResult] = useState<SheetCleanupResult | null>(null);
  const [trashVideos, setTrashVideos] = useState(false);
  const [error, setError] = useState('');

  const doScan = async () => {
    setScanning(true);
    setError('');
    setResult(null);
    setConfirming(false);
    try {
      setScan(await scanSheetCleanup());
    } catch (e: any) {
      setError(e?.message || 'Could not scan the sheet.');
    } finally {
      setScanning(false);
    }
  };

  const doRun = async () => {
    setRunning(true);
    setConfirming(false);
    setError('');
    setProgress({ removed: 0, remaining: scan?.totalRemove || 0 });
    setLive(null);
    // Poll the live progress of the round in progress (rows and Drive Trash) every 3 seconds.
    const startedAt = Date.now();
    let polling = true;
    const poll = async () => {
      while (polling) {
        const p = await getSheetCleanupProgress();
        if (!polling) break;
        if (p && p.at >= startedAt - 120000) setLive(p);
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    poll();
    try {
      const res = await runSheetCleanup({ trashExtraVideos: trashVideos }, (removed, remaining) => {
        setProgress({ removed, remaining });
        setLive((l) => (l ? { ...l, rowsDone: 0, phase: 'rows' } : l));
      });
      setResult(res);
      onShowToast(`${res.removedRowsCount} row(s) removed and archived.`, 'success');
      setScan(await scanSheetCleanup().catch(() => null));
    } catch (e: any) {
      setError(e?.message || 'The cleanup did not finish.');
      onShowToast(e?.message || 'The cleanup did not finish.', 'error');
    } finally {
      polling = false;
      setRunning(false);
      setProgress(null);
      setLive(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <h2 className="text-xl font-bold text-slate-900">Settings</h2>

      <section id="sheet-cleanup-card" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eraser className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Remove duplicate and unusable rows</h3>
          </div>
          <button id="sheet-cleanup-scan" type="button" onClick={doScan} disabled={scanning || running}
            className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scan ? 'Scan again' : 'Scan sheets'}
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Checks OrderLog, ReturnLog and UploadLog. One row is kept per recording (completed, 100%, with its Drive video).
          Removed rows are copied to an Archive tab first. Rows from the last 6 hours are not touched.
        </p>

        {error && (
          <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {scan && (
          <div id="sheet-cleanup-preview" className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Rows to remove', scan.totalRemove],
                ['Duplicate rows', scan.totalDuplicates],
                ['Unusable rows', scan.totalUnusable],
                ['Recordings with duplicates', scan.duplicateRecordings],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                  <div className="text-lg font-bold text-slate-900">{Number(value).toLocaleString()}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-1.5 pr-3 font-semibold">Sheet</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Rows</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Duplicate</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Unusable</th>
                    <th className="py-1.5 font-semibold text-right">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.sheets.map((s) => (
                    <tr key={s.name} className="border-b border-slate-100 text-slate-700">
                      <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                      <td className="py-1.5 pr-3 text-right">{s.rows.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right">{s.duplicates.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right">{s.unusable.toLocaleString()}</td>
                      <td className="py-1.5 text-right font-semibold">{s.remove.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {Object.keys(scan.reasons).length > 0 && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {Object.entries(scan.reasons).map(([reason, n]) => (
                  <span key={reason} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">{reason}: {n}</span>
                ))}
              </div>
            )}

            {scan.topGroups.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-slate-700">Recordings with duplicates ({scan.duplicateRecordings})</summary>
                <div className="mt-2 max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                  <table id="sheet-cleanup-groups" className="w-full">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left text-slate-500">
                        <th className="py-1.5 px-3 font-semibold">Order ID</th>
                        <th className="py-1.5 px-3 font-semibold">Type</th>
                        <th className="py-1.5 px-3 font-semibold">Sheet</th>
                        <th className="py-1.5 px-3 font-semibold text-right">Keep row</th>
                        <th className="py-1.5 px-3 font-semibold text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scan.topGroups.map((g) => (
                        <tr key={`${g.sheet}-${g.keepRow}`} className="border-t border-slate-100 text-slate-700">
                          <td className="py-1 px-3 font-medium">{g.orderId}</td>
                          <td className="py-1 px-3">{g.recordingType}</td>
                          <td className="py-1 px-3">{g.sheet}</td>
                          <td className="py-1 px-3 text-right">{g.keepRow}</td>
                          <td className="py-1 px-3 text-right">{g.removeRows}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {scan.totalRemove > 0 && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                {scan.extraVideos > 0 && (
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input id="sheet-cleanup-trash-videos" type="checkbox" checked={trashVideos} disabled={running}
                      onChange={(e) => setTrashVideos(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                    Also move the {scan.extraVideos} extra video copies to Google Drive Trash
                  </label>
                )}
                {!confirming ? (
                  <button id="sheet-cleanup-run" type="button" disabled={running} onClick={() => setConfirming(true)}
                    className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                    <Archive className="w-3.5 h-3.5" />
                    Remove {scan.totalRemove.toLocaleString()} rows
                  </button>
                ) : (
                  <div id="sheet-cleanup-confirm" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <span className="text-xs text-amber-900">
                      Remove {scan.totalRemove.toLocaleString()} rows from the sheet and copy them to the Archive tabs
                      {trashVideos ? `, and move ${scan.extraVideos} extra videos to Drive Trash` : ''}?
                    </span>
                    <button id="sheet-cleanup-confirm-yes" type="button" onClick={doRun}
                      className={`${btn} bg-rose-600 text-white hover:bg-rose-700`}>Yes, remove</button>
                    <button type="button" onClick={() => setConfirming(false)}
                      className={`${btn} border border-slate-300 text-slate-700 bg-white hover:bg-slate-50`}>Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {progress && (() => {
          const rowsTotal = scan?.totalRemove || progress.removed + progress.remaining || 0;
          const rowsDone = Math.min(rowsTotal, progress.removed + (live && live.phase !== 'videos' ? live.rowsDone : 0));
          const vTotal = live?.videosTotal || 0;
          const vDone = live ? Math.min(vTotal, live.videosDone) : 0;
          const bar = (id: string, label: string, done: number, total: number, active: boolean) => {
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <div id={id} className="space-y-1">
                <div className="flex justify-between text-xs text-slate-700">
                  <span className="font-semibold">{label}</span>
                  <span className="font-mono">{done.toLocaleString()} / {total.toLocaleString()} · {pct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full rounded-full bg-blue-600 transition-all duration-500 ${active && pct < 100 ? 'animate-pulse' : ''}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          };
          return (
            <div className="space-y-3">
              {trashVideos && vTotal > 0 && bar('sheet-cleanup-progress-videos', 'Moving extra videos to Drive Trash', vDone, vTotal, live?.phase === 'videos')}
              {bar('sheet-cleanup-progress-rows', 'Removing rows', rowsDone, rowsTotal, !live || live.phase !== 'videos')}
              <div id="sheet-cleanup-progress" className="text-xs text-slate-500">
                {live?.phase === 'videos' ? 'Moving videos to Drive Trash…' : 'Removing rows…'} {rowsDone.toLocaleString()} done{rowsTotal - rowsDone > 0 ? `, ${(rowsTotal - rowsDone).toLocaleString()} left` : ''}
              </div>
            </div>
          );
        })()}

        {result && (
          <div id="sheet-cleanup-result" className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5" />
            <span>
              {result.removedRowsCount.toLocaleString()} rows removed and copied to the Archive tabs
              {Object.keys(result.removedBySheet).length > 0 &&
                ` (${Object.entries(result.removedBySheet).map(([k, v]) => `${k}: ${v}`).join(', ')})`}
              {result.videosTrashedCount ? `. ${result.videosTrashedCount} extra videos moved to Drive Trash` : ''}
              {result.videosFailedCount ? `. ${result.videosFailedCount} videos could not be moved` : ''}
              {result.done ? '.' : '. Some rows are left; run the cleanup again.'}
            </span>
          </div>
        )}
      </section>

      <BackendUpdateCard onShowToast={onShowToast} />
    </div>
  );
};
