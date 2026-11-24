/**
 * PREVIEW-ONLY demo backend. Not part of the repository.
 * Runs the real backend/Code.gs inside the browser against an in-memory Google Sheet that is
 * saved in this browser's localStorage. Requests to script.google.com never leave the browser,
 * so the live Sheet, Drive and Apps Script are never touched.
 */
// @ts-nocheck
import codeGs from '../../backend/Code.gs?raw';

const STORE_KEY = 'vms_demo_backend_v1';

// ---------- synchronous SHA-256 (Utilities.computeDigest is synchronous) ----------
function sha256Bytes(str: string): number[] {
  const msg = Array.from(new TextEncoder().encode(str));
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const l = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 7; i >= 0; i--) msg.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
  const w = new Array(64);
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < msg.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = (msg[i+t*4] << 24) | (msg[i+t*4+1] << 16) | (msg[i+t*4+2] << 8) | msg[i+t*4+3];
    for (let t = 16; t < 64; t++) {
      const s0 = r(w[t-15], 7) ^ r(w[t-15], 18) ^ (w[t-15] >>> 3);
      const s1 = r(w[t-2], 17) ^ r(w[t-2], 19) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
  }
  const out: number[] = [];
  H.forEach((v) => { for (let i = 3; i >= 0; i--) { const b = (v >>> (i * 8)) & 0xff; out.push(b > 127 ? b - 256 : b); } });
  return out;
}
const hex = (s: string) => sha256Bytes(s).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');

// ---------- persisted state ----------
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw, (_k, v) => (typeof v === 'string' && ISO.test(v) ? new Date(v) : v));
  } catch {}
  return null;
}
function seed() {
  const now = Date.now();
  const day = 86400000;
  const rows = [];
  const plats = ['Amazon', 'D2C', 'JioMart'];
  for (let i = 0; i < 12; i++) {
    const ts = new Date(now - (i % 4) * day - i * 3600000);
    const id = 'demo-file-' + i;
    rows.push([ts, `DEMO-${1001 + i}`, plats[i % 3], i % 2 ? 'packer@example.com' : 'admin@example.com', id,
      `https://drive.google.com/file/d/${id}/preview`, '', 'Completed', i % 5 === 0 ? 'Return' : 'Forward', 'job' + i, 'video/webm', 'Ready']);
  }
  const header = ['Timestamp','Order ID','Platform','Packer Email','Video Drive ID','Video Playback URL','Package Weight','Status','Recording Type','Queue Job ID','Video MIME Type','Playback Status'];
  return {
    sheets: {
      Users: [['Created','Name','Email','Password','Role','Status'],
        [new Date(now - 30*day), 'Demo Admin', 'admin@example.com', hex('DemoAdmin#1'), 'Admin', 'Approved'],
        [new Date(now - 20*day), 'Demo Packer', 'packer@example.com', hex('DemoPacker#1'), 'User', 'Approved'],
        [new Date(now - 1*day), 'Waiting Person', 'waiting@example.com', hex('Waiting#123'), 'User', 'Pending'],
        [new Date(now - 60*day), 'Old Default', 'admin@ops.local', hex('Admin@123'), 'Admin', 'Approved']],
      OrderLog: [header, ...rows.filter((r) => r[8] === 'Forward')],
      ReturnLog: [header, ...rows.filter((r) => r[8] === 'Return')],
      UploadLog: [['Timestamp']], DownloadLog: [['Timestamp']], SecurityLog: [['Timestamp','Email','Action','Result','Details']],
      Branding: [['Key','Value']], TrashLog: [['Timestamp']], OrderManifest: [['Header']], PackVerificationLog: [['Header']], GTINCatalog: [['Header']],
    },
    props: {}, cache: {},
  };
}
let state = load() || seed();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} };
export function resetDemoBackend() { localStorage.removeItem(STORE_KEY); state = seed(); save(); }

// ---------- Apps Script service mocks ----------
let idCounter = Date.now();
function noop(): any {
  const id = 'demo-' + (idCounter++).toString(36);
  const fn: any = function () { return proxy; };
  const proxy: any = new Proxy(fn, {
    get(_t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined;
      if (p === 'hasNext') return () => false;
      if (p === 'getId') return () => id;
      if (p === 'getUrl') return () => `https://drive.google.com/file/d/${id}/view`;
      if (p === 'getSize') return () => 0;
      if (p === 'getName') return () => id;
      if (p === 'getResponseCode') return () => 200;
      if (p === 'getContentText') return () => '{}';
      if (p === 'getHeaders' || p === 'getAllHeaders') return () => ({});
      return noop();
    },
    apply() { return noop(); },
  });
  return proxy;
}
function sheet(name: string) {
  const s = {
    getName: () => name,
    getDataRange: () => ({ getValues: () => state.sheets[name].map((r) => r.slice()) }),
    appendRow: (row) => { state.sheets[name].push(row.slice()); return s; },
    deleteRow: (r) => { state.sheets[name].splice(r - 1, 1); },
    getLastRow: () => state.sheets[name].length,
    getLastColumn: () => state.sheets[name].reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => state.sheets[name].length + 100,
    getRange: (r, c, nr = 1, nc = 1) => {
      const rows = state.sheets[name];
      const ensure = () => { while (rows.length < r + nr - 1) rows.push([]); };
      const rg: any = {
        getValues() { ensure(); const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(rows[r-1+i][c-1+j] ?? ''); out.push(row); } return out; },
        getValue() { ensure(); return rows[r-1][c-1] ?? ''; },
        setValue(v) { ensure(); rows[r-1][c-1] = v; return rg; },
        setValues(vals) { ensure(); vals.forEach((row, i) => row.forEach((v, j) => { rows[r-1+i][c-1+j] = v; })); return rg; },
      };
      return new Proxy(rg, { get: (t, p) => (p in t ? t[p] : () => rg) });
    },
  };
  return new Proxy(s, { get: (t, p) => (p in t ? t[p] : noop()) });
}
const spreadsheet = new Proxy({
  getId: () => 'demo-sheet',
  getSheetByName: (n) => (state.sheets[n] ? sheet(n) : null),
  insertSheet: (n) => { state.sheets[n] = state.sheets[n] || []; return sheet(n); },
  getSheets: () => Object.keys(state.sheets).map(sheet),
}, { get: (t, p) => (p in t ? t[p] : noop()) });

const services = {
  SpreadsheetApp: new Proxy({ getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {} }, { get: (t, p) => (p in t ? t[p] : noop()) }),
  PropertiesService: { getScriptProperties: () => {
    const sp = {
      getProperty: (k) => (k in state.props ? state.props[k] : null),
      setProperty: (k, v) => { state.props[k] = String(v); return sp; },
      deleteProperty: (k) => { delete state.props[k]; return sp; },
      getProperties: () => ({ ...state.props }),
      setProperties: (o) => { Object.assign(state.props, o); return sp; },
    };
    return sp;
  } },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in state.cache ? state.cache[k] : null),
    put: (k, v) => { state.cache[k] = String(v); },
    remove: (k) => { delete state.cache[k]; },
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_a, s) => sha256Bytes(String(s)),
    getUuid: () => crypto.randomUUID(),
    sleep() {},
    formatDate: (d) => new Date(d).toISOString(),
    base64Encode: (s) => btoa(String(s)),
    base64EncodeWebSafe: (s) => btoa(unescape(encodeURIComponent(String(s)))).replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => Array.from(atob(String(s)), (c) => c.charCodeAt(0)),
    newBlob: () => noop(),
  },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Logger: { log() {} },
  DriveApp: noop(), Drive: noop(), ScriptApp: noop(), UrlFetchApp: noop(),
};
const names = Object.keys(services);
const backend = new Function(...names, `${codeGs}\n;return { doPost };`)(...names.map((n) => services[n]));

// ---------- route Apps Script calls into the demo backend ----------
const realFetch = window.fetch.bind(window);
window.fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.startsWith('https://script.google.com/')) {
    await new Promise((r) => setTimeout(r, 120));
    let payload: any = { success: true, status: 'online', service: 'VMS 3.0 DEMO backend', version: '3.0.0-demo' };
    if ((init?.method || 'GET').toUpperCase() === 'POST') {
      const out = backend.doPost({ postData: { contents: String(init?.body || '{}') } });
      save();
      payload = JSON.parse(out.text);
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
};

// ---------- banner ----------
function banner() {
  if (document.getElementById('vms-demo-banner')) return;
  const b = document.createElement('div');
  b.id = 'vms-demo-banner';
  b.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;background:#7c2d12;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px);text-align:center';
  b.innerHTML = '<b>TEST PREVIEW</b> with a demo backend in your browser. Your live Sheet, Drive and site are not touched. ' +
    'Admin: admin@example.com / DemoAdmin#1 · Packer: packer@example.com / DemoPacker#1 · ' +
    '<a href="#" id="vms-demo-reset" style="color:#fed7aa;text-decoration:underline">Reset demo data</a> · ' +
    '<a href="#" id="vms-demo-hide" style="color:#fed7aa;text-decoration:underline">Hide</a>';
  document.body.appendChild(b);
  document.getElementById('vms-demo-reset')!.onclick = (e) => { e.preventDefault(); resetDemoBackend(); localStorage.removeItem('ops_token'); localStorage.removeItem('vms_current_user'); location.reload(); };
  document.getElementById('vms-demo-hide')!.onclick = (e) => { e.preventDefault(); b.remove(); };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
save();
