/** Filters for the Shopify orders waiting list (bulk assign). Kept free of UI imports so tests can load it. */
import type { ShopifyOrder } from './shopify';

export interface ShopifyOrderFilters {
  query: string;
  from: string; // YYYY-MM-DD, local day, inclusive
  to: string;
  payment: '' | 'COD' | 'Prepaid';
  /** '' any, 'single' one product line, 'multi' more than one */
  lines: '' | 'single' | 'multi';
  sku: string;
}

export const NO_FILTERS: ShopifyOrderFilters = { query: '', from: '', to: '', payment: '', lines: '', sku: '' };

export function shopifyPaymentLabel(o: ShopifyOrder): 'COD' | 'Prepaid' {
  if (o.paymentMode === 'COD' || o.paymentMode === 'Prepaid') return o.paymentMode;
  return o.payment === 'PENDING' ? 'COD' : 'Prepaid';
}

function localDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The orders that pass every filter (search, order date range, COD/Prepaid, one or more products, SKU). */
export function filterShopifyOrders(orders: ShopifyOrder[], f: ShopifyOrderFilters): ShopifyOrder[] {
  const q = f.query.trim().toLowerCase();
  const sku = f.sku.trim().toUpperCase();
  return orders.filter((o) => {
    if (q && !(o.orderId.toLowerCase().includes(q) ||
      o.items.some((it) => (it.sku || '').toLowerCase().includes(q) || (it.shortName || it.productName || '').toLowerCase().includes(q)))) return false;
    if (f.from || f.to) {
      const day = localDay(o.orderDate);
      if (!day) return false;
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (f.payment && shopifyPaymentLabel(o) !== f.payment) return false;
    if (f.lines === 'single' && o.items.length !== 1) return false;
    if (f.lines === 'multi' && o.items.length < 2) return false;
    if (sku && !o.items.some((it) => (it.sku || '').trim().toUpperCase() === sku)) return false;
    return true;
  });
}
