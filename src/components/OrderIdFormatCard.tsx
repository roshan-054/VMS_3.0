import React, { useState } from 'react';
import { Hash, RefreshCw, Wand2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { scanOrderIdFormat, fixOrderIdFormat, OrderIdFormatResult } from '../lib/api';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';

/** Settings: put every saved order ID in the standard format (#OD-10063 for D2C, no spaces). */
export const OrderIdFormatCard: React.FC<Props> = ({ onShowToast }) => {
  const [scan, setScan] = useState<OrderIdFormatResult | null>(null);
  const [result, setResult] = useState<OrderIdFormatResult | null>(null);
  const [busy, setBusy] = useState<'' | 'scan' | 'fix'>('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const doScan = async () => {
    setBusy('scan');
    setError('');
    setResult(null);
    setConfirming(false);
    try {
      setScan(await scanOrderIdFormat());
    } catch (e: any) {
      setError(e?.message || 'Could not check order IDs.');
    } finally {
      setBusy('');
    }
  };

  const doFix = async () => {
    setBusy('fix');
    setError('');
    setConfirming(false);
    try {
      const res = await fixOrderIdFormat();
      setResult(res);
      onShowToast(res.message || `Fixed ${res.fixed || 0} order ID(s).`, 'success');
      setScan(await scanOrderIdFormat().catch(() => null));
    } catch (e: any) {
      setError(e?.message || 'Could not fix order IDs.');
      onShowToast(e?.message || 'Could not fix order IDs.', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <section id="order-id-format-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Fix order ID format</h3>
        </div>
        <button id="order-id-format-scan" type="button" onClick={doScan} disabled={!!busy}
          className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy === 'scan' ? 'animate-spin' : ''}`} />
          {scan ? 'Check again' : 'Check order IDs'}
        </button>
      </div>
      <p className="text-xs text-slate-600">
        D2C orders are saved as <span className="font-mono font-semibold">#OD-10063</span>: one # and no spaces. This finds
        saved order IDs written another way (OD-10063, ##OD-10063, extra spaces) and corrects only that cell.
        No row is added or removed. New orders are saved in this format automatically.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {scan && (
        <div id="order-id-format-preview" className="space-y-3">
          <div className="text-xs font-semibold text-slate-800">
            {scan.total ? `${scan.total.toLocaleString()} order ID(s) need fixing.` : 'Every order ID is already in the right format.'}
          </div>
          {scan.sheets.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {scan.sheets.map((s) => (
                <span key={s.sheet} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">{s.sheet}: {s.rows.toLocaleString()}</span>
              ))}
            </div>
          )}
          {scan.examples.length > 0 && (
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-500">
                    <th className="py-1.5 px-3 font-semibold">Sheet</th>
                    <th className="py-1.5 px-3 font-semibold text-right">Row</th>
                    <th className="py-1.5 px-3 font-semibold">Now</th>
                    <th className="py-1.5 px-3 font-semibold">Becomes</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.examples.map((x) => (
                    <tr key={`${x.sheet}-${x.row}`} className="border-t border-slate-100 text-slate-700">
                      <td className="py-1 px-3">{x.sheet}</td>
                      <td className="py-1 px-3 text-right">{x.row}</td>
                      <td className="py-1 px-3 font-mono whitespace-pre">"{x.from}"</td>
                      <td className="py-1 px-3 font-mono font-semibold">{x.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {scan.total > 0 && (!confirming ? (
            <button id="order-id-format-fix" type="button" disabled={!!busy} onClick={() => setConfirming(true)}
              className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
              <Wand2 className="w-3.5 h-3.5" />
              Fix {scan.total.toLocaleString()} order IDs
            </button>
          ) : (
            <div id="order-id-format-confirm" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <span className="text-xs text-amber-900">Rewrite {scan.total.toLocaleString()} order ID cells in the sheet? Rows stay where they are.</span>
              <button id="order-id-format-confirm-yes" type="button" onClick={doFix}
                className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>Yes, fix</button>
              <button type="button" onClick={() => setConfirming(false)}
                className={`${btn} border border-slate-300 text-slate-700 bg-white hover:bg-slate-50`}>Cancel</button>
            </div>
          ))}
          {busy === 'fix' && <div className="text-xs text-slate-500">Fixing order IDs…</div>}
        </div>
      )}

      {result && (
        <div id="order-id-format-result" className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5" />
          <span>{result.message}</span>
        </div>
      )}
    </section>
  );
};
