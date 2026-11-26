'use strict';
// First-admin bootstrap, sign-up approval and the retired default password.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('an empty Users sheet is not seeded with a default admin', () => {
  const rt = createRuntime({ users: [] });
  const res = rt.call('login', { email: 'admin@ops.local', password: 'Admin@123' });
  assert.equal(res.success, false);
  assert.match(res.error, /No accounts exist yet/);
  assert.equal(rt.sheets.get('Users').rows.length, 1, 'only the header row');
});

test('setup does not create a default admin account', () => {
  const rt = createRuntime({ users: [] });
  // setup is admin-only, so call the function directly as the Apps Script editor would.
  rt.sandbox.setupSystem();
  const emails = rt.sheets.get('Users').rows.slice(1).map((r) => r[2]);
  assert.ok(!emails.includes('admin@ops.local'));
});

test('first sign-up on an empty sheet becomes an approved Admin and is signed in', () => {
  const rt = createRuntime({ users: [] });
  const res = rt.call('signup', { fullName: 'Owner', email: 'owner@example.com', password: 'Str0ngPass!' });
  assert.equal(res.success, true, res.error);
  assert.ok(res.token);
  assert.equal(res.user.role, 'Super Admin');
  const row = rt.sheets.get('Users').rows[1];
  assert.deepEqual([row[2], row[4], row[5]], ['owner@example.com', 'Super Admin', 'Approved']);
  assert.equal(rt.call('getUsers', { token: res.token }).success, true);
});

test('later sign-ups are Pending, get no session, and cannot sign in until approved', () => {
  const rt = createRuntime({ users: [] });
  const owner = rt.call('signup', { fullName: 'Owner', email: 'owner@example.com', password: 'Str0ngPass!' });
  const res = rt.call('signup', { fullName: 'Stranger', email: 'stranger@example.com', password: 'Another1!' });
  assert.equal(res.success, true);
  assert.equal(res.pending, true);
  assert.equal(res.token, undefined);
  const row = rt.sheets.get('Users').rows.find((r) => r[2] === 'stranger@example.com');
  assert.deepEqual([row[4], row[5]], ['User', 'Pending']);

  const denied = rt.call('login', { email: 'stranger@example.com', password: 'Another1!' });
  assert.equal(denied.success, false);
  assert.match(denied.error, /pending/i);

  const rowNum = rt.sheets.get('Users').rows.findIndex((r) => r[2] === 'stranger@example.com') + 1;
  const ok = rt.call('adminManageUser', { token: owner.token, row: rowNum, role: 'User', status: 'Approved', expectedEmail: 'stranger@example.com' });
  assert.equal(ok.success, true, ok.error);
  assert.equal(rt.call('login', { email: 'stranger@example.com', password: 'Another1!' }).success, true);
});

test('sign-up cannot claim the Admin role once an admin exists', () => {
  const rt = createRuntime({ users: [[new Date(), 'A', 'a@example.com', sha('AdminPass1'), 'Admin', 'Approved']] });
  rt.call('signup', { fullName: 'X', email: 'x@example.com', password: 'Password9', role: 'Admin' });
  const row = rt.sheets.get('Users').rows.find((r) => r[2] === 'x@example.com');
  assert.equal(row[4], 'User');
});

test('sign-up rejects short passwords and the old default password', () => {
  const rt = createRuntime({ users: [] });
  assert.equal(rt.call('signup', { fullName: 'A', email: 'a@example.com', password: 'short1' }).success, false);
  assert.equal(rt.call('signup', { fullName: 'A', email: 'a@example.com', password: 'Admin@123' }).success, false);
  assert.equal(rt.sheets.get('Users').rows.length, 1);
});

test('an existing account still using Admin@123 is blocked with instructions', () => {
  const rt = createRuntime({ users: [[new Date(), 'Super Admin', 'admin@ops.local', sha('Admin@123'), 'Admin', 'Approved']] });
  const res = rt.call('login', { email: 'admin@ops.local', password: 'Admin@123' });
  assert.equal(res.success, false);
  assert.match(res.error, /old default password/);
  // Typing a new password into the sheet lets the admin back in.
  rt.sheets.get('Users').rows[1][3] = 'NewSecret#2026';
  assert.equal(rt.call('login', { email: 'admin@ops.local', password: 'NewSecret#2026' }).success, true);
});

test('duplicate sign-up email is rejected', () => {
  const rt = createRuntime({ users: [] });
  rt.call('signup', { fullName: 'Owner', email: 'owner@example.com', password: 'Str0ngPass!' });
  const dup = rt.call('signup', { fullName: 'Owner2', email: 'OWNER@example.com', password: 'Str0ngPass!' });
  assert.equal(dup.success, false);
});
