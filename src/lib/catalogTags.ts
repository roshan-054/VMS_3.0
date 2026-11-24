// Same rules as backend/Code.gs readCatalogRows_: exact tag matching and header-based columns.
// Keep the two in step; tests/catalogTags.test.ts and backend/tests/catalog-tag-sync.test.cjs cover both.

/** "Active-online", "active online" and "ACTIVE_ONLINE" are the same tag; "Inactive-online" is not. */
export function normTag(t: string): string {
  return String(t || '').toLowerCase().replace(/[\s_\-.]+/g, '');
}

export function splitTags(cell: string): string[] {
  return String(cell || '').split(/[,;|\n]+/).map((x) => x.trim()).filter(Boolean);
}

export function parseTagList(input?: string | string[]): string[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  return list.map((t) => String(t || '').trim()).filter(Boolean);
}

/** True when the product's tag cell (or category, for older rows) holds one of the wanted tags exactly. */
export function productHasTag(p: { tag?: string; category?: string }, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const want = new Set(wanted.map(normTag));
  const tokens = splitTags(p.tag || '').length > 0 ? splitTags(p.tag || '') : splitTags(p.category || '');
  return tokens.some((t) => want.has(normTag(t)));
}

type ColumnKey = 'gtin' | 'sku' | 'tag' | 'image' | 'shortName' | 'name' | 'category' | 'cogs' | 'qty' | 'notes';
interface ColumnDef { key: ColumnKey; exact: string[]; words?: string[]; phrases?: string[]; weak?: string[] }

const COLUMNS: ColumnDef[] = [
  { key: 'gtin', exact: ['gtin', 'ean', 'barcode', 'upc', 'gtin number', 'gtin no', 'ean code', 'ean number', 'barcode number', 'gtin code'], words: ['gtin', 'barcode', 'ean', 'upc'], weak: ['code'] },
  { key: 'sku', exact: ['sku', 'seller sku', 'product sku', 'sku code', 'sku id', 'item code', 'product code', 'style code', 'article code'], words: ['sku'], phrases: ['item code', 'product code', 'style code', 'article code'], weak: ['style', 'model', 'item'] },
  { key: 'tag', exact: ['tag', 'tags', 'product tag', 'product tags', 'sku tag', 'listing tag', 'tag name'], words: ['tag', 'tags'], weak: ['label', 'status'] },
  { key: 'image', exact: ['image', 'image url', 'image link', 'images', 'photo', 'product image', 'image 1', 'main image'], words: ['image', 'images', 'img', 'photo', 'picture', 'thumbnail'], weak: ['link', 'url', 'drive'] },
  { key: 'shortName', exact: ['short name', 'display name', 'nickname'], words: ['short', 'nickname'], phrases: ['display name'] },
  { key: 'name', exact: ['product name', 'name', 'title', 'item name', 'product title', 'product', 'product description', 'description'], words: ['name', 'title'], weak: ['description', 'product'] },
  { key: 'category', exact: ['category', 'product category', 'department'], words: ['category', 'department'], weak: ['type'] },
  { key: 'cogs', exact: ['cogs', 'cost', 'price', 'mrp'], words: ['cogs', 'cost', 'price', 'mrp', 'rate'] },
  { key: 'qty', exact: ['quantity', 'qty', 'default quantity', 'pack qty', 'pack size'], words: ['quantity', 'qty'] },
  { key: 'notes', exact: ['notes', 'note', 'remarks', 'remark'], words: ['note', 'notes', 'remark', 'remarks'] },
];

const normHeader = (h: string) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function detectCatalogColumns(headerRow: string[]): Partial<Record<ColumnKey, number>> {
  const heads = headerRow.map(normHeader);
  const idx: Partial<Record<ColumnKey, number>> = {};
  const taken = new Set<number>();
  for (const tier of ['exact', 'words', 'weak'] as const) {
    for (const def of COLUMNS) {
      if (idx[def.key] !== undefined) continue;
      for (let c = 0; c < heads.length; c++) {
        const h = heads[c];
        if (taken.has(c) || !h) continue;
        const words = h.split(' ');
        const hit =
          tier === 'exact' ? def.exact.includes(h)
          : tier === 'words' ? (def.words || []).some((w) => words.includes(w)) || (def.phrases || []).some((p) => h.includes(p))
          : (def.weak || []).some((w) => words.includes(w));
        if (hit) { idx[def.key] = c; taken.add(c); break; }
      }
    }
  }
  return idx;
}

export interface TagCount { tag: string; count: number }

export function describeTagsFound(tags?: TagCount[], limit = 8): string {
  if (!tags || tags.length === 0) return 'no tags';
  return tags.slice(0, limit).map((t) => `${t.tag} (${t.count})`).join(', ') + (tags.length > limit ? ', …' : '');
}
