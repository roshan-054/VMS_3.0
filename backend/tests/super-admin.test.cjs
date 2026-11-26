'use strict';
// Super Admin role, per-user permissions and the Super Admin-only Supabase settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const ROSHAN = 'roshan.k@paraayan.com';
const base = () => [
  [new Date(), 'Roshan', ROSHAN, sha('RoshanPass1'), 'Admin', 'Approved'],
  [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
];
const PW = { [ROSHAN]: 'RoshanPass1', 'alice@example.com': 'AdminPass1', 'pat@example.com': 'PackerPass1' };
const login = (rt, email) => {
  const r = rt.call('login', { email, password: PW[email] });
  assert.equal(r.success, true, r.error);
  return r;
};
const rowOf = (rt, email) => rt.sheets.get('Users').rows.findIndex((r) => String(r[2]).toLowerCase() === email) + 1;
const roleOf = (rt, email) => rt.sheets.get('Users').rows[rowOf(rt, email) - 1][4];

test('Roshan (an approved Admin) becomes Super Admin while there is none; other Admins stay Admin', () => {
  const rt = createRuntime({ users: base() });
  const alice = login(rt, 'alice@example.com');
  assert.equal(alice.user.role, 'Admin');
  assert.equal(roleOf(rt, ROSHAN), 'Super Admin', 'promoted on the first read of the Users sheet');
  const roshan = login(rt, ROSHAN);
  assert.equal(roshan.user.role, 'Super Admin');
  assert.equal(roleOf(rt, 'alice@example.com'), 'Admin');
  // Every permission is on for the Super Admin.
  assert.ok(Object.values(roshan.user.permissions).every((v) => v === true));
});

test('the bootstrap email gets nothing when it is not an approved Admin or a Super Admin already exists', () => {
  const asUser = base(); asUser[0][4] = 'User';
  const rt1 = createRuntime({ users: asUser });
  login(rt1, ROSHAN);
  assert.equal(roleOf(rt1, ROSHAN), 'User');

  const other = base(); other[1][4] = 'Super Admin';
  const rt2 = createRuntime({ users: other });
  login(rt2, ROSHAN);
  assert.equal(roleOf(rt2, ROSHAN), 'Admin');
});

test('existing Admins keep every admin tool, except Supabase settings and permissions', () => {
  const rt = createRuntime({ users: base() });
  const { token } = login(rt, 'alice@example.com');
  assert.equal(rt.call('getUsers', { token }).success, true);
  assert.equal(rt.call('scanSheetCleanup', { token }).success, true);
  assert.equal(rt.call('adminCreateUser', { token, name: 'N', email: 'n@example.com', password: 'secret12', role: 'User' }).success, true);
  for (const a of ['getSupabaseConfig', 'saveSupabaseConfig', 'supabaseImport', 'supabaseSweep', 'setUserPermissions']) {
    const r = rt.call(a, { token, email: 'pat@example.com', permissions: {} });
    assert.equal(r.success, false, a);
    assert.match(r.error, /Only the Super Admin/, a);
  }
});

test('the Super Admin can open Supabase settings', () => {
  const rt = createRuntime({ users: base() });
  const { token } = login(rt, ROSHAN);
  const r = rt.call('getSupabaseConfig', { token });
  assert.notEqual(r.error, 'Only the Super Admin can do this.');
  assert.equal(r.success, true, r.error);
});

test('Super Admin gives a User extra pages and actions; the backend honours them at once', () => {
  const rt = createRuntime({ users: base() });
  const su = login(rt, ROSHAN).token;
  const pat = login(rt, 'pat@example.com').token;

  let me = rt.call('getMyAccess', { token: pat });
  assert.equal(me.user.permissions.canAccessReports, false);
  assert.equal(me.user.permissions.canAccessRecord, true);
  assert.equal(rt.call('scanOlderVideos', { token: pat, days: 30 }).success, false);

  const set = rt.call('setUserPermissions', { token: su, email: 'pat@example.com', permissions: { canAccessReports: true, canDeleteData: true } });
  assert.equal(set.success, true, set.error);
  // Only the changes from the role defaults are stored, in the Permissions column.
  assert.equal(rt.sheets.get('Users').rows[0][6], 'Permissions');
  assert.deepEqual(JSON.parse(rt.sheets.get('Users').rows[rowOf(rt, 'pat@example.com') - 1][6]), { canAccessReports: true, canDeleteData: true });

  me = rt.call('getMyAccess', { token: pat });
  assert.equal(me.user.permissions.canAccessReports, true);
  assert.notEqual(rt.call('scanOlderVideos', { token: pat, days: 30 }).error, 'You do not have permission to do this. Ask the Super Admin to allow it.');
  assert.equal(rt.call('scanOlderVideos', { token: pat, days: 30 }).success !== false, true);
  // Still not allowed to manage users.
  assert.match(rt.call('adminCreateUser', { token: pat, name: 'X', email: 'x@example.com', password: 'secret12' }).error, /do not have permission/);

  // Reset to role defaults.
  assert.equal(rt.call('setUserPermissions', { token: su, email: 'pat@example.com', reset: true }).success, true);
  assert.equal(rt.call('getMyAccess', { token: pat }).user.permissions.canAccessReports, false);
});

test('Super Admin can take a tool away from an Admin', () => {
  const rt = createRuntime({ users: base() });
  const su = login(rt, ROSHAN).token;
  const alice = login(rt, 'alice@example.com').token;
  rt.call('setUserPermissions', { token: su, email: 'alice@example.com', permissions: { canDeleteData: false, canManageUsers: false } });
  assert.match(rt.call('scanOlderVideos', { token: alice, days: 30 }).error, /do not have permission/);
  assert.match(rt.call('adminCreateUser', { token: alice, name: 'X', email: 'x@example.com', password: 'secret12' }).error, /do not have permission/);
  // Other admin tools still work.
  assert.notEqual(rt.call('getStationQueues', { token: alice }).success, false);
});

test('an Admin cannot create, change, reset or delete a Super Admin', () => {
  const rt = createRuntime({ users: base() });
  login(rt, ROSHAN);
  const alice = login(rt, 'alice@example.com').token;
  assert.match(rt.call('adminCreateUser', { token: alice, name: 'S', email: 's@example.com', password: 'secret12', role: 'Super Admin' }).error, /Only the Super Admin/);
  const row = rowOf(rt, ROSHAN);
  assert.match(rt.call('adminManageUser', { token: alice, row, role: 'User', status: 'Approved', expectedEmail: ROSHAN }).error, /Only the Super Admin/);
  assert.match(rt.call('adminResetPassword', { token: alice, row, password: 'newpass12' }).error, /Only the Super Admin/);
  assert.match(rt.call('adminDeleteUser', { token: alice, row }).error, /Only the Super Admin/);
  // An Admin can still promote a User to Admin, as before.
  const pr = rowOf(rt, 'pat@example.com');
  assert.equal(rt.call('adminManageUser', { token: alice, row: pr, role: 'Admin', status: 'Approved', expectedEmail: 'pat@example.com' }).success, true);
  assert.match(rt.call('adminManageUser', { token: alice, row: pr, role: 'Super Admin', status: 'Approved', expectedEmail: 'pat@example.com' }).error, /Only the Super Admin/);
});

test('the only Super Admin cannot remove their own Super Admin role; a second one can be made', () => {
  const rt = createRuntime({ users: base() });
  const su = login(rt, ROSHAN).token;
  const row = rowOf(rt, ROSHAN);
  assert.match(rt.call('adminManageUser', { token: su, row, role: 'Admin', status: 'Approved', expectedEmail: ROSHAN }).error, /only Super Admin/);
  const ar = rowOf(rt, 'alice@example.com');
  assert.equal(rt.call('adminManageUser', { token: su, row: ar, role: 'Super Admin', status: 'Approved', expectedEmail: 'alice@example.com' }).success, true);
  assert.equal(roleOf(rt, 'alice@example.com'), 'Super Admin');
  assert.equal(rt.call('adminManageUser', { token: su, row, role: 'Admin', status: 'Approved', expectedEmail: ROSHAN }).success, true);
});

test('a disabled or demoted user loses access on the next request, without signing out', () => {
  const rt = createRuntime({ users: base() });
  const su = login(rt, ROSHAN).token;
  const alice = login(rt, 'alice@example.com').token;
  const pat = login(rt, 'pat@example.com').token;
  const ar = rowOf(rt, 'alice@example.com');
  assert.equal(rt.call('adminManageUser', { token: su, row: ar, role: 'User', status: 'Approved', expectedEmail: 'alice@example.com' }).success, true);
  assert.match(rt.call('scanOlderVideos', { token: alice, days: 30 }).error, /do not have permission/);
  assert.match(rt.call('getStationQueues', { token: alice }).error, /do not have permission/);

  const pr = rowOf(rt, 'pat@example.com');
  rt.call('adminManageUser', { token: su, row: pr, role: 'User', status: 'Disabled', expectedEmail: 'pat@example.com' });
  const r = rt.call('getUsers', { token: pat });
  assert.equal(r.success, false);
  assert.equal(r.code, 'AUTH_REQUIRED');
});

test('getUsers shows each user\'s role and permissions', () => {
  const rt = createRuntime({ users: base() });
  const su = login(rt, ROSHAN).token;
  rt.call('setUserPermissions', { token: su, email: 'pat@example.com', permissions: { canAccessSearch: true } });
  const users = rt.call('getUsers', { token: su }).users;
  const pat = users.find((u) => u.email === 'pat@example.com');
  assert.equal(pat.permissions.canAccessSearch, true);
  assert.equal(pat.customPermissions, true);
  assert.equal(users.find((u) => u.email === ROSHAN).role, 'Super Admin');
});
