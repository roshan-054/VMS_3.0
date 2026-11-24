// Minimal in-memory Google Apps Script runtime for testing backend/Code.gs with Node.
// Only the services used by the auth paths are modelled closely; everything else is a
// permissive no-op so unrelated code paths do not crash.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function noopProxy() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'hasNext') return () => false;
      if (prop === 'getId') return () => 'mock-id';
      if (prop === 'then') return undefined;
      return proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}

class MockSheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; }
  getName() { return this.name; }
  getDataRange() { const s = this; return { getValues: () => s.rows.map((r) => r.slice()) }; }
  appendRow(row) { this.rows.push(row.slice()); return this; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  getLastRow() { return this.rows.length; }
  createTextFinder(text) {
    const s = this;
    let mc = false;
    const f = {
      matchCase(v) { mc = v; return f; }, matchEntireCell() { return f; },
      findNext() {
        const t = mc ? String(text) : String(text).toLowerCase();
        for (const r of s.rows) for (const c of r) { const v = mc ? String(c) : String(c).toLowerCase(); if (v.includes(t)) return { getValue: () => c }; }
        return null;
      },
    };
    return f;
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    const ensure = () => { while (s.rows.length < r + nr - 1) s.rows.push([]); };
    return {
      getValues() { ensure(); const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(s.rows[r - 1 + i][c - 1 + j] ?? ''); out.push(row); } return out; },
      getValue() { ensure(); return s.rows[r - 1][c - 1] ?? ''; },
      setValue(v) { ensure(); s.rows[r - 1][c - 1] = v; return this; },
      setValues(vals) { ensure(); vals.forEach((row, i) => row.forEach((v, j) => { s.rows[r - 1 + i][c - 1 + j] = v; })); return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
      setFontColor() { return this; }, setHorizontalAlignment() { return this; }, setWrap() { return this; },
    };
  }
}
// Unknown sheet methods (formatting etc.) become no-ops.
const sheetHandler = { get(t, p) { return p in t ? t[p] : noopProxy(); } };

function createRuntime({ users = [] } = {}) {
  const sheets = new Map();
  const addSheet = (name, rows) => { const s = new Proxy(new MockSheet(name, rows), sheetHandler); sheets.set(name, s); return s; };
  addSheet('Users', [['Created', 'Name', 'Email', 'Password', 'Role', 'Status'], ...users]);
  ['SecurityLog', 'OrderLog', 'ReturnLog', 'UploadLog', 'DownloadLog', 'Branding', 'TrashLog',
    'OrderManifest', 'PackVerificationLog', 'GTINCatalog'].forEach((n) => addSheet(n, [['Header']]));

  const spreadsheet = new Proxy({
    getId: () => 'sheet-id',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => addSheet(n, []),
    getSheets: () => Array.from(sheets.values()),
  }, sheetHandler);

  const props = new Map();
  const scriptProperties = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return scriptProperties; },
    deleteProperty: (k) => { props.delete(k); return scriptProperties; },
    getProperties: () => Object.fromEntries(props),
    setProperties: (o) => { Object.entries(o).forEach(([k, v]) => props.set(k, String(v))); return scriptProperties; },
  };
  const cache = new Map();
  const scriptCache = {
    get: (k) => (cache.has(k) ? cache.get(k) : null),
    put: (k, v) => { cache.set(k, String(v)); },
    remove: (k) => { cache.delete(k); },
    getAll: (keys) => Object.fromEntries(keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, JSON, Math, Number, String, Array, Object, RegExp, Error, Boolean, Set, Map, parseInt, parseFloat, isNaN,
    SpreadsheetApp: new Proxy({ getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet }, sheetHandler),
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: { getScriptCache: () => scriptCache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      formatDate: (d, _tz, fmt) => {
        const x = new Date(d);
        const p2 = (n) => String(n).padStart(2, '0');
        const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (!fmt) return x.toISOString();
        return fmt.replace('yyyy', x.getFullYear()).replace('MMM', MON[x.getMonth()]).replace('MM', p2(x.getMonth() + 1)).replace('dd', p2(x.getDate())).replace('HH', p2(x.getHours())).replace('mm', p2(x.getMinutes())).replace('ss', p2(x.getSeconds()));
      },
      base64Encode: (s) => Buffer.from(Array.isArray(s) || s instanceof Uint8Array ? Array.from(s, (b) => b & 255) : String(s)).toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url'),
      base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')),
      newBlob: () => noopProxy(),
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Logger: { log() {} },
    DriveApp: noopProxy(), Drive: noopProxy(), ScriptApp: noopProxy(), UrlFetchApp: noopProxy(),
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  // Expose top-level const declarations to the test via a trailer.
  vm.runInContext(code + '\n;this.__CONFIG = CONFIG; this.__PUBLIC = PUBLIC_ACTIONS; this.__ADMIN = ADMIN_ACTIONS;', sandbox, { filename: 'Code.gs' });

  const call = (action, payload = {}) => {
    const res = sandbox.doPost({ postData: { contents: JSON.stringify({ action, ...payload }) } });
    return JSON.parse(res.text);
  };
  const hash = (pw) => crypto.createHash('sha256').update(pw, 'utf8').digest('hex');
  return { sandbox, call, sheets, props, cache, hash, addSheet };
}

module.exports = { createRuntime };
