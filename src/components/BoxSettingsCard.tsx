import React, { useEffect, useState } from 'react';
import { Box, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  BoxSettings, DEFAULT_VOLUMETRIC_DIVISOR, deleteBoxPreset, fetchBoxSettings, getCachedBoxSettings, parseBoxNumber,
  presetLabel, saveBoxPreset, setBoxFeature,
} from '../lib/boxes';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';
const input = 'px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Settings > Packing box (Super Admin only): switch box & weight on or off, divisor, saved boxes. */
export const BoxSettingsCard: React.FC<Props> = ({ onShowToast }) => {
  const [settings, setSettings] = useState<BoxSettings>(getCachedBoxSettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [divisor, setDivisor] = useState(String(settings.divisor));
  const [form, setForm] = useState({ name: '', l: '', b: '', h: '' });

  useEffect(() => {
    fetchBoxSettings()
      .then((s) => { setSettings(s); setDivisor(String(s.divisor)); })
      .catch((e) => setError(e?.message || 'Could not load the box settings.'))
      .finally(() => setLoading(false));
  }, []);

  const run = async (fn: () => Promise<BoxSettings>, ok: string) => {
    setBusy(true);
    setError('');
    try {
      const s = await fn();
      setSettings(s);
      setDivisor(String(s.divisor));
      onShowToast(ok, 'success');
      return true;
    } catch (e: any) {
      setError(e?.message || 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => run(() => setBoxFeature({ enabled: !settings.enabled }),
    settings.enabled ? 'Box & weight switched off.' : 'Box & weight switched on for every station.');

  const saveDivisor = () => {
    const d = Number(divisor);
    if (!isFinite(d) || d < 1000 || d > 10000) { setError('Divisor must be between 1000 and 10000 (5000 is the usual courier value).'); return; }
    run(() => setBoxFeature({ divisor: Math.round(d) }), `Volumetric divisor set to ${Math.round(d)}.`);
  };

  const addPreset = async () => {
    const l = parseBoxNumber(form.l), b = parseBoxNumber(form.b), h = parseBoxNumber(form.h);
    if (!form.name.trim()) { setError('Give the box a name, for example Box-1.'); return; }
    if (!(l && b && h)) { setError('Length, breadth and height must be numbers above 0.'); return; }
    const done = await run(async () => (await saveBoxPreset({ name: form.name.trim(), l, b, h })).settings, `Box "${form.name.trim()}" saved.`);
    if (done) setForm({ name: '', l: '', b: '', h: '' });
  };

  return (
    <section id="box-settings-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-slate-800">Box dimensions & volumetric weight</h3>
        </div>
        <button id="box-feature-toggle" type="button" role="switch" aria-checked={settings.enabled} disabled={busy || loading} onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition cursor-pointer disabled:opacity-50 ${settings.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
          <span className="sr-only">Box & weight while packing</span>
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${settings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <p className="text-xs text-slate-600">
        When this is on, Scan & Record shows a Box & Weight panel. Packers pick a saved box or type the size (cm), type the actual
        weight (kg), and the volumetric weight is worked out straight away. The values are saved with the order in the
        PackageDetails tab and added as columns to the report download. Only the Super Admin can switch this on or off.
      </p>
      <div id="box-feature-state" className={`text-xs font-semibold ${settings.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
        {loading ? 'Loading…' : settings.enabled ? 'On for every station' : 'Off'}
      </div>

      {error && (
        <div id="box-settings-error" className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="border-t border-slate-200 pt-4 space-y-2">
        <label htmlFor="box-divisor" className="block text-xs font-semibold text-slate-700">Volumetric divisor</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id="box-divisor" type="number" min={1000} max={10000} step={1} value={divisor} onChange={(e) => setDivisor(e.target.value)} className={`${input} w-32`} />
          <button id="box-divisor-save" type="button" disabled={busy || String(settings.divisor) === divisor} onClick={saveDivisor}
            className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>Save</button>
          <span className="text-[11px] text-slate-500">Volumetric kg = L × B × H (cm) ÷ {settings.divisor}. Most couriers use {DEFAULT_VOLUMETRIC_DIVISOR}.</span>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 space-y-2">
        <div className="text-xs font-semibold text-slate-700">Saved boxes ({settings.presets.length})</div>
        <p className="text-[11px] text-slate-500">Packers and other members can also add boxes from the Box & Weight panel while packing.</p>
        {settings.presets.length > 0 && (
          <ul id="box-settings-presets" className="space-y-1">
            {settings.presets.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
                <span>{presetLabel(p)}{p.by ? <span className="text-slate-400"> · added by {p.by}</span> : null}</span>
                <button type="button" aria-label={`Remove ${p.name}`} disabled={busy}
                  onClick={() => run(() => deleteBoxPreset(p.id), `Box "${p.name}" removed.`)}
                  className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {settings.enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <input id="box-settings-name" type="text" placeholder="Name, e.g. Box-1" maxLength={40} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${input} w-40`} />
            {(['l', 'b', 'h'] as const).map((k) => (
              <input key={k} id={`box-settings-${k}`} type="text" inputMode="decimal" placeholder={k.toUpperCase() + ' cm'} value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(/[^0-9.,]/g, '') })} className={`${input} w-20`} />
            ))}
            <button id="box-settings-add" type="button" disabled={busy} onClick={addPreset}
              className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add box
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Switch the feature on to add boxes.</p>
        )}
      </div>
    </section>
  );
};
