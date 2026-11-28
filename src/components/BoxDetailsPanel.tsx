import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Box, Plus, Save, Trash2, CheckCircle2, Loader2, X } from 'lucide-react';
import type { User } from '../types';
import { isAdmin } from '../lib/permissions';
import {
  BoxPreset, BoxSettings, BOX_SETTINGS_EVENT, chargeableWeight, deleteBoxPreset, fetchBoxSettings,
  flushPendingPackageDetails, fmtNum, getCachedBoxSettings, parseBoxNumber, presetLabel, saveBoxPreset,
  savePackageDetails, volumetricWeight,
} from '../lib/boxes';

export interface BoxTarget {
  orderId: string;
  platform: string;
  recordingType: string;
}

export interface BoxDetailsPanelHandle {
  /** Save what is filled in for the current order (used when a recording stops). */
  saveIfFilled: () => Promise<void>;
}

interface Props {
  target: BoxTarget | null;
  currentUser: User | null;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  /** A barcode scanned while the cursor was in one of these boxes: handled as an order scan. */
  onScan?: (code: string) => void;
}

const targetKey = (t: BoxTarget | null) => (t ? `${t.orderId.trim().toUpperCase()}|${String(t.recordingType).toLowerCase()}` : '');
const CUSTOM = '__custom__';

interface Fields { presetId: string; l: string; b: string; h: string; weight: string }
const EMPTY: Fields = { presetId: '', l: '', b: '', h: '', weight: '' };

const hasData = (f: Fields) => !!(f.l.trim() || f.b.trim() || f.h.trim() || f.weight.trim());

/**
 * Box & weight while packing: pick a saved box size (or type L x B x H in cm), type the actual
 * weight in kg, and the volumetric weight is worked out straight away. Shown only when the
 * Super Admin has switched the feature on in Settings.
 */
export const BoxDetailsPanel = forwardRef<BoxDetailsPanelHandle, Props>(({ target, currentUser, onShowToast, onScan }, ref) => {
  const [settings, setSettings] = useState<BoxSettings>(getCachedBoxSettings);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [savedKey, setSavedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingPreset, setAddingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [managing, setManaging] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);

  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Latest order (platform can still change after the order is scanned) and the order the
  // boxes were last filled for.
  const targetRef = useRef<BoxTarget | null>(target);
  targetRef.current = target;
  const shownRef = useRef<BoxTarget | null>(target);
  if (shownRef.current && targetKey(shownRef.current) === targetKey(target)) shownRef.current = target;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let alive = true;
    const load = () => fetchBoxSettings().then((s) => alive && setSettings(s)).catch(() => undefined);
    load();
    flushPendingPackageDetails().catch(() => undefined);
    const onUpdate = (e: Event) => setSettings((e as CustomEvent).detail || getCachedBoxSettings());
    const onFocus = () => load();
    window.addEventListener(BOX_SETTINGS_EVENT, onUpdate);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.removeEventListener(BOX_SETTINGS_EVENT, onUpdate);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const nums = useMemo(() => {
    const l = parseBoxNumber(fields.l), b = parseBoxNumber(fields.b), h = parseBoxNumber(fields.h);
    const actual = parseBoxNumber(fields.weight);
    const vol = volumetricWeight(l, b, h, settings.divisor);
    return { l, b, h, actual, vol, charge: chargeableWeight(actual, vol) };
  }, [fields, settings.divisor]);

  const doSave = async (t: BoxTarget, f: Fields, quiet: boolean): Promise<boolean> => {
    const l = parseBoxNumber(f.l), b = parseBoxNumber(f.b), h = parseBoxNumber(f.h), actual = parseBoxNumber(f.weight);
    const dims = [l, b, h].filter((x) => x !== null).length;
    if ((f.l.trim() && l === null) || (f.b.trim() && b === null) || (f.h.trim() && h === null) || (f.weight.trim() && actual === null)) {
      if (!quiet) setError('Sizes and weight must be numbers above 0.');
      return false;
    }
    if (dims > 0 && dims < 3) {
      if (!quiet) setError('Enter all three: length, breadth and height.');
      else onShowToast(`Box details for ${t.orderId} not saved: length, breadth and height are all needed.`, 'error');
      return false;
    }
    if (!dims && actual === null) {
      if (!quiet) setError('Enter the box size or the actual weight.');
      return false;
    }
    const preset = settingsRef.current.presets.find((p) => p.id === f.presetId);
    const boxName = preset && preset.l === l && preset.b === b && preset.h === h ? preset.name : dims ? 'Custom' : '';
    setSaving(true);
    setError('');
    try {
      const res: any = await savePackageDetails({
        orderId: t.orderId, platform: t.platform, recordingType: t.recordingType, boxName, l, b, h, actualWeight: actual,
      });
      if (targetKey(targetRef.current) === targetKey(t)) {
        setSavedKey(targetKey(t));
        setDirty(false);
      }
      const vol = res?.volumetricWeight;
      onShowToast(`Box details saved for ${t.orderId}${vol ? ` (volumetric ${fmtNum(vol)} kg)` : ''}.`, 'success');
      return true;
    } catch (e: any) {
      if (e?.queued) {
        if (targetKey(targetRef.current) === targetKey(t)) {
          setSavedKey(targetKey(t));
          setDirty(false);
        }
        onShowToast(`Box details for ${t.orderId}: ${e.message}`, 'info');
        return true;
      }
      const msg = e?.message || 'Could not save box details.';
      if (targetKey(targetRef.current) === targetKey(t)) setError(msg);
      onShowToast(`Box details for ${t.orderId} not saved: ${msg}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // A new order: anything typed for the previous order and not saved yet is saved for it first
  // (for example the weight typed after the recording stopped), then the boxes start empty.
  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = target;
    if (targetKey(prev) === targetKey(target)) return;
    const f = fieldsRef.current;
    if (prev && dirtyRef.current && hasData(f) && settingsRef.current.enabled) {
      doSave(prev, f, true);
    }
    if (dirtyRef.current || savedKey) {
      setFields(EMPTY);
      setDirty(false);
      setSavedKey('');
      setError('');
      setAddingPreset(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey(target)]);

  useImperativeHandle(ref, () => ({
    saveIfFilled: async () => {
      const t = targetRef.current;
      const f = fieldsRef.current;
      if (!t || !settingsRef.current.enabled || !dirtyRef.current || !hasData(f)) return;
      await doSave(t, f, true);
    },
  }));

  // A scanner types fast and ends with Enter: hand the code to the order box instead of
  // leaving it in a size or weight box.
  const burst = useRef<{ text: string; lastAt: number; before: Fields | null }>({ text: '', lastAt: 0, before: null });
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    const b = burst.current;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (now - b.lastAt > 80) { b.text = ''; b.before = { ...fieldsRef.current }; }
      b.text += e.key;
      b.lastAt = now;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const isScan = b.text.length >= 4 && now - b.lastAt < 200;
      const before = b.before;
      burst.current = { text: '', lastAt: 0, before: null };
      if (isScan && onScan) {
        if (before) setFields(before);
        (e.currentTarget as HTMLInputElement).blur();
        onScan(b.text);
      } else if (target) {
        doSave(target, fieldsRef.current, false);
      }
    }
  };

  const edit = (patch: Partial<Fields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setDirty(true);
    setError('');
  };

  const pickPreset = (id: string) => {
    if (id === CUSTOM || !id) { edit({ presetId: '' }); return; }
    const p = settings.presets.find((x) => x.id === id);
    if (p) edit({ presetId: id, l: fmtNum(p.l), b: fmtNum(p.b), h: fmtNum(p.h) });
  };

  const addPreset = async () => {
    if (!presetName.trim()) { setError('Give the box a name, for example Box-1.'); return; }
    if (!(nums.l && nums.b && nums.h)) { setError('Type length, breadth and height first.'); return; }
    setPresetBusy(true);
    try {
      const { settings: s, preset } = await saveBoxPreset({ name: presetName.trim(), l: nums.l, b: nums.b, h: nums.h });
      setSettings(s);
      setFields((f) => ({ ...f, presetId: preset?.id || f.presetId }));
      setAddingPreset(false);
      setPresetName('');
      onShowToast(`Box size "${preset?.name || presetName}" saved for everyone.`, 'success');
    } catch (e: any) {
      setError(e?.message || 'Could not save the box size.');
    } finally {
      setPresetBusy(false);
    }
  };

  const removePreset = async (p: BoxPreset) => {
    setPresetBusy(true);
    try {
      setSettings(await deleteBoxPreset(p.id));
      if (fields.presetId === p.id) setFields((f) => ({ ...f, presetId: '' }));
      onShowToast(`Box size "${p.name}" removed.`, 'info');
    } catch (e: any) {
      setError(e?.message || 'Could not remove the box size.');
    } finally {
      setPresetBusy(false);
    }
  };

  if (!settings.enabled) return null;

  const me = String(currentUser?.email || '').trim().toLowerCase();
  const canRemove = (p: BoxPreset) => isAdmin(currentUser) || !p.by || p.by === me;
  const saved = !!target && savedKey === targetKey(target) && !dirty;
  const input = 'w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';

  return (
    <div id="box-details-card" className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Box className="w-4 h-4 text-blue-600" /> Box & Weight
        </h3>
        {target ? (
          <span id="box-details-order" className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono truncate max-w-[60%]" title={`${target.orderId} · ${target.recordingType}`}>
            {target.orderId} · {target.recordingType}
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">Scan an order first</span>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="boxPresetSelect" className="text-xs font-semibold text-slate-700">Box</label>
          {settings.presets.length > 0 && (
            <button type="button" id="box-manage-toggle" onClick={() => setManaging((m) => !m)} className="text-[11px] text-blue-700 hover:underline cursor-pointer">
              {managing ? 'Done' : 'Manage boxes'}
            </button>
          )}
        </div>
        <select id="boxPresetSelect" value={fields.presetId || (hasData(fields) ? CUSTOM : '')} disabled={!target}
          onChange={(e) => pickPreset(e.target.value)} className={input}>
          <option value="" disabled>{settings.presets.length ? 'Pick a saved box' : 'No saved boxes yet: type the size'}</option>
          {settings.presets.map((p) => <option key={p.id} value={p.id}>{presetLabel(p)}</option>)}
          <option value={CUSTOM}>Custom size</option>
        </select>
        {managing && (
          <ul id="box-preset-list" className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {settings.presets.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
                <span className="truncate">{presetLabel(p)}</span>
                {canRemove(p) && (
                  <button type="button" aria-label={`Remove ${p.name}`} disabled={presetBusy} onClick={() => removePreset(p)}
                    className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-700 mb-1">Size (cm) L × B × H</div>
        <div className="grid grid-cols-3 gap-2">
          {(['l', 'b', 'h'] as const).map((k) => (
            <input key={k} id={`box-${k}`} type="text" inputMode="decimal" autoComplete="off" disabled={!target}
              placeholder={k === 'l' ? 'Length' : k === 'b' ? 'Breadth' : 'Height'} aria-label={k === 'l' ? 'Length (cm)' : k === 'b' ? 'Breadth (cm)' : 'Height (cm)'}
              value={fields[k]} onKeyDown={onKeyDown}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.,]/g, '');
                const p = settings.presets.find((x) => x.id === fields.presetId);
                const next = { ...fields, [k]: v };
                const stillPreset = p && fmtNum(p.l) === next.l && fmtNum(p.b) === next.b && fmtNum(p.h) === next.h;
                edit({ [k]: v, presetId: stillPreset ? fields.presetId : '' } as Partial<Fields>);
              }}
              className={input} />
          ))}
        </div>
        {!fields.presetId && nums.l && nums.b && nums.h && !addingPreset && (
          <button type="button" id="box-add-preset" onClick={() => { setAddingPreset(true); setPresetName(`Box-${settings.presets.length + 1}`); }}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer">
            <Plus className="w-3 h-3" /> Save this size as a box
          </button>
        )}
        {addingPreset && (
          <div className="mt-2 flex items-center gap-1.5">
            <input id="box-preset-name" type="text" value={presetName} maxLength={40} onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPreset(); } }}
              placeholder="Box name, e.g. Box-1" className={input} />
            <button type="button" id="box-preset-save" onClick={addPreset} disabled={presetBusy}
              className="shrink-0 px-2.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
              {presetBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
            </button>
            <button type="button" aria-label="Cancel" onClick={() => setAddingPreset(false)} className="shrink-0 p-2 text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="box-weight" className="block text-xs font-semibold text-slate-700 mb-1">Actual weight (kg)</label>
        <input id="box-weight" type="text" inputMode="decimal" autoComplete="off" disabled={!target} placeholder="e.g. 0.45"
          value={fields.weight} onKeyDown={onKeyDown}
          onChange={(e) => edit({ weight: e.target.value.replace(/[^0-9.,]/g, '') })} className={input} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">Volumetric weight</div>
          <div id="box-volumetric" className="text-base font-bold text-slate-900">{nums.vol !== null ? `${fmtNum(nums.vol)} kg` : '–'}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">Chargeable weight</div>
          <div id="box-chargeable" className="text-base font-bold text-slate-900">{nums.charge !== null ? `${fmtNum(nums.charge)} kg` : '–'}</div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">L × B × H ÷ {settings.divisor}. Chargeable is the higher of actual and volumetric weight.</p>

      {error && <div id="box-details-error" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between gap-2">
        {saved ? (
          <span id="box-details-saved" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">{target ? 'Saved automatically when the recording stops.' : ''}</span>
        )}
        <button type="button" id="box-details-save" disabled={!target || saving || !hasData(fields) || saved}
          onClick={() => target && doSave(target, fields, false)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save box
        </button>
      </div>
    </div>
  );
});
BoxDetailsPanel.displayName = 'BoxDetailsPanel';
