// A tiny stand-in for Supabase's REST API (PostgREST) in front of a local Postgres, for tests.
// Only what VMS uses: POST /rest/v1/rpc/<function> with named JSON arguments. The role comes
// from the apikey header, like Supabase: the anon key runs as "anon", the service key as
// "service_role", so the grants in supabase/vms_schema.sql are tested for real.
'use strict';
const http = require('http');
const { Pool } = require('pg');

function startFakePostgrest({ port = 0, connectionString, anonKey = 'test-anon-key', serviceKey = 'test-service-key', log = false } = {}) {
  const pool = new Pool({ connectionString, max: 8 });
  const sigCache = new Map();
  const stats = { calls: [] };

  async function signature(fn) {
    if (sigCache.has(fn)) return sigCache.get(fn);
    const r = await pool.query(
      `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, format_type(p.prorettype, null) as ret
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
    const sig = r.rows[0] || null;
    sigCache.set(fn, sig);
    return sig;
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info, accept-profile, content-profile',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const send = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
    if (req.method !== 'POST' || !m) return send(404, { message: 'not found' });
    const key = req.headers.apikey || '';
    const role = key === serviceKey ? 'service_role' : key === anonKey ? 'anon' : null;
    if (!role) return send(401, { message: 'Invalid API key' });
    let body = '';
    for await (const chunk of req) body += chunk;
    let args = {};
    try { args = body ? JSON.parse(body) : {}; } catch (_) { return send(400, { message: 'bad json' }); }
    const fn = m[1];
    stats.calls.push({ fn, role, at: Date.now() });
    if (stats.down) return send(503, { message: 'service unavailable (test)' });
    const sig = await signature(fn);
    if (!sig) return send(404, { code: 'PGRST202', message: 'Could not find the function public.' + fn });
    const names = sig.names || [];
    const parts = [];
    const params = [];
    Object.keys(args).forEach((k) => {
      const idx = names.indexOf(k);
      if (idx === -1) return;
      const type = sig.types[idx];
      let v = args[k];
      if (v !== null && (type === 'jsonb' || type === 'json')) v = JSON.stringify(v);
      params.push(v);
      parts.push(`${k} => $${params.length}::${type}`);
    });
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query(`set local statement_timeout = '${role === 'anon' ? '8s' : '120s'}'`);
      const r = await client.query(`select public.${fn}(${parts.join(', ')}) as r`, params);
      await client.query('commit');
      let out = r.rows[0] ? r.rows[0].r : null;
      if (out instanceof Date) out = out.toISOString();
      if (sig.ret === 'void') { res.writeHead(204, cors); return res.end(); }
      if (sig.ret === 'bigint' && out !== null) out = Number(out);
      send(200, out);
    } catch (e) {
      try { await client.query('rollback'); } catch (_) {}
      if (log) console.error('[fake-postgrest]', fn, e.message);
      const code = e.code === '42501' ? 401 : 400;
      send(code, { code: e.code, message: e.message, details: null, hint: null });
    } finally {
      client.release();
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + server.address().port;
      resolve({ url, anonKey, serviceKey, stats, pool, server, close: () => new Promise((r) => server.close(() => pool.end().then(r))) });
    });
  });
}

module.exports = { startFakePostgrest };

if (require.main === module) {
  const port = Number(process.env.PORT || 54321);
  startFakePostgrest({ port, connectionString: process.env.VMS_TEST_PG, log: !!process.env.VMS_FAKE_PG_LOG }).then((s) => {
    console.log('fake supabase on ' + s.url);
  });
}
