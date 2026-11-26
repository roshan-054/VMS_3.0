/**
 * How Sheet cells are stored in Supabase. Same rules as sbEncodeCell_ / sbDecodeCell_ in
 * backend/Code.gs: dates become {"$d": "<ISO time>"}, empty cells become "".
 */

/** One Sheet row as stored in Supabase (vms_pull / vms_apply row JSON). */
export interface ReplicaRow {
  id: string;
  t: string;        // tab
  k: string;        // row key (rowKey_ in Code.gs)
  s: number;        // Sheet order
  v: unknown[];     // encoded cells
  n: number;        // version
  x?: number;       // transaction id
  d?: boolean;      // deleted
}

export function encodeCell(v: unknown): unknown {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : { $d: v.toISOString() };
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && !isFinite(v)) return '';
  return v;
}

export function decodeCell(v: unknown): unknown {
  if (v && typeof v === 'object' && typeof (v as any).$d === 'string') {
    const d = new Date((v as any).$d);
    return isNaN(d.getTime()) ? '' : d;
  }
  if (v === null || v === undefined) return '';
  return v;
}

export function encodeRow(tab: string, row: unknown[]): unknown[] {
  const out = (row || []).map(encodeCell);
  if (tab === 'Users' && out.length > 3) out[3] = '';
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export function decodeRow(row: unknown[]): unknown[] {
  return (row || []).map(decodeCell);
}
