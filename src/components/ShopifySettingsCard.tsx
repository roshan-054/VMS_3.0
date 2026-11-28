import React, { useEffect, useState } from 'react';
import { ShoppingBag, Loader2, AlertTriangle, CheckCircle2, RefreshCw, PlugZap } from 'lucide-react';
import { fmtDateTime } from '../lib/dateFormat';
import { ShopifySettings, fetchShopifySettings, saveShopifySettings, syncShopifyNow, testShopifyConnection } from '../lib/shopify';

interface Props {
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const card = 'bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4';
const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';
const input = 'w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Settings > Shopify orders (Super Admin only): connect the store and switch the order import on or off. */
export const ShopifySettingsCard: React.FC<Props> = ({ onShowToast }) => {
  const [s, setS] = useState<ShopifySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ shop: '', clientId: '', clientSecret: '', adminToken: '', backfillDays: '3' });
  const [useToken, setUseToken] = useState(false);

  const apply = (x: ShopifySettings) => {
    setS(x);
    setForm((f) => ({ ...f, shop: x.shop || '', clientId: x.clientId || '', clientSecret: '', adminToken: '', backfillDays: String(x.backfillDays || 3) }));
    setUseToken(x.connectedWith === 'adminToken');
  };

  useEffect(() => {
    fetchShopifySettings().then(apply).catch((e) => setError(e?.message || 'Could not load the Shopify settings.')).finally(() => setLoading(false));
  }, []);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError('');
    setNote('');
    try { await fn(); } catch (e: any) { setError(e?.message || 'That did not work.'); } finally { setBusy(''); }
  };

  const save = () => run('save', async () => {
    const change: any = { shop: form.shop.trim(), backfillDays: Number(form.backfillDays) || 3 };
    if (useToken) {
      if (form.adminToken.trim()) change.adminToken = form.adminToken.trim();
    } else {
      change.clientId = form.clientId.trim();
      if (form.clientSecret.trim()) change.clientSecret = form.clientSecret.trim();
      if (s?.hasAdminToken) change.clearAdminToken = true;
    }
    apply(await saveShopifySettings(change));
    onShowToast('Shopify connection saved.', 'success');
  });

  const test = () => run('test', async () => {
    const r = await testShopifyConnection();
    setNote(`Connected to ${r.shopName || r.shop}.` + (r.latestOrder ? ` Latest order: ${r.latestOrder}${r.latestOrderAt ? ' (' + fmtDateTime(r.latestOrderAt) + ')' : ''}.` : ''));
  });

  const toggle = () => run('toggle', async () => {
    const on = !s?.enabled;
    apply(await saveShopifySettings({ enabled: on }));
    onShowToast(on ? 'Shopify orders switched on. New orders arrive every 5 minutes.' : 'Shopify orders switched off.', 'success');
  });

  const syncNow = () => run('sync', async () => {
    const r = await syncShopifyNow();
    if (!r.success) throw new Error(r.error || 'Shopify sync failed.');
    setNote(`Sync done: ${r.added || 0} new, ${r.updated || 0} changed, ${r.unchanged || 0} unchanged.` + (r.more ? ' More orders are waiting; the next run carries on.' : '') +
      (r.customerData === false ? ' ' + (r.note || 'Customer details were not saved: the app has no customer data access yet.') : ''));
    apply(await fetchShopifySettings());
  });

  const last = s?.lastResult;
  const connected = !!s && (s.hasAdminToken || (s.hasClientSecret && !!s.clientId)) && !!s.shop;

  return (
    <section id="shopify-settings-card" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800">Shopify orders</h3>
        </div>
        <button id="shopify-feature-toggle" type="button" role="switch" aria-checked={!!s?.enabled} disabled={!!busy || loading || (!connected && !s?.enabled)} onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition cursor-pointer disabled:opacity-50 ${s?.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
          <span className="sr-only">Fetch Shopify orders</span>
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${s?.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <p className="text-xs text-slate-600">
        When this is on, VMS fetches new Shopify orders every 5 minutes into Supabase and the ShopifyOrders tab of the Google Sheet.
        In Order Processing the team sees them waiting, and picking one fills in its products, SKUs and quantities, with each SKU's
        barcode taken from the GTIN catalog. Each order also keeps Prepaid or COD, its Shopify tags, payment and shipping status, courier and tracking number, and the customer's name, phone, email and shipping pincode, city and state (for return and RTO analysis). Only the Super Admin can change this.
      </p>
      <div id="shopify-feature-state" className={`text-xs font-semibold ${s?.enabled ? 'text-emerald-700' : 'text-slate-500'}`}>
        {loading ? 'Loading…' : s?.enabled ? (s.autoSync ? 'On: checking Shopify every 5 minutes' : 'On, but the 5-minute timer is missing. Switch off and on again.') : connected ? 'Off' : 'Off: connect the store first'}
      </div>

      {error && (
        <div id="shopify-settings-error" className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {note && (
        <div id="shopify-settings-note" className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> <span>{note}</span>
        </div>
      )}

      <div className="border-t border-slate-200 pt-4 space-y-3">
        <div className="text-xs font-semibold text-slate-700">Connection</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-xs text-slate-600">Store address
            <input id="shopify-shop" type="text" value={form.shop} placeholder="yourstore.myshopify.com" onChange={(e) => setForm({ ...form, shop: e.target.value })} className={input} />
          </label>
          <label className="block text-xs text-slate-600">First import goes back (days)
            <input id="shopify-backfill" type="number" min={1} max={60} value={form.backfillDays} onChange={(e) => setForm({ ...form, backfillDays: e.target.value })} className={input} />
          </label>
        </div>
        <div className="flex gap-4 text-xs text-slate-700">
          <label className="inline-flex items-center gap-1.5"><input type="radio" checked={!useToken} onChange={() => setUseToken(false)} /> Dev Dashboard app (client ID + secret)</label>
          <label className="inline-flex items-center gap-1.5"><input type="radio" checked={useToken} onChange={() => setUseToken(true)} /> Admin API access token (older custom app)</label>
        </div>
        {useToken ? (
          <label className="block text-xs text-slate-600">Admin API access token {s?.hasAdminToken && <span className="text-emerald-700 font-semibold">(saved; leave empty to keep it)</span>}
            <input id="shopify-admin-token" type="password" autoComplete="off" value={form.adminToken} placeholder="shpat_…" onChange={(e) => setForm({ ...form, adminToken: e.target.value })} className={input} />
          </label>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block text-xs text-slate-600">Client ID
              <input id="shopify-client-id" type="text" autoComplete="off" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={input} />
            </label>
            <label className="block text-xs text-slate-600">Client secret {s?.hasClientSecret && <span className="text-emerald-700 font-semibold">(saved; leave empty to keep it)</span>}
              <input id="shopify-client-secret" type="password" autoComplete="off" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} className={input} />
            </label>
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          The secret is kept in the Apps Script project only. It is never shown again, sent to stations or copied to Supabase or the Sheet.
          The app needs the <b>read_orders</b>, <b>read_products</b> and <b>read_customers</b> access scopes, plus Shopify's protected customer data access for name, email, phone and address, and must be installed on the store. Without customer data access the orders still arrive, just without the customer details.
        </p>
        <div className="flex flex-wrap gap-2">
          <button id="shopify-save" type="button" onClick={save} disabled={!!busy || loading} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
          <button id="shopify-test" type="button" onClick={test} disabled={!!busy || !connected} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />} Test connection
          </button>
          <button id="shopify-sync" type="button" onClick={syncNow} disabled={!!busy || !s?.enabled} className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            {busy === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync now
          </button>
        </div>
      </div>

      {last && (
        <div id="shopify-last-run" className="border-t border-slate-200 pt-3 text-xs text-slate-600">
          Last run {fmtDateTime(last.at)} ({last.source === 'auto' ? 'every 5 minutes' : 'by hand'}):{' '}
          {last.success
            ? `${last.added || 0} new, ${last.updated || 0} changed${last.cancelledManifests ? `, ${last.cancelledManifests} assigned order${last.cancelledManifests === 1 ? '' : 's'} cancelled in Shopify` : ''}.` +
              (last.customerData === false ? ' Customer details not saved (no customer data access yet).' : '')
            : <span className="text-rose-700">{last.error}</span>}
        </div>
      )}
    </section>
  );
};
