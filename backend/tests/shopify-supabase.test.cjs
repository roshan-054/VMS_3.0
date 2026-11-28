// Shopify orders reach Supabase in the same run that writes them into the Sheet (real local Postgres).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { createRuntime } = require('./gas-harness.cjs');
const { pgAvailable, createTestDb, spawnFakeSupabase } = require('../../tests/supabase/pg-setup.cjs');

function curlFetch(url, opts = {}) {
  const args = ['-s', '--noproxy', '*', '-X', String(opts.method || 'get').toUpperCase(), '-w', '\n%{http_code}'];
  if (opts.contentType) args.push('-H', 'Content-Type: ' + opts.contentType);
  Object.entries(opts.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (opts.payload !== undefined) args.push('--data-binary', '@-');
  const out = execFileSync('curl', [...args, url], { input: opts.payload || '', maxBuffer: 1 << 28 }).toString();
  const i = out.lastIndexOf('\n');
  return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
}

async function rpc(sb, fn, args) {
  const r = await fetch(sb.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: sb.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });

test('timed Shopify sync copies the new rows to Supabase', async (t) => {
  if (!(await pgAvailable())) { t.skip('no local Postgres'); return; }
  const db = await createTestDb();
  const sb = await spawnFakeSupabase(db.url);
  t.after(async () => { sb.kill(); await db.drop(); });

  const rt = createRuntime({ users: [[new Date(), 'Admin One', 'admin@vms.test', null, 'Super Admin', 'Approved']] });
  rt.sheets.get('Users').rows[1][3] = rt.hash('Secret123!');
  rt.sheets.get('Users').rows[0] = ['Timestamp', 'Full Name', 'Email', 'Password', 'Role', 'Status'];
  const triggers = [];
  rt.sandbox.ScriptApp = {
    getProjectTriggers: () => triggers,
    deleteTrigger: (x) => triggers.splice(triggers.indexOf(x), 1),
    newTrigger: (fn) => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const x = { getHandlerFunction: () => fn }; triggers.push(x); return x; } }; return b; },
  };
  rt.sandbox.UrlFetchApp = {
    fetch(url, opts) {
      if (url.startsWith(sb.url)) return curlFetch(url, opts);
      if (/access_token$/.test(url)) return json(200, { access_token: 'tok', expires_in: 86399 });
      return json(200, { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{
        id: 'gid://shopify/Order/1', name: '#OD-10400', createdAt: '2026-11-28T03:00:00Z', updatedAt: '2026-11-28T03:00:01Z', cancelledAt: null,
        displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
        lineItems: { nodes: [{ id: 'l', sku: 'SKU1', name: 'Soap', title: 'Soap', variantTitle: null, quantity: 2, currentQuantity: 2, requiresShipping: true, image: null }] },
      }] } } });
    },
  };
  rt.props.set('SUPABASE_URL', sb.url); rt.props.set('SUPABASE_ANON_KEY', sb.anonKey);
  rt.props.set('SUPABASE_SERVICE_KEY', sb.serviceKey); rt.props.set('SUPABASE_ENABLED', 'true');
  const login = rt.call('login', { email: 'admin@vms.test', password: 'Secret123!' });
  assert.equal(login.success, true);
  assert.equal(rt.call('supabaseImport', { token: login.token }).success, true);
  const saved = rt.call('saveShopifySettings', { token: login.token, shop: 'teststore', clientId: 'cid', clientSecret: 's', enabled: true });
  assert.equal(saved.enabled, true, saved.error);

  rt.sandbox.shopifySyncTick();
  assert.equal(rt.sheets.get('ShopifyOrders').rows.length, 2);
  const pull = await rpc(sb, 'vms_pull', { p_token: login.token });
  const rows = pull.rows.filter((r) => r.t === 'ShopifyOrders' && !r.d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].k, 'sp:#od-10400');
  assert.equal(rows[0].v[1], '#OD-10400');
  assert.match(String(rows[0].v[8]), /"sku":"SKU1"/);
  const brand = pull.rows.filter((r) => r.t === 'Branding' && !r.d && r.v[0] === 'ShopifyOrdersEnabled');
  assert.equal(brand.length, 1, 'stations can see the switch');
  assert.ok(!JSON.stringify(pull.rows).includes('client'), 'no Shopify credentials in Supabase');
});
