// Order list / catalog lookups stay fast with big data and stay correct after changes.
// Run with: npm run test:web
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as any).localStorage = new MemoryStorage();
(globalThis as any).BroadcastChannel = undefined; // keeps the test process from staying open
(globalThis as any).window ??= globalThis;
(globalThis as any).dispatchEvent ??= () => true;
(globalThis as any).CustomEvent ??= class extends Event { detail: any; constructor(t: string, o?: any) { super(t); this.detail = o?.detail; } };

const catalog = Array.from({ length: 500 }, (_, i) => ({ gtin: String(8906191690000 + i), sku: `SKU-${i}`, productName: `Product ${i}`, shortName: `P${i}`, tag: 'Active-online', imageUrl: `https://img/${i}.jpg` }));
const orders = Array.from({ length: 2800 }, (_, i) => ({
  id: 'm-' + i, orderId: `404-${1000000 + i}-${2000000 + i}`, platform: 'Amazon', status: i % 20 ? 'Packed' : 'Pending',
  items: [
    { id: 'a', gtin: String(8906191690000 + (i % 500)), sku: '', productName: '', quantity: 1 },
    { id: 'b', gtin: '1234567', sku: 'NOT-IN-CATALOG', productName: 'x', quantity: 1 },
  ],
}));
localStorage.setItem('vms_gtin_catalog_v1', JSON.stringify(catalog));
localStorage.setItem('vms_order_manifests_v1', JSON.stringify(orders));

const ms = await import('../src/lib/manifestStorage.ts');

test('looking up an order in 2,800 orders with a 500-product catalog is fast (was ~16 s)', () => {
  const t = performance.now();
  for (let i = 0; i < 20; i++) assert.ok(ms.getManifestByOrderId(`404-${1000000 + i}-${2000000 + i}`));
  assert.ok(performance.now() - t < 1500, `took ${Math.round(performance.now() - t)} ms`);
});

test('order items are still filled in from the catalog', () => {
  const m = ms.getManifestByOrderId('404-1000007-2000007')!;
  assert.equal(m.items[0].productName, 'Product 7');
  assert.equal(m.items[0].imageUrl, 'https://img/7.jpg');
  assert.equal(m.items[1].productName, 'x');
});

test('catalog lookup keeps its tolerant matching', () => {
  assert.equal(ms.findProductInCatalog('8906191690005')?.sku, 'SKU-5');
  assert.equal(ms.findProductInCatalog('08906191690005')?.sku, 'SKU-5', 'leading zero');
  assert.equal(ms.findProductInCatalog('sku-9')?.gtin, '8906191690009', 'SKU, any case');
  assert.equal(ms.findProductInCatalog('SKU 9')?.gtin, '8906191690009', 'separator');
  assert.equal(ms.findProductInCatalog('product 12')?.sku, 'SKU-12', 'exact name');
  assert.equal(ms.findProductInCatalog('P13')?.sku, 'SKU-13', 'short name');
  assert.equal(ms.findProductInCatalog('Product 1'), ms.findProductInCatalog('product 1'));
  assert.equal(ms.findProductInCatalog('Produc'), null, 'no partial matches');
});

test('changes are seen right away (cache follows storage)', () => {
  const list = ms.getStoredManifests();
  list.push({ id: 'new', orderId: 'NEW-1', platform: 'Amazon', status: 'Pending', items: [] } as any);
  ms.saveStoredManifests(list);
  assert.ok(ms.getManifestByOrderId('new-1'));

  const cat = ms.getStoredGtinCatalog();
  cat.push({ gtin: '7777777777777', sku: 'NEW-SKU', productName: 'Fresh', shortName: 'Fresh' } as any);
  ms.saveStoredGtinCatalog(cat);
  assert.equal(ms.findProductInCatalog('NEW-SKU')?.productName, 'Fresh');

  localStorage.setItem('vms_order_manifests_v1', JSON.stringify([{ id: 'x', orderId: 'OTHER-TAB', items: [] }]));
  assert.ok(ms.getManifestByOrderId('OTHER-TAB'), 'written by another tab');
  assert.equal(ms.getManifestByOrderId('NEW-1'), null);
});

test('a new station starts with no demo orders, and old demo orders are dropped', () => {
  localStorage.removeItem('vms_order_manifests_v1');
  assert.deepEqual(ms.getStoredManifests(), []);
  localStorage.setItem('vms_order_manifests_v1', JSON.stringify([{ id: 'manifest-seed-101', orderId: 'OD-5035', items: [] }, { id: 'm-1', orderId: 'REAL-1', items: [] }]));
  assert.deepEqual(ms.getStoredManifests().map((m) => m.orderId), ['REAL-1']);
});

test('an order stored twice ("OD-7083" and "#OD-7083") shows the products of both copies', () => {
  const list = JSON.parse(localStorage.getItem('vms_order_manifests_v1')!);
  list.push(
    { id: 'r1', orderId: '#OD-7083', platform: 'D2C', status: 'Packed', items: [{ id: 'item-1', sku: 'UP-SI-SI-MA-KAM-0101', gtin: '', productName: 'Sindoor', quantity: 1 }] },
    { id: 'r2', orderId: 'OD-7083', platform: 'D2C', status: 'Packed', items: [
      { id: 'item-1', sku: 'UP-KA-0303', gtin: '', productName: 'Kajal', quantity: 1 },
      { id: 'item-2', sku: 'UP-SI-SI-MA-KAM-0101', gtin: '', productName: 'Sindoor', quantity: 1 },
    ] },
  );
  localStorage.setItem('vms_order_manifests_v1', JSON.stringify(list));
  const m = ms.getManifestByOrderId('#OD-7083')!;
  assert.deepEqual(m.items.map((it) => `${it.productName} x${it.quantity}`), ['Sindoor x1', 'Kajal x1']);
  assert.equal(new Set(m.items.map((it) => it.id)).size, 2, 'unique item ids');
});

test('merging item lists keeps different products and does not double a repeated one', () => {
  const a = [{ id: 'item-1', sku: 'S1', gtin: '', productName: 'Sindoor', quantity: 1 }];
  const b = [{ id: 'item-1', sku: 's1', gtin: '', productName: 'Sindoor', quantity: 2 }, { id: 'item-2', sku: '', gtin: '890', productName: 'Kajal', quantity: 1 }];
  const out = ms.mergeManifestItems(a as any, b as any);
  assert.deepEqual(out.map((it) => `${it.productName} x${it.quantity}`), ['Sindoor x2', 'Kajal x1']);
});
