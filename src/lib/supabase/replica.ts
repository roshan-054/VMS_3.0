/**
 * This station's copy of the Supabase rows. The first sign-in downloads everything once and keeps
 * it in IndexedDB; after that each request only fetches the rows that changed (usually none), so
 * reads are instant.
 */
import { sbRpc } from './client';
import type { ReplicaRow } from './cells';
import type { EngineUser, TabSnapshot } from './gasEngine';

interface PullResponse {
  rows: ReplicaRow[];
  more: boolean;
  after_txid: number | null;
  after_id: string | null;
  cursor: number;
  tabs: Record<string, string[]>;
  user: EngineUser;
}

interface Stored {
  v: 1;
  url: string;
  owner: string;
  role: string;
  cursor: number | null;
  headers: Record<string, string[]>;
  rows: ReplicaRow[];
  savedAt: number;
}

const DB_NAME = 'vms_supabase_replica';
const STORE = 'kv';
const KEY = 'replica';

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

async function idbGet(): Promise<Stored | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve((r.result as Stored) || null);
      r.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

async function idbPut(value: Stored | null): Promise<void> {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      if (value) tx.objectStore(STORE).put(value, KEY); else tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (_) { resolve(); }
  });
}

export class Replica {
  private tabs = new Map<string, Map<string, ReplicaRow>>();
  private headers: Record<string, string[]> = {};
  private sorted = new Map<string, ReplicaRow[]>();
  private counters: Record<string, number> = {};
  private readonly epoch = Math.random().toString(36).slice(2, 8);
  private cursor: number | null = null;
  private owner = '';
  private url = '';
  user: EngineUser | null = null;
  ready = false;          // a complete copy is in memory
  lastPull = 0;
  private loadedFromDisk: Promise<void> | null = null;
  private pulling: Promise<void> | null = null;
  private saveTimer: any = null;
  persist = true;

  /** Load the saved copy (once). */
  loadSaved(url: string): Promise<void> {
    if (!this.loadedFromDisk) {
      this.loadedFromDisk = (async () => {
        if (!this.persist) return;
        const s = await idbGet();
        if (!s || s.v !== 1 || s.url !== url || !Array.isArray(s.rows)) return;
        // Deleted rows are only kept on the server for 30 days.
        if (Date.now() - (s.savedAt || 0) > 25 * 86400000) return;
        this.url = s.url;
        this.owner = s.owner;
        this.user = { email: s.owner, name: '', role: s.role };
        this.cursor = s.cursor;
        this.headers = s.headers || {};
        for (const r of s.rows) this.put(r);
        this.ready = this.cursor !== null;
      })();
    }
    return this.loadedFromDisk;
  }

  private put(r: ReplicaRow) {
    let m = this.tabs.get(r.t);
    if (!m) { m = new Map(); this.tabs.set(r.t, m); }
    const cur = m.get(r.id);
    if (r.d) {
      if (cur) { m.delete(r.id); this.touched(r.t); }
      return;
    }
    if (cur && cur.n > r.n) return; // never go back to an older version
    if (cur && cur.n === r.n && JSON.stringify(cur.v) === JSON.stringify(r.v) && cur.s === r.s && cur.k === r.k) return;
    m.set(r.id, { id: r.id, t: r.t, k: r.k, s: Number(r.s), v: r.v, n: Number(r.n) });
    this.touched(r.t);
  }

  private touched(tab: string) {
    this.sorted.delete(tab);
    this.counters[tab] = (this.counters[tab] || 0) + 1;
  }

  applyRows(rows: ReplicaRow[]) {
    for (const r of rows || []) this.put(r);
    this.scheduleSave();
  }

  reset(url = '') {
    this.tabs.clear();
    this.sorted.clear();
    this.headers = {};
    this.cursor = null;
    this.owner = '';
    this.user = null;
    this.ready = false;
    this.url = url;
    Object.keys(this.counters).forEach((k) => (this.counters[k] = (this.counters[k] || 0) + 1));
  }

  async clearSaved() {
    this.reset();
    await idbPut(null);
  }

  /** Fetch every change since the last pull (or everything the first time). */
  pull(url: string, token: string): Promise<void> {
    if (this.pulling) return this.pulling;
    this.pulling = (async () => {
      if (this.url && this.url !== url) this.reset(url);
      this.url = url;
      let since = this.cursor;
      let afterTx: number | null = null;
      let afterId: string | null = null;
      let first: PullResponse | null = null;
      const fresh = since === null;
      const batch: ReplicaRow[] = [];
      for (let page = 0; page < 200; page++) {
        const res = await sbRpc<PullResponse>('vms_pull', {
          p_token: token, p_since: since, p_tabs: null, p_after_txid: afterTx, p_after_id: afterId, p_limit: 4000,
        }, { timeoutMs: 30000 });
        if (!first) {
          first = res;
          const email = String(res.user?.email || '').toLowerCase();
          if (this.owner && email && email !== this.owner) {
            // Another person signed in on this station: start a clean copy for them.
            this.reset(url);
            since = null;
            afterTx = null;
            afterId = null;
            first = null;
            this.owner = email;
            continue;
          }
          this.owner = email;
          this.user = { email: res.user.email, name: res.user.name, role: res.user.role };
          this.headers = { ...this.headers, ...(res.tabs || {}) };
        }
        batch.push(...(res.rows || []));
        if (!res.more) break;
        afterTx = res.after_txid;
        afterId = res.after_id;
      }
      if (fresh) { this.tabs.clear(); this.sorted.clear(); }
      for (const r of batch) this.put(r);
      if (first) this.cursor = first.cursor;
      this.ready = true;
      this.lastPull = Date.now();
      if (batch.length || fresh) this.scheduleSave();
    })().finally(() => { this.pulling = null; });
    return this.pulling;
  }

  snapshot(tab: string): TabSnapshot | null {
    const m = this.tabs.get(tab);
    const headers = this.headers[tab];
    if (!m && !headers) return null;
    let rows = this.sorted.get(tab);
    if (!rows) {
      rows = Array.from(m ? m.values() : []).sort((a, b) => a.s - b.s);
      this.sorted.set(tab, rows);
    }
    return { headers: (headers || []).slice(), rows: rows.slice() };
  }

  setHeaders(tab: string, headers: string[]) {
    this.headers[tab] = headers.slice();
    this.touched(tab);
  }

  /** Changes whenever a row of the tab changes on this station's copy. */
  version(tab: string): string {
    return 'sb-' + this.epoch + '-' + (this.counters[tab] || 0) + '-' + (this.tabs.get(tab)?.size || 0);
  }

  count(tab?: string): number {
    if (tab) return this.tabs.get(tab)?.size || 0;
    let n = 0;
    for (const m of this.tabs.values()) n += m.size;
    return n;
  }

  allTabs(): string[] {
    return Array.from(new Set([...Object.keys(this.headers), ...this.tabs.keys()]));
  }

  private scheduleSave() {
    if (!this.persist) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.cursor === null) return;
      const rows: ReplicaRow[] = [];
      for (const m of this.tabs.values()) for (const r of m.values()) rows.push(r);
      void idbPut({ v: 1, url: this.url, owner: this.owner, role: this.user?.role || '', cursor: this.cursor, headers: this.headers, rows, savedAt: Date.now() });
    }, 2500);
  }
}

export const replica = new Replica();
