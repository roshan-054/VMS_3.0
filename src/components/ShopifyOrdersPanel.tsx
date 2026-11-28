import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, RefreshCw, AlertTriangle, ArrowRight, Loader2, Search, UserCheck } from 'lucide-react';
import type { OrderManifest, User } from '../types';
import { normalizeOrderId } from '../lib/api';
import { saveMultipleManifests, getStoredManifests } from '../lib/manifestStorage';
import { fmtDateTime } from '../lib/dateFormat';
import {
  ShopifyOrder, ShopifyOrdersResult, SHOPIFY_ORDERS_EVENT, fetchShopifyOrders, getCachedShopifyOrders,
  itemsMissingGtin, shopifyItemsToManifest, syncShopifyNow,
} from '../lib/shopify';

interface Props {
  manifests: OrderManifest[];
  packers: User[];
  currentUser: User | null;
  onFill: (order: ShopifyOrder) => void;
  onAssigned: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const REFRESH_MS = 60000;
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer';

/**
 * Order Processing > New Order Entry: Shopify orders that are not assigned yet. "Fill form" puts
 * the order's products in the form below; ticking orders and picking a packer assigns them in one go.
 */
export const ShopifyOrdersPanel: React.FC<Props> = ({ manifests, packers, currentUser, onFill, onAssigned, onShowToast }) => {
  const [data, setData] = useState<ShopifyOrdersResult>(getCachedShopifyOrders);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packerEmail, setPackerEmail] = useState('');
  const [assigning, setAssigning] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await fetchShopifyOrders());
      setError('');
    } catch (e: any) {
      if (!quiet) setError(e?.message || 'Could not load Shopify orders.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    const onUpd = () => setData(getCachedShopifyOrders());
    window.addEventListener(SHOPIFY_ORDERS_EVENT, onUpd);
    return () => { clearInterval(t); window.removeEventListener(SHOPIFY_ORDERS_EVENT, onUpd); };
  }, []);

  useEffect(() => {
    // Keep a real packer picked (the list starts with a stand-in until the users have loaded).
    if (packers.length && !packers.some((u) => u.email === packerEmail)) setPackerEmail(packers[0].email);
  }, [packers, packerEmail]);

  const assignedKeys = useMemo(() => new Set(manifests.map((m) => normalizeOrderId(m.orderId))), [manifests]);
  const waiting = useMemo(() => data.orders.filter((o) => !assignedKeys.has(normalizeOrderId(o.orderId))), [data.orders, assignedKeys]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return waiting;
    return waiting.filter((o) => o.orderId.toLowerCase().includes(q) ||
      o.items.some((it) => (it.sku || '').toLowerCase().includes(q) || (it.shortName || it.productName || '').toLowerCase().includes(q)));
  }, [waiting, query]);

  if (!data.enabled) return null;

  const syncNow = async () => {
    setSyncing(true);
    setError('');
    try {
      const r = await syncShopifyNow();
      if (!r.success) setError(r.error || 'Shopify sync failed.');
      else onShowToast(r.added ? `${r.added} new Shopify order${r.added === 1 ? '' : 's'} added.` : 'No new Shopify orders.', 'success');
      await load(true);
    } catch (e: any) {
      setError(e?.message || 'Shopify sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const assignSelected = async () => {
    const packer = packers.find((u) => u.email === packerEmail);
    if (!packer) { onShowToast('Pick the packer first.', 'error'); return; }
    const picked = waiting.filter((o) => selected.has(o.orderId));
    const ready: OrderManifest[] = [];
    const blocked: string[] = [];
    const already = new Set(getStoredManifests().map((m) => normalizeOrderId(m.orderId)));
    for (const o of picked) {
      if (already.has(normalizeOrderId(o.orderId))) continue;
      const items = shopifyItemsToManifest(o);
      if (!items.length || itemsMissingGtin(items).length) { blocked.push(o.orderId); continue; }
      ready.push({
        id: 'manifest-' + Date.now() + '-' + ready.length,
        orderId: o.orderId,
        platform: 'D2C',
        assignedPackerName: packer.name,
        assignedPackerEmail: packer.email.trim().toLowerCase(),
        processedByName: currentUser?.name || 'Processing Team',
        processedByEmail: currentUser?.email || 'processing@ops.local',
        processedAt: new Date().toISOString(),
        items,
        status: 'Pending',
        notes: 'From Shopify',
      });
    }
    if (!ready.length) {
      onShowToast(blocked.length ? `Not assigned: ${blocked.join(', ')} ha${blocked.length === 1 ? 's' : 've'} a product whose SKU is not in the GTIN catalog.` : 'Tick at least one order.', 'error');
      return;
    }
    setAssigning(true);
    try {
      await saveMultipleManifests(ready);
      setSelected(new Set());
      onAssigned();
      onShowToast(`${ready.length} Shopify order${ready.length === 1 ? '' : 's'} assigned to ${packer.name}.` +
        (blocked.length ? ` Not assigned (SKU missing from the GTIN catalog): ${blocked.join(', ')}.` : ''), blocked.length ? 'info' : 'success');
    } finally {
      setAssigning(false);
    }
  };

  const allShownSelected = shown.length > 0 && shown.every((o) => selected.has(o.orderId));

  return (
    <section id="shopify-orders-panel" className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-emerald-600" />
          <h2 className="text-sm font-black text-slate-900">Shopify orders waiting to be assigned ({waiting.length})</h2>
        </div>
        <div className="flex items-center gap-2">
          {data.lastSync && <span className="text-[11px] text-slate-500">Newest order arrived {fmtDateTime(data.lastSync)}</span>}
          <button id="shopify-sync-now" type="button" onClick={syncNow} disabled={syncing}
            className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync now
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-600">
        New Shopify orders arrive here every 5 minutes. Click <b>Fill form</b> to load an order's products into the form below,
        or tick orders and assign them to a packer in one go. Typing or scanning a Shopify order ID in the form fills it in too.
      </p>

      {error && (
        <div id="shopify-orders-error" className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input id="shopify-orders-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order ID, SKU or product"
            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs w-56 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select id="shopify-bulk-packer" value={packerEmail} onChange={(e) => setPackerEmail(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800">
          <option value="">-- Choose packer --</option>
          {packers.map((u) => <option key={u.email} value={u.email}>{u.name} ({u.email})</option>)}
        </select>
        <button id="shopify-assign-selected" type="button" onClick={assignSelected} disabled={assigning || selected.size === 0}
          className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
          {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />} Assign {selected.size || ''} selected
        </button>
      </div>

      {loading && !data.orders.length ? (
        <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Shopify orders…</div>
      ) : shown.length === 0 ? (
        <div id="shopify-orders-empty" className="text-xs text-slate-500">{waiting.length ? 'No order matches the search.' : 'Every open Shopify order is assigned.'}</div>
      ) : (
        <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                <th className="p-2 w-8">
                  <input type="checkbox" aria-label="Select all shown" checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((o) => o.orderId)))} />
                </th>
                <th className="p-2 text-left">Order</th>
                <th className="p-2 text-left">Products</th>
                <th className="p-2 text-left">Prepaid / COD</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.orderId} data-order={o.orderId} className="border-t border-slate-100 align-top">
                  <td className="p-2 text-center">
                    <input type="checkbox" aria-label={`Select ${o.orderId}`} checked={selected.has(o.orderId)} onChange={() => toggle(o.orderId)} />
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <div className="font-mono font-bold text-slate-900">{o.orderId}</div>
                    <div className="text-[11px] text-slate-500">{o.orderDate ? fmtDateTime(o.orderDate) : ''}</div>
                  </td>
                  <td className="p-2">
                    <ul className="space-y-0.5">
                      {o.items.map((it) => (
                        <li key={it.id} className="text-slate-700">
                          <span className="font-semibold">{it.quantity} ×</span> {it.shortName || it.productName}
                          <span className="font-mono text-[11px] text-slate-500"> [{it.sku || 'no SKU'}]</span>
                          {!it.inCatalog && <span className="ml-1 text-[11px] font-semibold text-amber-700">SKU not in GTIN catalog</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${o.paymentMode === 'COD' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                      {o.paymentMode || (o.payment === 'PENDING' ? 'COD' : 'Prepaid')}
                    </span>
                    {o.tags && <div className="text-[11px] text-slate-500 mt-0.5 max-w-[10rem] truncate" title={o.tags}>{o.tags}</div>}
                  </td>
                  <td className="p-2 text-right">
                    <button type="button" onClick={() => onFill(o)} className={`${btn} border border-indigo-200 text-indigo-700 hover:bg-indigo-50`}>
                      Fill form <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
