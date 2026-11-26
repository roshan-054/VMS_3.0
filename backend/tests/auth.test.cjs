'use strict';
// Run with: node --test backend/tests/*.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const USERS = [
  [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  [new Date(), 'Dee Disabled', 'dee@example.com', sha('Disabled1'), 'User', 'Disabled'],
  [new Date(), 'Tim Temp', 'tim@example.com', 'TempPass9', 'User', 'Approved'],
];
const fresh = () => createRuntime({ users: USERS.map((r) => r.slice()) });
const login = (rt, email, password) => rt.call('login', { email, password });

// Every action the router knows about, read from the doPost switch.
function allActions() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');
  const body = src.slice(src.indexOf('function doPost('), src.indexOf('function output_('));
  return Array.from(new Set([...body.matchAll(/case '([A-Za-z]+)'/g)].map((m) => m[1])));
}

test('every non-public action rejects a request with no token', () => {
  const rt = fresh();
  const pub = new Set(rt.sandbox.__PUBLIC);
  const actions = allActions().filter((a) => !pub.has(a));
  assert.ok(actions.length > 50, 'expected the full action list');
  for (const a of actions) {
    const res = rt.call(a, {});
    assert.equal(res.success, false, `${a} should fail without a token`);
    assert.equal(res.code, 'AUTH_REQUIRED', `${a} should return AUTH_REQUIRED, got ${res.error}`);
  }
});

test('every non-public action rejects a made-up token', () => {
  const rt = fresh();
  const pub = new Set(rt.sandbox.__PUBLIC);
  for (const a of allActions().filter((x) => !pub.has(x))) {
    const res = rt.call(a, { token: 'not-a-real-token' });
    assert.equal(res.code, 'AUTH_REQUIRED', `${a} accepted a fake token`);
  }
});

test('anonymous adminCreateUser no longer creates an account', () => {
  const rt = fresh();
  const before = rt.sheets.get('Users').rows.length;
  const res = rt.call('adminCreateUser', { name: 'Evil', email: 'evil@x.com', password: 'hacked123', role: 'Admin' });
  assert.equal(res.success, false);
  assert.equal(rt.sheets.get('Users').rows.length, before);
});

test('public actions still work without signing in', () => {
  const rt = fresh();
  assert.equal(rt.call('health').success, true);
  assert.equal(rt.call('logout').success, true);
  const v = rt.call('validateSession', { token: 'nope' });
  assert.equal(v.success, false);
  assert.equal(v.code, 'AUTH_REQUIRED');
  const b = rt.call('getBranding');
  assert.notEqual(b.code, 'AUTH_REQUIRED');
});

test('correct password signs in and the token is accepted', () => {
  const rt = fresh();
  const res = login(rt, 'pat@example.com', 'PackerPass1');
  assert.equal(res.success, true);
  assert.ok(res.token);
  const v = rt.call('validateSession', { token: res.token });
  assert.equal(v.success, true);
  assert.equal(v.user.email, 'pat@example.com');
  // A signed-in user can reach normal endpoints (no AUTH_REQUIRED).
  const s = rt.call('advancedSearch', { token: res.token, query: 'x' });
  assert.notEqual(s.code, 'AUTH_REQUIRED');
  const u = rt.call('getUsers', { token: res.token });
  assert.equal(u.success, true);
});

test('login by username prefix still works', () => {
  const rt = fresh();
  assert.equal(login(rt, 'pat', 'PackerPass1').success, true);
});

test('wrong password, wrong case, and the stored hash are all rejected', () => {
  const rt = fresh();
  assert.equal(login(rt, 'pat@example.com', 'wrong').success, false);
  assert.equal(login(rt, 'pat@example.com', 'packerpass1').success, false);
  assert.equal(login(rt, 'pat@example.com', 'PACKERPASS1').success, false);
  assert.equal(login(rt, 'pat@example.com', sha('PackerPass1')).success, false, 'pass-the-hash must fail');
  assert.equal(login(rt, 'pat@example.com', sha('PackerPass1').toUpperCase()).success, false);
});

test('plain-text password typed into the sheet works once and is upgraded to a hash', () => {
  const rt = fresh();
  assert.equal(login(rt, 'tim@example.com', 'temppass9').success, false, 'case must match');
  assert.equal(login(rt, 'tim@example.com', 'TempPass9').success, true);
  const row = rt.sheets.get('Users').rows.find((r) => r[2] === 'tim@example.com');
  assert.equal(row[3], sha('TempPass9'));
  assert.equal(login(rt, 'tim@example.com', 'TempPass9').success, true);
});

test('disabled account cannot sign in', () => {
  const rt = fresh();
  assert.equal(login(rt, 'dee@example.com', 'Disabled1').success, false);
});

test('a normal user cannot call admin actions', () => {
  const rt = fresh();
  const { token } = login(rt, 'pat@example.com', 'PackerPass1');
  for (const a of rt.sandbox.__ADMIN) {
    const res = rt.call(a, { token, name: 'X', email: 'x@x.com', password: 'abcdef1', row: 2, days: 1 });
    assert.equal(res.success, false, `${a} allowed for a normal user`);
    assert.match(res.error, /Administrator permission required|do not have permission|Only the Super Admin/, `${a}: ${res.error}`);
  }
  assert.equal(rt.sheets.get('Users').rows.length, USERS.length + 1);
});

test('an admin can still manage users', () => {
  const rt = fresh();
  const { token } = login(rt, 'alice@example.com', 'AdminPass1');
  const res = rt.call('adminCreateUser', { token, name: 'New Packer', email: 'new@example.com', password: 'secret12', role: 'User' });
  assert.equal(res.success, true, res.error);
  assert.equal(login(rt, 'new@example.com', 'secret12').success, true);
});

test('logout invalidates the token', () => {
  const rt = fresh();
  const { token } = login(rt, 'pat@example.com', 'PackerPass1');
  rt.call('logout', { token });
  assert.equal(rt.call('getUsers', { token }).code, 'AUTH_REQUIRED');
});

test('expired sessions are rejected even if still in storage', () => {
  const rt = fresh();
  const { token } = login(rt, 'pat@example.com', 'PackerPass1');
  const rec = JSON.parse(rt.props.get('SESS_' + token));
  rec.exp = Date.now() - 1000;
  rt.props.set('SESS_' + token, JSON.stringify(rec));
  rt.cache.set('SESSION_' + token, JSON.stringify(rec));
  assert.equal(rt.call('getUsers', { token }).code, 'AUTH_REQUIRED');
  assert.equal(rt.props.has('SESS_' + token), false, 'expired session should be removed');
});

test('old-format sessions (no expiry) are rejected', () => {
  const rt = fresh();
  rt.props.set('SESS_legacy', JSON.stringify({ name: 'Old', email: 'old@x.com', role: 'Admin' }));
  assert.equal(rt.call('getUsers', { token: 'legacy' }).code, 'AUTH_REQUIRED');
});

test('expired sessions are pruned from Script Properties on the next login', () => {
  const rt = fresh();
  rt.props.set('SESS_stale', JSON.stringify({ user: { email: 'a' }, exp: Date.now() - 5 }));
  rt.props.set('SESS_legacy', JSON.stringify({ email: 'b', role: 'Admin' }));
  rt.props.set('UPLOAD_keep', '{}');
  login(rt, 'pat@example.com', 'PackerPass1');
  assert.equal(rt.props.has('SESS_stale'), false);
  assert.equal(rt.props.has('SESS_legacy'), false);
  assert.equal(rt.props.has('UPLOAD_keep'), true, 'non-session properties must be left alone');
});
