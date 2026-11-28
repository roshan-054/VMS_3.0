import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterShopifyOrders, NO_FILTERS } from '../src/lib/shopifyFilters.ts';

const item = (sku: string, q = 1) => ({ id: sku, sku, productName: sku + ' name', shortName: '', shopifyName: '', gtin: '1', quantity: q, imageUrl: '', inCatalog: true });
const order = (orderId: string, orderDate: string, paymentMode: string, skus: string[]) =>
  ({ orderId, orderDate, payment: paymentMode === 'COD' ? 'PENDING' : 'PAID', fulfillment: '', status: 'Open', paymentMode, tags: '', totalItems: skus.length, items: skus.map((s) => item(s)), missingGtin: 0, syncedAt: '' });

const orders = [
  order('#OD-1', new Date(2026, 10, 25, 10).toISOString(), 'COD', ['UP-KUM-01']),
  order('#OD-2', new Date(2026, 10, 26, 23).toISOString(), 'Prepaid', ['SU-SHAN-01']),
  order('#OD-3', new Date(2026, 10, 27, 1).toISOString(), 'COD', ['SI-MA-KAM-01', 'UP-KUM-01']),
  order('#OD-4', new Date(2026, 10, 28, 9).toISOString(), '', ['UP-KUM-01']),
];
const ids = (f: Partial<typeof NO_FILTERS>) => filterShopifyOrders(orders as any, { ...NO_FILTERS, ...f }).map((o) => o.orderId);

test('no filters shows everything', () => assert.deepEqual(ids({}), ['#OD-1', '#OD-2', '#OD-3', '#OD-4']));
test('date range is inclusive, by local day', () => {
  assert.deepEqual(ids({ from: '2026-11-26', to: '2026-11-27' }), ['#OD-2', '#OD-3']);
  assert.deepEqual(ids({ from: '2026-11-28' }), ['#OD-4']);
  assert.deepEqual(ids({ to: '2026-11-25' }), ['#OD-1']);
});
test('COD / Prepaid (falls back to payment status)', () => {
  assert.deepEqual(ids({ payment: 'COD' }), ['#OD-1', '#OD-3']);
  assert.deepEqual(ids({ payment: 'Prepaid' }), ['#OD-2', '#OD-4']);
});
test('single and multi product orders', () => {
  assert.deepEqual(ids({ lines: 'single' }), ['#OD-1', '#OD-2', '#OD-4']);
  assert.deepEqual(ids({ lines: 'multi' }), ['#OD-3']);
});
test('product SKU and combined filters', () => {
  assert.deepEqual(ids({ sku: 'up-kum-01' }), ['#OD-1', '#OD-3', '#OD-4']);
  assert.deepEqual(ids({ sku: 'UP-KUM-01', lines: 'single', payment: 'COD' }), ['#OD-1']);
  assert.deepEqual(ids({ query: 'shan' }), ['#OD-2']);
});
