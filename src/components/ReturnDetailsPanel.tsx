import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PackageX, Save, Trash2, CheckCircle2, Loader2, X } from 'lucide-react';
import type { User } from '../types';
import { isAdmin } from '../lib/permissions';
import {
  LogisticsPartner, ReturnSettings, RETURN_SETTINGS_EVENT, cleanPincode, deleteLogisticsPartner, fetchReturnSettings,
  flushPendingReturnDetails, getCachedReturnSettings, getReturnOrderInfo, saveLogisticsPartner, saveReturnDetails,
} from '../lib/returns';

export interface ReturnTarget {
  orderId: string;
  platform: string;
}

export interface ReturnDetailsPanelHandle {
  /** Save what is filled in for the current order (used when a return recording stops). */
  saveIfFilled: () => Promise<void>;
}

interface Props {
  target: ReturnTarget | null;
  currentUser: User | null;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
  /** A barcode scanned while the cursor was in one of these boxes: handled as an order scan. */
  onScan?: (code: string) => void;
}

interface Fields {
  returnType: string;
  partner: string;
  condition: string;
  notes: string;
  pincode: string;
  name: string;
  phone: string;
  email: string;
  claim: boolean;
}
const EMPTY: Fields = { returnType: '', partner: '', condition: '', notes: '', pincode: '', name: '', phone: '', email: '', claim: false };
const ADD_NEW = '__add__';

const targetKey = (t: ReturnTarget | null) => (t ? t.orderId.trim().toUpperCase() : '');
const hasData = (f: Fields) =>
  !!(f.returnType || f.partner || f.condition || f.notes.trim() || f.pincode.trim() || f.name.trim() || f.phone.trim() || f.email.trim() || f.claim);

/**
 * Return details on Scan & Record (Return mode): RTO or customer return, the logistics partner
 * that brought it back (pick from the shared list or add a new one), the condition, and the
 * customer's pincode / name / phone (filled in from the order data when it has them).
 */
export const ReturnDetailsPanel = forwardRef<ReturnDetailsPanelHandle, Props>(({ target, currentUser, onShowToast, onScan }, ref) => {
  const [settings, setSettings] = useState<ReturnSettings>(getCachedReturnSettings);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [savedKey, setSavedKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newPartner, setNewPartner] = useState('');
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filledFrom, setFilledFrom] = useState<'' | 'saved' | 'order'>('');

  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const targetRef = useRef<ReturnTarget | null>(target);
  targetRef.current = target;
  const shownRef = useRef<ReturnTarget | null>(target);
  if (shownRef.current && targetKey(shownRef.current) === targetKey(target)) shownRef.current = target;

  useEffect(() => {
    let alive = true;
    const load = () => fetchReturnSettings().then((s) => alive && setSettings(s)).catch(() => undefined);
    load();
    flushPendingReturnDetails().catch(() => undefined);
    const onUpdate = (e: Event) => setSettings((e as CustomEvent).detail || getCachedReturnSettings());
    window.addEventListener(RETURN_SETTINGS_EVENT, onUpdate);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener(RETURN_SETTINGS_EVENT, onUpdate);
      window.removeEventListener('focus', load);
    };
  }, []);

  const doSave = async (t: ReturnTarget, f: Fields, quiet: boolean): Promise<boolean> => {
    const pin = cleanPincode(f.pincode);
    const phoneDigits = f.phone.replace(/\D+/g, '');
    if (f.pincode.trim() && pin.length !== 6) {
      if (!quiet) setError('Pincode must be 6 digits.');
      else onShowToast(`Return details for ${t.orderId} not saved: pincode must be 6 digits.`, 'error');
      return false;
    }
    if (f.phone.trim() && phoneDigits.length < 10) {
      if (!quiet) setError('Phone must have 10 digits.');
      else onShowToast(`Return details for ${t.orderId} not saved: phone must have 10 digits.`, 'error');
      return false;
    }
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
      if (!quiet) setError('Email does not look right.');
      else onShowToast(`Return details for ${t.orderId} not saved: email does not look right.`, 'error');
      return false;
    }
    if (!hasData(f)) {
      if (!quiet) setError('Fill in at least one return detail.');
      return false;
    }
    setSaving(true);
    setError('');
    const mine = () => targetKey(targetRef.current) === targetKey(t);
    try {
      await saveReturnDetails({
        orderId: t.orderId, platform: t.platform, returnType: f.returnType, logisticsPartner: f.partner, condition: f.condition,
        notes: f.notes.trim(), pincode: pin, customerName: f.name.trim(), customerPhone: f.phone.trim(), customerEmail: f.email.trim(), notReceivedClaim: f.claim,
      });
      if (mine()) { setSavedKey(targetKey(t)); setDirty(false); }
      onShowToast(`Return details saved for ${t.orderId}.`, 'success');
      return true;
    } catch (e: any) {
      if (e?.queued) {
        if (mine()) { setSavedKey(targetKey(t)); setDirty(false); }
        onShowToast(`Return details for ${t.orderId}: ${e.message}`, 'info');
        return true;
      }
      const msg = e?.message || 'Could not save return details.';
      if (mine()) setError(msg);
      onShowToast(`Return details for ${t.orderId} not saved: ${msg}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // A new order: save anything still unsaved for the previous one, then load what is known
  // about the new one (details saved earlier, or the customer from the order data).
  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = target;
    if (targetKey(prev) !== targetKey(target)) {
      const f = fieldsRef.current;
      if (prev && dirtyRef.current && hasData(f)) doSave(prev, f, true);
      setFields(EMPTY);
      setDirty(false);
      setSavedKey('');
      setError('');
      setAdding(false);
      setFilledFrom('');
    }
    if (!target) return;
    let alive = true;
    const t = target;
    getReturnOrderInfo(t.orderId, t.platform).then(({ saved, order }) => {
      if (!alive || targetKey(targetRef.current) !== targetKey(t) || dirtyRef.current) return;
      const src = saved || order;
      if (!src) return;
      setFields({
        returnType: saved?.returnType || '',
        partner: saved?.logisticsPartner || order?.logisticsPartner || '',
        condition: saved?.condition || '',
        notes: saved?.notes || '',
        pincode: saved?.pincode || order?.pincode || '',
        name: saved?.customerName || order?.customerName || '',
        phone: saved?.customerPhone || order?.customerPhone || '',
        email: saved?.customerEmail || order?.customerEmail || '',
        claim: !!saved?.notReceivedClaim,
      });
      setFilledFrom(saved ? 'saved' : 'order');
      if (saved) setSavedKey(targetKey(t));
    }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey(target)]);

  useImperativeHandle(ref, () => ({
    saveIfFilled: async () => {
      const t = targetRef.current;
      const f = fieldsRef.current;
      if (!t || !dirtyRef.current || !hasData(f)) return;
      await doSave(t, f, true);
    },
  }));

  // A scanner types fast and ends with Enter: hand the code to the order box.
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

  const addPartner = async () => {
    const name = newPartner.trim();
    if (!name) { setError('Type the logistics partner name.'); return; }
    setBusy(true);
    try {
      const { settings: s, partner } = await saveLogisticsPartner(name);
      setSettings(s);
      edit({ partner: partner?.name || name });
      setAdding(false);
      setNewPartner('');
      onShowToast(`Logistics partner "${partner?.name || name}" saved for everyone.`, 'success');
    } catch (e: any) {
      setError(e?.message || 'Could not save the logistics partner.');
    } finally {
      setBusy(false);
    }
  };

  const removePartner = async (p: LogisticsPartner) => {
    setBusy(true);
    try {
      setSettings(await deleteLogisticsPartner(p.id));
      onShowToast(`Logistics partner "${p.name}" removed from the list.`, 'info');
    } catch (e: any) {
      setError(e?.message || 'Could not remove the logistics partner.');
    } finally {
      setBusy(false);
    }
  };

  const me = String(currentUser?.email || '').trim().toLowerCase();
  const canRemove = (p: LogisticsPartner) => isAdmin(currentUser) || (!!p.by && p.by === me);
  const saved = !!target && savedKey === targetKey(target) && !dirty;
  const partnerNames = settings.partners.map((p) => p.name);
  const partnerOffList = fields.partner && !partnerNames.some((n) => n.toLowerCase() === fields.partner.toLowerCase());
  const input = 'w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60';
  const label = 'block text-xs font-semibold text-slate-700 mb-1';

  return (
    <div id="return-details-card" className="bg-white rounded-xl border border-amber-300 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <PackageX className="w-4 h-4 text-amber-600" /> Return Details
        </h3>
        {target ? (
          <span id="return-details-order" className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono truncate max-w-[60%]" title={target.orderId}>
            {target.orderId}
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">Scan the returned order first</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="return-type" className={label}>Return type</label>
          <select id="return-type" value={fields.returnType} disabled={!target} onChange={(e) => edit({ returnType: e.target.value })} className={input}>
            <option value="">Pick one</option>
            <option value="RTO">RTO</option>
            <option value="Customer Return">Customer return</option>
          </select>
        </div>
        <div>
          <label htmlFor="return-condition" className={label}>Condition</label>
          <select id="return-condition" value={fields.condition} disabled={!target} onChange={(e) => edit({ condition: e.target.value })} className={input}>
            <option value="">Pick one</option>
            {settings.conditions.map((c) => <option key={c} value={c}>{c}</option>)}
            {fields.condition && !settings.conditions.includes(fields.condition) && <option value={fields.condition}>{fields.condition}</option>}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="return-partner" className="text-xs font-semibold text-slate-700">Logistics partner (brought it back)</label>
          {settings.partners.length > 0 && (
            <button type="button" id="return-partner-manage" onClick={() => setManaging((m) => !m)} className="text-[11px] text-blue-700 hover:underline cursor-pointer">
              {managing ? 'Done' : 'Manage list'}
            </button>
          )}
        </div>
        <select id="return-partner" value={fields.partner} disabled={!target}
          onChange={(e) => {
            if (e.target.value === ADD_NEW) { setAdding(true); setNewPartner(''); return; }
            edit({ partner: e.target.value });
          }} className={input}>
          <option value="">Pick a logistics partner</option>
          {partnerNames.map((n) => <option key={n} value={n}>{n}</option>)}
          {partnerOffList && <option value={fields.partner}>{fields.partner}</option>}
          <option value={ADD_NEW}>+ Add new partner…</option>
        </select>
        {adding && (
          <div className="mt-2 flex items-center gap-1.5">
            <input id="return-partner-new" type="text" value={newPartner} maxLength={40} autoFocus onChange={(e) => setNewPartner(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPartner(); } if (e.key === 'Escape') setAdding(false); }}
              placeholder="Partner name, e.g. Shiprocket" className={input} />
            <button type="button" id="return-partner-add" onClick={addPartner} disabled={busy}
              className="shrink-0 px-2.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
            </button>
            <button type="button" aria-label="Cancel" onClick={() => setAdding(false)} className="shrink-0 p-2 text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {managing && (
          <ul id="return-partner-list" className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {settings.partners.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
                <span className="truncate">{p.name}</span>
                {canRemove(p) && (
                  <button type="button" aria-label={`Remove ${p.name}`} disabled={busy} onClick={() => removePartner(p)}
                    className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
        <input id="return-claim" type="checkbox" checked={fields.claim} disabled={!target} onChange={(e) => edit({ claim: e.target.checked })}
          className="w-4 h-4 accent-rose-600" />
        Customer said they did not receive the order
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="return-pincode" className={label}>Pincode</label>
          <input id="return-pincode" type="text" inputMode="numeric" autoComplete="off" disabled={!target} placeholder="6 digits" value={fields.pincode}
            onKeyDown={onKeyDown} onChange={(e) => edit({ pincode: cleanPincode(e.target.value) })} className={input} />
        </div>
        <div>
          <label htmlFor="return-phone" className={label}>Customer phone</label>
          <input id="return-phone" type="text" inputMode="tel" autoComplete="off" disabled={!target} placeholder="Optional" value={fields.phone}
            onKeyDown={onKeyDown} onChange={(e) => edit({ phone: e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 16) })} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor="return-name" className={label}>Customer name</label>
        <input id="return-name" type="text" autoComplete="off" disabled={!target} placeholder="Optional" value={fields.name} maxLength={80}
          onKeyDown={onKeyDown} onChange={(e) => edit({ name: e.target.value })} className={input} />
      </div>
      <div>
        <label htmlFor="return-email" className={label}>Customer email</label>
        <input id="return-email" type="email" autoComplete="off" disabled={!target} placeholder="Optional" value={fields.email} maxLength={120}
          onKeyDown={onKeyDown} onChange={(e) => edit({ email: e.target.value.trim() })} className={input} />
      </div>
      <div>
        <label htmlFor="return-notes" className={label}>Notes</label>
        <input id="return-notes" type="text" autoComplete="off" disabled={!target} placeholder="e.g. 1 of 2 items missing" value={fields.notes} maxLength={500}
          onKeyDown={onKeyDown} onChange={(e) => edit({ notes: e.target.value })} className={input} />
      </div>
      {filledFrom === 'order' && !dirty && (
        <p id="return-filled-order" className="text-[11px] text-emerald-700">Customer and pincode filled in from the order.</p>
      )}

      {error && <div id="return-details-error" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between gap-2">
        {saved ? (
          <span id="return-details-saved" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">{target ? 'Saved automatically when the recording stops.' : ''}</span>
        )}
        <button type="button" id="return-details-save" disabled={!target || saving || !hasData(fields) || saved}
          onClick={() => target && doSave(target, fields, false)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save details
        </button>
      </div>
    </div>
  );
});
ReturnDetailsPanel.displayName = 'ReturnDetailsPanel';
