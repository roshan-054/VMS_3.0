// Catalog tag rules shared with the Apps Script backend. Run with: npm run test:web
import test from 'node:test';
import assert from 'node:assert/strict';
import { normTag, productHasTag, detectCatalogColumns, parseTagList } from '../src/lib/catalogTags.ts';

test('tags match exactly, ignoring case, spaces, dashes and underscores', () => {
  assert.equal(normTag('Active-online'), normTag('ACTIVE_ONLINE'));
  assert.equal(normTag('active online'), normTag('Active-Online'));
  assert.notEqual(normTag('Inactive-online'), normTag('Active-online'));
});

test('productHasTag never matches a substring', () => {
  const want = parseTagList('Active-online');
  assert.equal(productHasTag({ tag: 'Active-online' }, want), true);
  assert.equal(productHasTag({ tag: 'Inactive-online' }, want), false);
  assert.equal(productHasTag({ tag: 'Offline, active online' }, want), true);
  assert.equal(productHasTag({ tag: '' }, want), false);
  assert.equal(productHasTag({ tag: '', category: 'Active-online' }, want), true);
  assert.equal(productHasTag({ tag: 'Offline', category: 'Active-online' }, want), false);
  assert.equal(productHasTag({ tag: 'anything' }, []), true);
});

test('columns are picked by header name, and "Product Image" is not the name column', () => {
  const cols = detectCatalogColumns(['S.No', 'Product Image', 'Product Name', 'Seller SKU', 'EAN', 'Tag', 'Category', 'Status']);
  assert.deepEqual(cols, { image: 1, name: 2, sku: 3, gtin: 4, tag: 5, category: 6 });
});

test('a Status column is only used for tags when there is no Tag column', () => {
  assert.equal(detectCatalogColumns(['SKU', 'Status'])['tag'], 1);
  assert.equal(detectCatalogColumns(['SKU', 'Status', 'Tags'])['tag'], 2);
});
