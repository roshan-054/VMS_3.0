// Creates a throw-away local Postgres database with the VMS Supabase schema, for tests.
// Set VMS_TEST_PG_ADMIN to a Postgres connection string (default: a local server on
// /tmp/pg port 54329). Tests that need it are skipped when no server is reachable.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const ADMIN_URL = process.env.VMS_TEST_PG_ADMIN || 'postgresql://postgres@localhost/postgres?host=/tmp/pg&port=54329';
const ROOT = path.join(__dirname, '..', '..');

function dbUrl(name) {
  const u = ADMIN_URL.replace(/\/postgres(\?|$)/, '/' + name + '$1');
  return u;
}

async function pgAvailable() {
  const c = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch (_) { return false; }
}

async function createTestDb() {
  const name = 'vms_t_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query('create database ' + name);
  await admin.end();
  const url = dbUrl(name);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, 'local-supabase-roles.sql'), 'utf8'));
  await c.query(fs.readFileSync(path.join(ROOT, 'supabase', 'vms_schema.sql'), 'utf8'));
  await c.end();
  return {
    name,
    url,
    async drop() {
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
      await a.query('drop database if exists ' + name);
      await a.end();
    },
  };
}

/** Run the fake Supabase REST API in a child process (Apps Script tests call it synchronously). */
function spawnFakeSupabase(connectionString) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(__dirname, 'fake-postgrest.cjs')], {
      env: { ...process.env, PORT: String(port), VMS_TEST_PG: connectionString },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    child.stdout.on('data', (d) => {
      if (!done && String(d).includes('fake supabase on')) {
        done = true;
        resolve({ url: 'http://127.0.0.1:' + port, anonKey: 'test-anon-key', serviceKey: 'test-service-key', kill: () => child.kill() });
      }
    });
    child.stderr.on('data', (d) => { if (process.env.VMS_FAKE_PG_LOG) process.stderr.write(d); });
    child.on('exit', (code) => { if (!done) reject(new Error('fake supabase exited ' + code)); });
    setTimeout(() => { if (!done) reject(new Error('fake supabase did not start')); }, 10000);
  });
}

module.exports = { pgAvailable, createTestDb, spawnFakeSupabase, ADMIN_URL };
