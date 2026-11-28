import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, PackageX, RefreshCw, Repeat, Search, Truck, MapPin, Info, Tag, Wallet } from 'lucide-react';
import { requestApi } from '../lib/api';
import { fmtDate } from '../lib/dateFormat';

interface Group {
  name: string;
  city?: string;
  returns: number;
  rto: number;
  customerReturns: number;
  claims: number;
  damaged: number;
  orders: number | null;
  returnRate: number | null;
  rtoRate: number | null;
  share: number | null;
}

interface Customer {
  name: string;
  phone: string;
  phoneFull?: string;
  email: string;
  pincode: string;
  city: string;
  orders: number;
  returns: number;
  rto: number;
  customerReturns?: number;
  claims?: number;
  damaged?: number;
  returnRate?: number | null;
  lastReturn?: string;
  suspicious?: boolean;
  reasons?: string[];
  returnOrders?: { orderId: string; date: string; type: string; partner: string; condition: string; claim: boolean }[];
}

interface RecentReturn {
  orderId: string;
  platform: string;
  date: string;
  returnType: string;
  partner: string;
  condition: string;
  notes: string;
  claim: boolean;
  pincode: string;
  name: string;
  phone: string;
}

interface TagGroup {
  name: string;
  orders: number;
  packed: number;
  returns: number;
  rto: number;
  customerReturns: number;
  claims: number;
  returnRate: number | null;
  rtoRate: number | null;
}

export interface ReturnAnalyticsData {
  success: boolean;
  orderData: { available: boolean; hasCustomer: boolean; hasPincode: boolean; hasCourier: boolean; hasTags?: boolean; hasPayMode?: boolean };
  tags?: string[];
  byTag?: TagGroup[];
  byPayment?: TagGroup[];
  totals: { returns: number; rto: number; customerReturns: number; untyped: number; notReceivedClaims: number; damaged: number; withDetails: number; forwardPacked: number; ordersInData: number };
  returnRate: number | null;
  rtoRate: number | null;
  rateBase: 'orders' | 'packed';
  byPartner: Group[];
  byPincode: Group[];
  byCondition: { name: string; count: number }[];
  customers: Customer[];
  suspicious: Customer[];
  repeatCustomers: Customer[];
  recent: RecentReturn[];
}

interface Props {
  fromDate: string;
  toDate: string;
  platform: string;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n}%`);
const phoneOf = (c: { phone: string; phoneFull?: string }) => c.phoneFull || c.phone || '';

function Tile({ id, label, value, sub, tone }: { id: string; label: string; value: string | number; sub?: string; tone?: 'rose' | 'amber' | 'slate' }) {
  const color = tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div id={id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const th = 'px-3 py-2 text-left text-[11px] font-bold text-slate-600 whitespace-nowrap';
const td = 'px-3 py-2 text-xs text-slate-800 whitespace-nowrap';
const tdNum = 'px-3 py-2 text-xs text-slate-800 text-right tabular-nums whitespace-nowrap';

/** Analytics > Returns & RTO: return and RTO counts and rates by courier, pincode and customer. */
export const ReturnsAnalytics: React.FC<Props> = ({ fromDate, toDate, platform, onShowToast }) => {
  const [data, setData] = useState<ReturnAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pinSearch, setPinSearch] = useState('');
  const [custSearch, setCustSearch] = useState('');
  const [openCustomer, setOpenCustomer] = useState<string>('');
  // Shopify tag filter: '' = all orders; "AiSensy (all)" is sent as "AiSensy*".
  const [tagFilter, setTagFilter] = useState('');
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (fromDate > toDate) return;
    const n = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const tag = tagFilter.endsWith(' (all)') ? `${tagFilter.slice(0, -6)}*` : tagFilter;
      const res = await requestApi<ReturnAnalyticsData>('getReturnAnalytics', { fromDate, toDate, platform: platform === 'all' ? '' : platform, tag });
      if (n === seq.current) {
        setData(res as unknown as ReturnAnalyticsData);
        const list = (res as any)?.tags;
        if (Array.isArray(list) && list.length) setTagOptions(list);
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (n === seq.current) setError(/unknown action/i.test(msg)
        ? 'The backend is on an older version. A Super Admin or settings manager can click Settings > Backend code > Update backend now, then Try again.'
        : msg || 'Could not load return analytics.');
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [fromDate, toDate, platform, tagFilter]);

  useEffect(() => { load(); }, [load]);

  const pins = useMemo(() => {
    const q = pinSearch.trim().toLowerCase();
    const list = data?.byPincode || [];
    return q ? list.filter((g) => g.name.toLowerCase().includes(q) || String(g.city || '').toLowerCase().includes(q)) : list;
  }, [data, pinSearch]);

  const custMatch = (c: Customer) => {
    const q = custSearch.trim().toLowerCase();
    if (!q) return true;
    return [c.name, phoneOf(c), c.email, c.pincode, c.city].some((x) => String(x || '').toLowerCase().includes(q));
  };

  const exportExcel = async () => {
    if (!data) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const add = (name: string, rows: Record<string, unknown>[]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No data in this range' }]), name);
      };
      const groupRows = (list: Group[], label: string) => list.map((g) => ({
        [label]: g.name, ...(label === 'Pincode' ? { City: g.city || '' } : {}), Orders: g.orders ?? '', Returns: g.returns, RTO: g.rto,
        'Customer Returns': g.customerReturns, 'Not Received Claims': g.claims, 'Bad Condition': g.damaged,
        'Return Rate %': g.returnRate ?? '', 'RTO Rate %': g.rtoRate ?? '', 'Share of Returns %': g.share ?? '',
      }));
      const custRows = (list: Customer[]) => list.map((c) => ({
        Customer: c.name, Phone: phoneOf(c), Email: c.email, Pincode: c.pincode, City: c.city, Orders: c.orders, Returns: c.returns,
        RTO: c.rto, 'Not Received Claims': c.claims ?? '', 'Bad Condition': c.damaged ?? '', 'Return Rate %': c.returnRate ?? '',
        'Last Return': c.lastReturn ? fmtDate(c.lastReturn) : '', Flags: (c.reasons || []).join('; '),
        'Returned Orders': (c.returnOrders || []).map((o) => o.orderId).join(', '),
      }));
      add('Summary', [{
        From: fmtDate(fromDate), To: fmtDate(toDate), 'Order Tag': tagFilter || 'All orders', Returns: data.totals.returns, RTO: data.totals.rto, 'Customer Returns': data.totals.customerReturns,
        'Not Received Claims': data.totals.notReceivedClaims, Damaged: data.totals.damaged,
        'Return Rate %': data.returnRate ?? '', 'RTO Rate %': data.rtoRate ?? '',
        'Rate Based On': data.rateBase === 'orders' ? `${data.totals.ordersInData} orders in order data` : `${data.totals.forwardPacked} packed videos`,
      }]);
      add('By Logistics Partner', groupRows(data.byPartner, 'Logistics Partner'));
      add('By Pincode', groupRows(data.byPincode, 'Pincode'));
      const tagRows = (list: TagGroup[] | undefined, label: string) => (list || []).map((g) => ({
        [label]: g.name, Orders: g.orders, Packed: g.packed, Returns: g.returns, RTO: g.rto, 'Customer Returns': g.customerReturns,
        'Not Received Claims': g.claims, 'Return Rate %': g.returnRate ?? '', 'RTO Rate %': g.rtoRate ?? '',
      }));
      if (data.orderData.hasTags) add('By Order Tag', tagRows(data.byTag, 'Tag'));
      if (data.orderData.hasPayMode) add('By Payment Mode', tagRows(data.byPayment, 'Payment Mode'));
      add('By Condition', data.byCondition.map((c) => ({ Condition: c.name, Returns: c.count })));
      add('Suspicious Customers', custRows(data.suspicious));
      add('Repeat Customers', custRows(data.repeatCustomers));
      add('All Return Customers', custRows(data.customers));
      add('Returns', data.recent.map((r) => ({
        Date: fmtDate(r.date), 'Order ID': r.orderId, Platform: r.platform, 'Return Type': r.returnType, 'Logistics Partner': r.partner,
        Condition: r.condition, 'Not Received Claim': r.claim ? 'Yes' : 'No', Pincode: r.pincode, Customer: r.name, Notes: r.notes,
      })));
      XLSX.writeFile(wb, `Returns_RTO_${tagFilter ? tagFilter.replace(/[^A-Za-z0-9]+/g, '_') + '_' : ''}${fmtDate(fromDate)}_to_${fmtDate(toDate)}.xlsx`);
      onShowToast('Returns & RTO report downloaded.', 'success');
    } catch (e: any) {
      onShowToast(e?.message || 'Could not create the Excel file.', 'error');
    }
  };

  if (!data && loading) {
    return <div id="returns-analytics" className="flex items-center gap-2 text-sm text-slate-600 p-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading returns…</div>;
  }
  if (!data) {
    return (
      <div id="returns-analytics" className="p-6 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-2xl">
        {error || 'No data yet.'} <button onClick={load} className="ml-2 underline cursor-pointer">Try again</button>
      </div>
    );
  }

  const t = data.totals;
  const od = data.orderData;
  const rateSub = data.rateBase === 'orders' ? `of ${t.ordersInData} orders` : `of ${t.forwardPacked} packed videos`;
  const showOrders = (g: Group[]) => g.some((x) => x.orders !== null);

  const groupTable = (id: string, list: Group[], label: string, withCity = false) => (
    <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
      <table id={id} className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className={th}>{label}</th>
            {withCity && <th className={th}>City</th>}
            {showOrders(list) && <th className={`${th} text-right`}>Orders</th>}
            <th className={`${th} text-right`}>Returns</th>
            <th className={`${th} text-right`}>RTO</th>
            <th className={`${th} text-right`}>Customer returns</th>
            <th className={`${th} text-right`}>Not received</th>
            <th className={`${th} text-right`}>Bad condition</th>
            {showOrders(list) ? <th className={`${th} text-right`}>Return rate</th> : <th className={`${th} text-right`}>Share of returns</th>}
            {showOrders(list) && <th className={`${th} text-right`}>RTO rate</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.length === 0 && <tr><td className={td} colSpan={10}>No returns in this range.</td></tr>}
          {list.map((g) => (
            <tr key={g.name} className="hover:bg-slate-50">
              <td className={`${td} font-semibold`}>{g.name}</td>
              {withCity && <td className={td}>{g.city || ''}</td>}
              {showOrders(list) && <td className={tdNum}>{g.orders ?? '–'}</td>}
              <td className={tdNum}>{g.returns}</td>
              <td className={`${tdNum} ${g.rto ? 'text-rose-700 font-semibold' : ''}`}>{g.rto}</td>
              <td className={tdNum}>{g.customerReturns}</td>
              <td className={tdNum}>{g.claims}</td>
              <td className={tdNum}>{g.damaged}</td>
              {showOrders(list) ? <td className={tdNum}>{pct(g.returnRate)}</td> : <td className={tdNum}>{pct(g.share)}</td>}
              {showOrders(list) && <td className={tdNum}>{pct(g.rtoRate)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const tagTable = (id: string, list: TagGroup[], label: string) => (
    <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
      <table id={id} className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className={th}>{label}</th>
            <th className={`${th} text-right`}>Orders</th>
            <th className={`${th} text-right`}>Packed</th>
            <th className={`${th} text-right`}>Returns</th>
            <th className={`${th} text-right`}>RTO</th>
            <th className={`${th} text-right`}>Customer returns</th>
            <th className={`${th} text-right`}>Not received</th>
            <th className={`${th} text-right`}>Return rate</th>
            <th className={`${th} text-right`}>RTO rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.length === 0 && <tr><td className={td} colSpan={9}>No orders in this range.</td></tr>}
          {list.map((g) => (
            <tr key={g.name} className={`hover:bg-slate-50 ${g.name.endsWith(' (all)') ? 'bg-amber-50/40' : ''}`}>
              <td className={`${td} font-semibold`}>{g.name}</td>
              <td className={tdNum}>{g.orders}</td>
              <td className={tdNum}>{g.packed}</td>
              <td className={tdNum}>{g.returns}</td>
              <td className={`${tdNum} ${g.rto ? 'text-rose-700 font-semibold' : ''}`}>{g.rto}</td>
              <td className={tdNum}>{g.customerReturns}</td>
              <td className={tdNum}>{g.claims}</td>
              <td className={tdNum}>{pct(g.returnRate)}</td>
              <td className={tdNum}>{pct(g.rtoRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const customerTable = (id: string, list: Customer[], suspicious: boolean) => {
    const rows = list.filter(custMatch);
    return (
      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto border border-slate-200 rounded-xl">
        <table id={id} className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className={th}>Customer</th>
              <th className={th}>Phone</th>
              <th className={th}>Email</th>
              <th className={th}>Pincode</th>
              <th className={`${th} text-right`}>Orders</th>
              <th className={`${th} text-right`}>Returns</th>
              <th className={`${th} text-right`}>RTO</th>
              {suspicious && <th className={`${th} text-right`}>Not received</th>}
              {suspicious && <th className={th}>Why flagged</th>}
              {suspicious && <th className={th}>Last return</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td className={td} colSpan={10}>{suspicious ? 'No suspicious customers in this range.' : 'No repeat customers in this range.'}</td></tr>}
            {rows.map((c, i) => {
              const key = `${id}-${phoneOf(c)}-${c.email}-${c.name}-${i}`;
              const open = openCustomer === key;
              return (
                <React.Fragment key={key}>
                  <tr className={`hover:bg-slate-50 ${suspicious ? 'cursor-pointer' : ''}`} onClick={() => suspicious && setOpenCustomer(open ? '' : key)}>
                    <td className={`${td} font-semibold`}>{c.name || <span className="text-slate-400">Unknown</span>}</td>
                    <td className={`${td} font-mono`}>{phoneOf(c)}</td>
                    <td className={td}>{c.email}</td>
                    <td className={td}>{c.pincode}{c.city ? ` · ${c.city}` : ''}</td>
                    <td className={tdNum}>{c.orders}</td>
                    <td className={tdNum}>{c.returns}</td>
                    <td className={`${tdNum} ${c.rto ? 'text-rose-700 font-semibold' : ''}`}>{c.rto}</td>
                    {suspicious && <td className={tdNum}>{c.claims || 0}</td>}
                    {suspicious && <td className={`${td} text-rose-700`}>{(c.reasons || []).join(', ')}</td>}
                    {suspicious && <td className={td}>{c.lastReturn ? fmtDate(c.lastReturn) : ''}</td>}
                  </tr>
                  {open && (c.returnOrders || []).length > 0 && (
                    <tr className="bg-slate-50">
                      <td colSpan={10} className="px-3 py-2">
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">Returned orders</div>
                        <ul className="space-y-0.5">
                          {(c.returnOrders || []).map((o) => (
                            <li key={o.orderId} className="text-xs text-slate-700 font-mono">
                              {fmtDate(o.date)} · {o.orderId} · {o.type || 'type not recorded'}{o.partner ? ` · ${o.partner}` : ''}{o.condition ? ` · ${o.condition}` : ''}{o.claim ? ' · said not received' : ''}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div id="returns-analytics" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2"><PackageX className="w-4 h-4 text-amber-600" /> Returns & RTO</h3>
        <div className="flex flex-wrap items-center gap-2">
          {(od.hasTags || tagOptions.length > 0) && (
            <select id="returns-tag-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 focus:bg-white focus:outline-none cursor-pointer max-w-[16rem]">
              <option value="">All orders (any tag)</option>
              {tagOptions.map((t) => <option key={t} value={t}>{`Tag: ${t}`}</option>)}
            </select>
          )}
          <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button id="returns-export" onClick={exportExcel} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Download Excel
          </button>
        </div>
      </div>

      {(!od.available || !od.hasCustomer || !od.hasPincode) && (
        <div id="returns-orderdata-note" className="flex items-start gap-2 text-xs text-slate-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>
            {!od.available
              ? 'Shopify order data is not connected yet, so rates use the packed videos in this range and customers come from what was typed on each return.'
              : 'The Shopify order data has no customer or pincode columns yet, so return rate per pincode and repeat buyers use only the returns.'}
            {' '}Once orders carry customer, phone, email and pincode, this page shows true return rates per pincode and courier and every repeat buyer.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile id="ret-total" label="Returns" value={t.returns} sub={t.untyped ? `${t.untyped} without type` : undefined} />
        <Tile id="ret-rto" label="RTO (not delivered)" value={t.rto} tone="rose" />
        <Tile id="ret-customer" label="Customer returns" value={t.customerReturns} />
        <Tile id="ret-claims" label="Said not received" value={t.notReceivedClaims} tone="amber" />
        <Tile id="ret-rate" label="Return rate" value={pct(data.returnRate)} sub={rateSub} />
        <Tile id="ret-rto-rate" label="RTO rate" value={pct(data.rtoRate)} sub={rateSub} tone="rose" />
      </div>

      {tagFilter && (
        <div id="returns-tag-active" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Showing only orders tagged <strong>{tagFilter}</strong>: {t.ordersInData} orders, {t.forwardPacked} packed, {t.returns} returned.
        </div>
      )}

      {od.hasTags && (data.byTag || []).length > 0 && (
        <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Tag className="w-4 h-4 text-blue-600" /> By order tag</h4>
          <p className="text-[11px] text-slate-500">Shopify tags on orders placed in this range. Packed = a packing video exists. Return rate = returns ÷ packed. A tag like AiSensy_COD_Confirmed also counts under "AiSensy (all)".</p>
          {tagTable('returns-tag-table', data.byTag || [], 'Tag')}
        </section>
      )}

      {od.hasPayMode && (data.byPayment || []).length > 0 && (
        <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-4 h-4 text-blue-600" /> By payment mode</h4>
          {tagTable('returns-payment-table', data.byPayment || [], 'Payment mode')}
        </section>
      )}

      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-600" /> Suspicious customers</h4>
        <p className="text-[11px] text-slate-500">Customers with 2 or more RTOs or not-received claims, half or more of their orders returned, or 2 or more bad-condition returns. Click a row to see the orders.</p>
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input id="returns-customer-search" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search name, phone, email, pincode"
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:outline-none" />
        </div>
        {customerTable('returns-suspicious-table', data.suspicious, true)}
      </section>

      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Repeat className="w-4 h-4 text-blue-600" /> Repeat customers</h4>
        <p className="text-[11px] text-slate-500">
          {od.hasCustomer ? 'Customers with 2 or more orders in this range, and how many of them came back.' : 'Customers with 2 or more returns in this range.'}
        </p>
        {customerTable('returns-repeat-table', data.repeatCustomers, false)}
      </section>

      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Truck className="w-4 h-4 text-blue-600" /> By logistics partner</h4>
        {groupTable('returns-partner-table', data.byPartner, 'Logistics partner')}
      </section>

      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2"><MapPin className="w-4 h-4 text-blue-600" /> By pincode</h4>
          <input id="returns-pin-search" value={pinSearch} onChange={(e) => setPinSearch(e.target.value)} placeholder="Search pincode or city"
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:bg-white focus:outline-none" />
        </div>
        {groupTable('returns-pincode-table', pins, 'Pincode', true)}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <h4 className="text-sm font-bold text-slate-800">Return condition</h4>
          <table id="returns-condition-table" className="min-w-full">
            <tbody className="divide-y divide-slate-100">
              {data.byCondition.length === 0 && <tr><td className={td}>No returns in this range.</td></tr>}
              {data.byCondition.map((c) => (
                <tr key={c.name}><td className={td}>{c.name}</td><td className={tdNum}>{c.count}</td><td className={tdNum}>{t.returns ? `${Math.round((100 * c.count) / t.returns)}%` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <h4 className="text-sm font-bold text-slate-800">Returns in this range</h4>
          <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
            <table id="returns-recent-table" className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className={th}>Date</th><th className={th}>Order</th><th className={th}>Type</th><th className={th}>Partner</th>
                  <th className={th}>Condition</th><th className={th}>Pincode</th><th className={th}>Customer</th><th className={th}>Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent.length === 0 && <tr><td className={td} colSpan={8}>No returns in this range.</td></tr>}
                {data.recent.map((r) => (
                  <tr key={r.orderId + r.date} className="hover:bg-slate-50">
                    <td className={td}>{fmtDate(r.date)}</td>
                    <td className={`${td} font-mono`}>{r.orderId}</td>
                    <td className={`${td} ${r.returnType === 'RTO' ? 'text-rose-700 font-semibold' : ''}`}>{r.returnType || '–'}{r.claim ? ' · said not received' : ''}</td>
                    <td className={td}>{r.partner}</td>
                    <td className={td}>{r.condition}</td>
                    <td className={td}>{r.pincode}</td>
                    <td className={td}>{r.name}</td>
                    <td className={`${td} max-w-[16rem] truncate`} title={r.notes}>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
