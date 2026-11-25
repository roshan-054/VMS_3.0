import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, RefreshCw } from 'lucide-react';
import { requestApi } from '../lib/api';
import { fmtDateTime } from '../lib/dateFormat';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

interface ArchivedRow {
  sheet: string;
  archiveRow: number;
  archivedAt: string;
  reason: string;
  timestamp: string;
  orderId: string;
  platform: string;
  recordingType: string;
  size: string;
  sizeBytes: number;
  fileId: string;
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';
const keyOf = (r: ArchivedRow) => `${r.sheet}:${r.archiveRow}`;

/** Settings > Archived rows: what the sheet cleanup removed, with a way to put rows back. */
export const ArchivedRowsCard: React.FC<Props> = ({ onShowToast }) => {
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r: any = await requestApi('listCleanupArchive', {});
      if (!r?.success) throw new Error(r?.error || 'Could not read the Archive tabs.');
      setRows(r.rows || []);
      setSelected(new Set());
    } catch (e: any) {
      setError(/Unknown action/i.test(e?.message || '') ? 'Available after the live backend is updated.' : e?.message || 'Could not read the Archive tabs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows || []).filter((r) => sheet === 'All' || r.sheet === sheet), [rows, sheet]);
  const sheets = useMemo(() => Array.from(new Set((rows || []).map((r) => r.sheet))), [rows]);
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const restore = async () => {
    setConfirming(false);
    setRestoring(true);
    setDone('');
    try {
      const items = (rows || []).filter((r) => selected.has(keyOf(r))).map((r) => ({ sheet: r.sheet, archiveRow: r.archiveRow }));
      const r: any = await requestApi('restoreCleanupArchive', { items });
      if (!r?.success) throw new Error(r?.error || 'Restore did not finish.');
      setDone(r.message || 'Restored.');
      onShowToast(r.message || 'Restored.', 'success');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Restore did not finish.');
      onShowToast(e?.message || 'Restore did not finish.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section id="archived-rows-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArchiveRestore className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Archived rows</h3>
          {rows && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{rows.length.toLocaleString()}</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={sheet} onChange={(e) => setSheet(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white">
            <option value="All">All tabs</option>
            {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button id="archived-rows-refresh" type="button" onClick={load} disabled={loading || restoring}
            className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-600">Rows removed by the cleanup are kept in the Archive tabs. Tick rows and restore them to their original tab.</p>

      {rows && rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <button id="archived-select-videos" type="button" className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}
              onClick={() => setSelected(new Set(shown.filter((r) => r.sizeBytes >= 1048576).map(keyOf)))}>
              Select rows with videos over 1 MB
            </button>
            <button type="button" className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`} onClick={() => setSelected(new Set(shown.map(keyOf)))}>Select all</button>
            <button type="button" className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <div className="max-h-80 overflow-auto border border-slate-200 rounded-xl">
            <table id="archived-rows-table" className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2 text-left">Order ID</th>
                  <th className="p-2 text-left">Tab</th>
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-left">Recorded</th>
                  <th className="p-2 text-right">Size</th>
                  <th className="p-2 text-left">Reason</th>
                  <th className="p-2 text-left">Archived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.slice(0, 1000).map((r) => (
                  <tr key={keyOf(r)} className="hover:bg-slate-50">
                    <td className="p-2 text-center"><input type="checkbox" checked={selected.has(keyOf(r))} onChange={() => toggle(keyOf(r))} aria-label={`Select ${r.orderId}`} /></td>
                    <td className="p-2 font-mono">{r.orderId}</td>
                    <td className="p-2">{r.sheet}</td>
                    <td className="p-2">{r.recordingType}</td>
                    <td className="p-2 whitespace-nowrap">{fmtDateTime(r.timestamp)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{r.size}</td>
                    <td className="p-2">{r.reason}</td>
                    <td className="p-2 whitespace-nowrap">{fmtDateTime(r.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!confirming ? (
              <button id="archived-restore" type="button" disabled={!selected.size || restoring} onClick={() => setConfirming(true)}
                className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                <ArchiveRestore className="w-3.5 h-3.5" />
                {restoring ? 'Restoring…' : `Restore ${selected.size} row${selected.size === 1 ? '' : 's'}`}
              </button>
            ) : (
              <div id="archived-restore-confirm" className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-700">Put {selected.size} row(s) back into their original tab?</span>
                <button id="archived-restore-yes" type="button" onClick={restore} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Yes, restore</button>
                <button type="button" onClick={() => setConfirming(false)} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Cancel</button>
              </div>
            )}
          </div>
        </>
      )}
      {rows && rows.length === 0 && <p className="text-xs text-slate-500">No archived rows.</p>}
      {done && <div id="archived-restore-result" className="text-xs text-emerald-700 font-medium">{done}</div>}
      {error && <div className="text-xs text-red-700">{error}</div>}
    </section>
  );
};
