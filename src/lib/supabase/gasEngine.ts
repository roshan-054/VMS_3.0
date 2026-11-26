/**
 * Runs the real backend/Code.gs data functions in the browser, against the Supabase copy of the
 * Sheet tabs instead of the Google Sheet. That way search, upload logs, reports, analytics,
 * manifests, pack checks and the catalog give exactly the same answers as Apps Script, without
 * a slow round trip.
 *
 * Only the Sheet is replaced: anything that needs Google Drive, URL fetches, triggers or
 * anything this shim does not know raises `EngineUnsupported`, and the caller then sends the
 * request to Apps Script as before.
 */
import { decodeCell, encodeRow, type ReplicaRow } from './cells';

// The run in progress: any unsupported call is remembered even if Code.gs catches the error.
let currentRun: { err: EngineUnsupported | null } | null = null;

export class EngineUnsupported extends Error {
  constructor(what: string) {
    super('Not available in the browser: ' + what);
    this.name = 'EngineUnsupported';
    if (currentRun && !currentRun.err) currentRun.err = this;
  }
}

export interface EngineUser {
  name: string;
  email: string;
  role: string;
}

export interface TabSnapshot {
  headers: string[];
  rows: ReplicaRow[]; // live rows in Sheet order
}

export interface RowOp {
  op: 'insert' | 'update' | 'delete' | 'tab';
  id?: string;
  tab: string;
  key?: string;
  vals?: unknown[];
  version?: number;
  headers?: string[];
}

export interface EngineRunResult<T = any> {
  result: T;
  ops: RowOp[];
  touchedTabs: string[];
}

const SCRIPT_TZ = 'Asia/Kolkata';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const partsCache = new Map<string, Intl.DateTimeFormat>();
function tzParts(d: Date, tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(out.weekday);
  return {
    y: Number(out.year), M: Number(out.month), d: Number(out.day),
    H: Number(out.hour) % 24, m: Number(out.minute), s: Number(out.second), ms: d.getMilliseconds(), wd,
  };
}

/** Utilities.formatDate with the Java SimpleDateFormat letters Code.gs uses. */
export function formatDate(date: Date | string | number, tz: string, pattern: string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  let p;
  try { p = tzParts(d, tz || SCRIPT_TZ); } catch (_) { p = tzParts(d, SCRIPT_TZ); }
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end === i + 1) { out += "'"; i += 2; continue; }
      out += pattern.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? pattern.length : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
    let n = 1;
    while (pattern[i + n] === ch) n++;
    i += n;
    switch (ch) {
      case 'y': out += n === 2 ? pad(p.y % 100) : pad(p.y, n); break;
      case 'M': out += n >= 4 ? MONTHS[p.M - 1] : n === 3 ? MONTHS[p.M - 1].slice(0, 3) : pad(p.M, n); break;
      case 'd': out += pad(p.d, n); break;
      case 'H': out += pad(p.H, n); break;
      case 'k': out += pad(p.H === 0 ? 24 : p.H, n); break;
      case 'h': out += pad(p.H % 12 === 0 ? 12 : p.H % 12, n); break;
      case 'K': out += pad(p.H % 12, n); break;
      case 'm': out += pad(p.m, n); break;
      case 's': out += pad(p.s, n); break;
      case 'S': out += pad(p.ms, 3).slice(0, Math.max(n, 3)); break;
      case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'E': out += n >= 4 ? DAYS[p.wd] : DAYS[p.wd].slice(0, 3); break;
      case 'u': out += String(p.wd === 0 ? 7 : p.wd); break;
      case 'Z': case 'X': case 'z': throw new EngineUnsupported('time zone pattern ' + ch);
      default: out += ch.repeat(n);
    }
  }
  return out;
}

// ------------------------------------------------------------------ virtual Sheet

interface DraftRow {
  id: string;
  orig?: ReplicaRow; // undefined = new row
  vals: unknown[];   // decoded cells (Dates are Date objects)
  dirty: boolean;
}

const NOOP_PREFIXES = ['set', 'auto', 'hide', 'show', 'protect', 'merge', 'unmerge', 'activate', 'add', 'remove', 'clearFormat', 'clearNote', 'clearDataValidations', 'collapse', 'expand', 'trim'];
function isNoop(name: string) {
  return NOOP_PREFIXES.some((p) => name.startsWith(p));
}

/** Wrap an object so formatting calls are harmless and anything unknown falls back to Apps Script. */
function guard<T extends object>(target: T, label: string): T {
  const p: any = new Proxy(target, {
    get(t: any, prop) {
      if (typeof prop === 'symbol' || prop in t) return t[prop];
      if (prop === 'then' || prop === 'toJSON') return undefined;
      if (isNoop(String(prop))) return () => p;
      throw new EngineUnsupported(label + '.' + String(prop));
    },
  });
  return p as T;
}

class VirtualTab {
  name: string;
  headers: unknown[];
  rows: DraftRow[];
  headerDirty = false;
  origHeaders: string[];
  deleted: DraftRow[] = [];
  proxy: any;

  constructor(name: string, snap: TabSnapshot | null) {
    this.name = name;
    this.headers = snap ? snap.headers.slice() : [];
    this.origHeaders = this.headers.map((h) => String(h ?? ''));
    this.rows = snap ? snap.rows.map((r) => ({ id: r.id, orig: r, vals: (r.v as unknown[]).map(decodeCell), dirty: false })) : [];
    const self = this;
    this.proxy = new Proxy(this, {
      get(t: any, prop) {
        if (typeof prop === 'symbol') return t[prop];
        if (prop in VirtualTab.api) return (VirtualTab.api as any)[prop].bind(null, self);
        if (prop === 'then' || prop === 'toJSON') return undefined;
        if (isNoop(String(prop))) return () => self.proxy;
        throw new EngineUnsupported('Sheet.' + String(prop));
      },
    });
  }

  lastRow() {
    const hasHeader = this.headers.some((h) => h !== '' && h !== null && h !== undefined);
    return this.rows.length + (hasHeader || this.rows.length ? 1 : 0);
  }
  lastCol() {
    let m = this.headers.length;
    for (const r of this.rows) {
      let n = r.vals.length;
      while (n > 0 && (r.vals[n - 1] === '' || r.vals[n - 1] === null || r.vals[n - 1] === undefined)) n--;
      if (n > m) m = n;
    }
    return m;
  }
  cell(r: number, c: number): unknown {
    const row = r === 1 ? this.headers : this.rows[r - 2]?.vals;
    if (!row) return '';
    const v = row[c - 1];
    return v === undefined || v === null ? '' : v;
  }
  setCell(r: number, c: number, v: unknown) {
    if (r < 1 || c < 1) throw new Error('Range out of bounds');
    if (v instanceof Date) v = new Date(v.getTime());
    if (r === 1) {
      while (this.headers.length < c) this.headers.push('');
      this.headers[c - 1] = v;
      this.headerDirty = true;
      return;
    }
    while (this.rows.length < r - 1) this.rows.push({ id: crypto.randomUUID(), vals: [], dirty: true });
    const row = this.rows[r - 2];
    while (row.vals.length < c) row.vals.push('');
    row.vals[c - 1] = v;
    row.dirty = true;
  }

  static api = {
    getName: (t: VirtualTab) => t.name,
    getSheetName: (t: VirtualTab) => t.name,
    getSheetId: (t: VirtualTab) => t.name.length,
    getLastRow: (t: VirtualTab) => t.lastRow(),
    getLastColumn: (t: VirtualTab) => t.lastCol(),
    getMaxRows: (t: VirtualTab) => Math.max(t.lastRow(), 1000),
    getMaxColumns: (t: VirtualTab) => Math.max(t.lastCol(), 26),
    getFrozenRows: () => 1,
    getParent: () => { throw new EngineUnsupported('Sheet.getParent'); },
    getDataRange: (t: VirtualTab) => new VirtualRange(t, 1, 1, Math.max(t.lastRow(), 1), Math.max(t.lastCol(), 1)).proxy,
    getRange: (t: VirtualTab, r: any, c?: number, nr?: number, nc?: number) => {
      if (typeof r !== 'number' || typeof c !== 'number') throw new EngineUnsupported('getRange(A1)');
      return new VirtualRange(t, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc).proxy;
    },
    appendRow: (t: VirtualTab, vals: unknown[]) => {
      t.rows.push({ id: crypto.randomUUID(), vals: (vals || []).map((v) => (v instanceof Date ? new Date(v.getTime()) : v)), dirty: true });
      return t.proxy;
    },
    deleteRow: (t: VirtualTab, r: number) => VirtualTab.api.deleteRows(t, r, 1),
    deleteRows: (t: VirtualTab, r: number, n: number) => {
      if (r < 2 || r + n - 1 > t.lastRow()) throw new Error('Those rows are out of bounds.');
      const removed = t.rows.splice(r - 2, n);
      removed.forEach((x) => { if (x.orig) t.deleted.push(x); });
      return t.proxy;
    },
    clearContents: (t: VirtualTab) => {
      t.rows.forEach((x) => { if (x.orig) t.deleted.push(x); });
      t.rows = [];
      t.headers = [];
      t.headerDirty = true;
      return t.proxy;
    },
    clear: (t: VirtualTab) => VirtualTab.api.clearContents(t),
    createTextFinder: (t: VirtualTab, text: string) => {
      let matchCase = false;
      let entire = false;
      let found: Array<[number, number]> | null = null;
      let pos = 0;
      const compute = () => {
        if (found) return found;
        found = [];
        const want = matchCase ? String(text) : String(text).toLowerCase();
        const lr = t.lastRow(), lc = t.lastCol();
        for (let r = 1; r <= lr; r++) for (let c = 1; c <= lc; c++) {
          const raw = t.cell(r, c);
          let s = raw instanceof Date ? String(raw) : String(raw);
          if (!matchCase) s = s.toLowerCase();
          if (entire ? s === want : s.includes(want)) found.push([r, c]);
        }
        return found;
      };
      const finder: any = {
        matchCase(v: boolean) { matchCase = !!v; return finder; },
        matchEntireCell(v: boolean) { entire = !!v; return finder; },
        useRegularExpression() { throw new EngineUnsupported('TextFinder regex'); },
        ignoreDiacritics() { return finder; },
        matchFormulaText() { return finder; },
        findNext() { const f = compute(); const x = f[pos++]; return x ? new VirtualRange(t, x[0], x[1], 1, 1).proxy : null; },
        findAll() { return compute().map((x) => new VirtualRange(t, x[0], x[1], 1, 1).proxy); },
        replaceAllWith() { throw new EngineUnsupported('TextFinder.replaceAllWith'); },
      };
      return finder;
    },
  };
}

class VirtualRange {
  proxy: any;
  constructor(public t: VirtualTab, public r: number, public c: number, public nr: number, public nc: number) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    const self = this;
    this.proxy = new Proxy(this, {
      get(target: any, prop) {
        if (typeof prop === 'symbol') return target[prop];
        if (prop in VirtualRange.api) return (VirtualRange.api as any)[prop].bind(null, self);
        if (prop === 'then' || prop === 'toJSON') return undefined;
        if (isNoop(String(prop))) return () => self.proxy;
        throw new EngineUnsupported('Range.' + String(prop));
      },
    });
  }
  static api = {
    getValues: (g: VirtualRange) => {
      const out: unknown[][] = [];
      for (let i = 0; i < g.nr; i++) {
        const row: unknown[] = [];
        for (let j = 0; j < g.nc; j++) {
          const v = g.t.cell(g.r + i, g.c + j);
          row.push(v instanceof Date ? new Date(v.getTime()) : v);
        }
        out.push(row);
      }
      return out;
    },
    getValue: (g: VirtualRange) => { const v = g.t.cell(g.r, g.c); return v instanceof Date ? new Date(v.getTime()) : v; },
    getDisplayValues: (g: VirtualRange) => VirtualRange.api.getValues(g).map((row) => row.map((v) => (v instanceof Date ? formatDate(v, SCRIPT_TZ, 'dd-MMM-yy HH:mm') : String(v)))),
    getDisplayValue: (g: VirtualRange) => VirtualRange.api.getDisplayValues(g)[0][0],
    setValue: (g: VirtualRange, v: unknown) => {
      for (let i = 0; i < g.nr; i++) for (let j = 0; j < g.nc; j++) g.t.setCell(g.r + i, g.c + j, v);
      return g.proxy;
    },
    setValues: (g: VirtualRange, vals: unknown[][]) => {
      if (!Array.isArray(vals) || vals.length !== g.nr || vals.some((row) => !Array.isArray(row) || row.length !== g.nc)) {
        throw new Error('The number of rows or columns in the data does not match the range.');
      }
      vals.forEach((row, i) => row.forEach((v, j) => g.t.setCell(g.r + i, g.c + j, v)));
      return g.proxy;
    },
    clearContent: (g: VirtualRange) => {
      const lr = g.t.lastRow();
      for (let i = 0; i < g.nr; i++) for (let j = 0; j < g.nc; j++) if (g.r + i <= lr) g.t.setCell(g.r + i, g.c + j, '');
      return g.proxy;
    },
    clear: (g: VirtualRange) => VirtualRange.api.clearContent(g),
    getRow: (g: VirtualRange) => g.r,
    getColumn: (g: VirtualRange) => g.c,
    getNumRows: (g: VirtualRange) => g.nr,
    getNumColumns: (g: VirtualRange) => g.nc,
    getLastRow: (g: VirtualRange) => g.r + g.nr - 1,
    getLastColumn: (g: VirtualRange) => g.c + g.nc - 1,
    getSheet: (g: VirtualRange) => g.t.proxy,
    getA1Notation: (g: VirtualRange) => {
      const col = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
      return col(g.c) + g.r + (g.nr > 1 || g.nc > 1 ? ':' + col(g.c + g.nc - 1) + (g.r + g.nr - 1) : '');
    },
  };
}

// ------------------------------------------------------------------ engine

type Factory = (env: Record<string, unknown>) => (name: string) => any;

let factoryPromise: Promise<Factory> | null = null;

export function compileCodeGs(source: string): Factory {
  const envNames = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Session', 'Logger',
    'DriveApp', 'Drive', 'UrlFetchApp', 'ScriptApp', 'ContentService', 'HtmlService', 'MailApp', 'GmailApp', 'console', '__over'];
  const overrides = ['session_', 'admin_', 'ss_', 'withScriptLock_', 'manifestVersion_', 'bumpManifestVersion_', 'bumpAnalyticsVersion_',
    'analyticsVersion_', 'activeReservation_', 'reservationKey_', 'applySheetDateFormats_', 'sbTouch_', 'sbTouchTabs_', 'sbFlush_', 'securityLog_', 'setupSystem'];
  const assign = overrides.map((n) => `if (typeof __over.${n} === 'function') ${n} = __over.${n};`).join('\n');
  // eslint-disable-next-line no-new-func
  const fn = new Function(...envNames, `${source}\n;${assign}\nreturn function (name) { return eval(name); };`);
  return (env: Record<string, unknown>) => fn(...envNames.map((n) => env[n]));
}

export async function loadCodeGsFactory(): Promise<Factory> {
  if (!factoryPromise) {
    factoryPromise = import('../../../backend/Code.gs?raw').then((m) => compileCodeGs(m.default as string)).catch((e) => {
      factoryPromise = null;
      throw e;
    });
  }
  return factoryPromise;
}

function unsupportedService(name: string): any {
  const fn: any = function () { throw new EngineUnsupported(name); };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => name;
      if (prop === 'then' || prop === 'toJSON') return undefined;
      throw new EngineUnsupported(name + '.' + String(prop));
    },
    apply() { throw new EngineUnsupported(name); },
  });
}

export interface EngineContext {
  user: EngineUser;
  tabs: (name: string) => TabSnapshot | null;
  tabVersion: (name: string) => string;
}

/**
 * Run one Code.gs function against the Supabase copy. `call` receives the Code.gs scope lookup
 * and returns the response object. Writes are collected as row operations (not applied).
 */
export function runEngine<T>(factory: Factory, ctx: EngineContext, call: (G: (name: string) => any) => T): EngineRunResult<T> {
  const open = new Map<string, VirtualTab>();
  const getTab = (name: string, create = false) => {
    let t = open.get(name);
    if (!t) {
      const snap = ctx.tabs(name);
      if (!snap && !create) return null;
      t = new VirtualTab(name, snap);
      open.set(name, t);
    }
    return t;
  };

  const spreadsheet = guard({
    getId: () => 'supabase',
    getName: () => 'VMS (Supabase)',
    getSheetByName: (n: string) => getTab(String(n))?.proxy || null,
    getSheets: () => { throw new EngineUnsupported('Spreadsheet.getSheets'); },
    insertSheet: (n: string) => {
      const t = getTab(String(n), true)!;
      return t.proxy;
    },
    getUrl: () => '',
  }, 'Spreadsheet');

  const props = new Map<string, string>();
  const env: Record<string, unknown> = {
    SpreadsheetApp: guard({
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => { throw new EngineUnsupported('SpreadsheetApp.openById'); },
      flush: () => undefined,
    }, 'SpreadsheetApp'),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty(k: string, v: unknown) { props.set(k, String(v)); return this; },
        deleteProperty(k: string) { props.delete(k); return this; },
        getProperties: () => Object.fromEntries(props),
      }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined, getAll: () => ({}), putAll: () => undefined }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => undefined, releaseLock: () => undefined, hasLock: () => true }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5', SHA_1: 'SHA_1' },
      Charset: { UTF_8: 'UTF_8' },
      formatDate,
      getUuid: () => crypto.randomUUID(),
      sleep: () => undefined,
      computeDigest: () => { throw new EngineUnsupported('Utilities.computeDigest'); },
      newBlob: () => { throw new EngineUnsupported('Utilities.newBlob'); },
      base64Encode: () => { throw new EngineUnsupported('Utilities.base64Encode'); },
      base64Decode: () => { throw new EngineUnsupported('Utilities.base64Decode'); },
      base64EncodeWebSafe: () => { throw new EngineUnsupported('Utilities.base64EncodeWebSafe'); },
    },
    Session: { getScriptTimeZone: () => SCRIPT_TZ, getActiveUser: () => ({ getEmail: () => '' }) },
    Logger: { log: () => undefined },
    console: { log: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    DriveApp: unsupportedService('DriveApp'),
    Drive: unsupportedService('Drive'),
    UrlFetchApp: unsupportedService('UrlFetchApp'),
    ScriptApp: unsupportedService('ScriptApp'),
    ContentService: unsupportedService('ContentService'),
    HtmlService: unsupportedService('HtmlService'),
    MailApp: unsupportedService('MailApp'),
    GmailApp: unsupportedService('GmailApp'),
  };

  const user = { name: ctx.user.name, email: ctx.user.email, role: ctx.user.role };
  env.__over = {
    session_: () => ({ ...user }),
    admin_: () => {
      const r = String(user.role || '').toLowerCase().replace(/[\s_-]/g, '');
      if (!(r === 'admin' || r === 'masteradmin' || r === 'superadmin')) throw new Error('Administrator permission required.');
      return { ...user };
    },
    ss_: () => spreadsheet,
    withScriptLock_: (fn: () => unknown) => fn(),
    manifestVersion_: () => ctx.tabVersion('OrderManifest'),
    bumpManifestVersion_: () => undefined,
    bumpAnalyticsVersion_: () => undefined,
    analyticsVersion_: () => '0',
    activeReservation_: () => null,
    reservationKey_: () => '',
    applySheetDateFormats_: () => ({ success: true, skipped: true }),
    sbTouch_: () => undefined,
    sbTouchTabs_: () => undefined,
    sbFlush_: () => undefined,
    securityLog_: () => { throw new EngineUnsupported('securityLog_'); },
    setupSystem: () => { throw new EngineUnsupported('setupSystem'); },
  };

  const run = { err: null as EngineUnsupported | null };
  const prevRun = currentRun;
  currentRun = run;
  let result!: T;
  let G!: (name: string) => any;
  try {
    G = factory(env);
    result = call(G);
  } finally {
    currentRun = prevRun;
  }
  if (run.err) throw run.err;

  // Collect the row changes.
  const rowKey = G('rowKey_') as (tab: string, row: unknown[]) => string;
  const ops: RowOp[] = [];
  const touched: string[] = [];
  const baseKey = (k: string) => k.replace(/#\d+$/, '');
  for (const [name, t] of open) {
    const before = ops.length;
    const headersNow = t.headers.map((h) => String(h ?? ''));
    while (headersNow.length && headersNow[headersNow.length - 1] === '') headersNow.pop();
    if (t.headerDirty && JSON.stringify(headersNow) !== JSON.stringify(t.origHeaders)) ops.push({ op: 'tab', tab: name, headers: headersNow });

    // Rows that were removed (deleteRow / clearContents) can be matched again by a row written
    // back with the same key, so rewriting a whole tab only changes what really changed.
    const pool = new Map<string, DraftRow[]>();
    for (const d of t.deleted) {
      const k = baseKey(d.orig!.k);
      (pool.get(k) || pool.set(k, []).get(k)!).push(d);
    }
    const liveKeys = new Set<string>();
    for (const r of t.rows) if (r.orig && !r.dirty) liveKeys.add(r.orig.k);

    // Google Sheets turns date text in date columns into real dates (and Code.gs converts the
    // rest every hour), so store them the same way.
    const dateCols: number[] = (() => { try { return G('sheetDateColumns_')(name, t.headers) || []; } catch (_) { return []; } })();
    const rowDate = G('rowDate_') as (v: unknown) => Date;
    for (const r of t.rows) {
      if (!r.dirty) continue;
      for (const col of dateCols) {
        const v = r.vals[col - 1];
        if (v === '' || v === null || v === undefined || typeof v === 'number' || v instanceof Date) continue;
        const d = rowDate(v);
        if (d instanceof Date && !isNaN(d.getTime())) r.vals[col - 1] = d;
      }
      const enc = encodeRow(name, r.vals);
      let key = rowKey(name, r.vals);
      let orig = r.orig;
      let id = r.id;
      if (!orig && key && pool.get(key)?.length) {
        const reuse = pool.get(key)!.shift()!;
        orig = reuse.orig;
        id = reuse.id;
      }
      if (!key) {
        if (orig) ops.push({ op: 'delete', id, tab: name, version: orig.n });
        continue;
      }
      if (orig && baseKey(orig.k) === key) key = orig.k; // keep a repeat's #n
      if (orig && key === orig.k && JSON.stringify(enc) === JSON.stringify(orig.v) && !liveKeys.has(key)) {
        liveKeys.add(key);
        continue;
      }
      if (liveKeys.has(key)) {
        let n = 2;
        while (liveKeys.has(baseKey(key) + '#' + n)) n++;
        key = baseKey(key) + '#' + n;
      }
      liveKeys.add(key);
      if (orig) ops.push({ op: 'update', id, tab: name, key, vals: enc, version: orig.n });
      else ops.push({ op: 'insert', id, tab: name, key, vals: enc });
    }
    // Deletes go first so a key can move to another row in the same save.
    const dels: RowOp[] = [];
    for (const list of pool.values()) for (const d of list) dels.push({ op: 'delete', id: d.id, tab: name, version: d.orig!.n });
    ops.splice(before, 0, ...dels);
    if (ops.length > before) touched.push(name);
  }
  return { result, ops, touchedTabs: touched };
}
