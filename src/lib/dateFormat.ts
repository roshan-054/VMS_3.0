// One date format everywhere in the app: DD-MMM-YY (e.g. 24-Nov-26), times as 24-hour HH:mm.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** Accepts a Date, ISO string, epoch ms, or a plain 'YYYY-MM-DD' (read as a local calendar day). */
export function toDate(v: Date | string | number | null | undefined): Date | null {
  return fixCentury(parseAny(v));
}

/** Old sheet rows sometimes carry a year 100 too far ahead (2124, 2126). Move those back by centuries. */
function fixCentury(d: Date | null): Date | null {
  if (!d) return d;
  while (d.getFullYear() >= 2100) {
    const back = new Date(d.getTime());
    back.setFullYear(d.getFullYear() - 100);
    d = back;
  }
  return d;
}

function parseAny(v: Date | string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const t = v.replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Day-first text from the sheet: 24/11/2026 14:02, 24-11-26, 24-Nov-26 14:02, 24 Nov 2026, 2:02 PM
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b,?(.*)$/);
    if (m && Number(m[2]) <= 12) return withTime(new Date(year(m[3]), Number(m[2]) - 1, Number(m[1])), m[4]);
    m = t.match(/^(\d{1,2})[\s/.-]([A-Za-z]{3})[A-Za-z]*[\s/.-],?\s*(\d{2,4})\b,?(.*)$/);
    const mi = m ? MON.findIndex((x) => x.toLowerCase() === m![2].toLowerCase()) : -1;
    if (m && mi >= 0) return withTime(new Date(year(m[3]), mi, Number(m[1])), m[4]);
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const year = (y: string) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
function withTime(d: Date, rest: string): Date {
  const m = String(rest || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (!m) return d;
  let h = Number(m[1]);
  const ap = (m[4] || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  d.setHours(h, Number(m[2]), Number(m[3] || 0), 0);
  return d;
}

/** Milliseconds for sorting; unknown dates sort last (0). */
export function dateMs(v: Date | string | number | null | undefined): number {
  return toDate(v)?.getTime() ?? 0;
}

/** 24-Nov-26. Returns the input unchanged if it is not a date. */
export function fmtDate(v: Date | string | number | null | undefined): string {
  const d = toDate(v);
  if (!d) return v === null || v === undefined ? '' : String(v);
  return `${p2(d.getDate())}-${MON[d.getMonth()]}-${p2(d.getFullYear() % 100)}`;
}

/** 14:02 (or 14:02:40 with seconds). */
export function fmtTime(v: Date | string | number | null | undefined, seconds = false): string {
  const d = toDate(v);
  if (!d) return '';
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${seconds ? `:${p2(d.getSeconds())}` : ''}`;
}

/** 24-Nov-26 14:02 */
export function fmtDateTime(v: Date | string | number | null | undefined, seconds = false): string {
  const d = toDate(v);
  if (!d) return v === null || v === undefined ? '' : String(v);
  return `${fmtDate(d)} ${fmtTime(d, seconds)}`;
}
