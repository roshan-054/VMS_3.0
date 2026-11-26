// D2C order IDs: always "#OD-10063" (one '#', no spaces), and every format finds the same order.
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
(globalThis as any).BroadcastChannel = undefined;
(globalThis as any).window ??= globalThis;
(globalThis as any).dispatchEvent ??= () => true;
(globalThis as any).CustomEvent ??= class extends Event { detail: any; constructor(t: string, o?: any) { super(t); this.detail = o?.detail; } };

const { formatOrderId, normalizeOrderId, orderLabel } = await import('../src/lib/api.ts');

test('formatOrderId gives D2C orders exactly one # and no spaces', () => {
  assert.equal(formatOrderId('OD-10063', 'D2C'), '#OD-10063');
  assert.equal(formatOrderId('#OD-10063', 'D2C'), '#OD-10063');
  assert.equal(formatOrderId('##OD-10063', 'D2C'), '#OD-10063');
  assert.equal(formatOrderId('  #  OD-10063  ', 'D2C'), '#OD-10063');
  assert.equal(formatOrderId('OD- 100 63', 'D2C'), '#OD-10063');
  assert.equal(formatOrderId('##OD-10063'), '#OD-10063');
  assert.equal(formatOrderId(' 402-1234567-1234567 ', 'Amazon'), '402-1234567-1234567');
  assert.equal(formatOrderId('', 'D2C'), '');
});

test('orderLabel never shows ##', () => {
  assert.equal(orderLabel('#OD-10063'), '#OD-10063');
  assert.equal(orderLabel('##OD-10063'), '#OD-10063');
  assert.equal(orderLabel('OD-10063'), '#OD-10063');
});

test('normalizeOrderId matches #, ## and spaced forms', () => {
  const k = normalizeOrderId('OD-10063');
  for (const v of ['#OD-10063', '##OD-10063', ' # OD-10063 ', 'od-10063']) assert.equal(normalizeOrderId(v), k, v);
});

test('the product list is found for "#OD-10063" when it was saved as "OD-10063"', async () => {
  localStorage.setItem('vms_order_manifests_v1', JSON.stringify([
    { id: 'a', orderId: '#OD-10063', platform: 'D2C', status: 'Packed', items: [] },
    { id: 'b', orderId: 'OD-10063', platform: 'D2C', status: 'Pending', items: [{ id: '1', sku: 'S1', gtin: '890', productName: 'Soap', quantity: 2 }] },
  ]));
  const ms = await import('../src/lib/manifestStorage.ts');
  for (const q of ['#OD-10063', '##OD-10063', 'OD-10063', ' od-10063 ']) {
    const m = ms.getManifestByOrderId(q);
    assert.ok(m, q);
    assert.equal(m!.items.length, 1, q);
  }
});

test('saving a D2C order stores "#OD-…" and replaces older copies in other formats', async () => {
  const ms = await import('../src/lib/manifestStorage.ts');
  await ms.saveOrderManifest({
    id: 'c', orderId: ' ##od-10063 ', platform: 'D2C' as any, status: 'Pending',
    items: [{ id: '1', sku: 'S1', gtin: '890', productName: 'Soap', quantity: 3 } as any],
  } as any);
  const all = ms.getStoredManifests().filter((m) => normalizeOrderId(m.orderId) === 'od-10063');
  assert.equal(all.length, 1);
  assert.equal(all[0].orderId, '#OD-10063');
  assert.equal(all[0].items[0].quantity, 3);
});

test('stray punctuation around the ID is removed', () => {
  assert.equal(formatOrderId(':408-3093842-5865165', 'Amazon'), '408-3093842-5865165');
  assert.equal(formatOrderId(':#OD-5,', 'D2C'), '#OD-5');
  assert.equal(normalizeOrderId(':408-3093842-5865165'), normalizeOrderId('408-3093842-5865165'));
});
