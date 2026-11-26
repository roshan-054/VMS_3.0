import test from 'node:test';
import assert from 'node:assert/strict';
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import('../src/lib/permissions.ts');
const { isMasterAdmin, isSuperAdmin, isAdmin, getUserPermissions } = P;

const user = (role: any, permissions?: any) => ({ name: 'x', email: 'x@x.com', role, status: 'Approved' as const, permissions });

test('no account is privileged by its email address', () => {
  for (const email of ['askroshan.2002@gmail.com', 'roshan.k@paraayan.com', 'admin@ops.local', 'master@vms.local']) {
    const u = { name: 'x', email, role: 'User' as const, status: 'Approved' as const };
    assert.equal(isMasterAdmin(u), false, email);
    assert.equal(isSuperAdmin(u), false, email);
    assert.equal(isAdmin(u), false, email);
  }
});

test('roles from the backend are recognised', () => {
  assert.equal(isAdmin(user('Admin')), true);
  assert.equal(isSuperAdmin(user('Admin')), false);
  assert.equal(isSuperAdmin(user('Super Admin')), true);
  assert.equal(isAdmin(user('Super Admin')), true);
  assert.equal(isSuperAdmin(user('Master Admin')), true, 'older name of the same role');
});

test('role defaults keep today\'s behaviour', () => {
  const u = getUserPermissions(user('User'));
  assert.equal(u.canAccessRecord && u.canAccessProcessing && u.canAccessQueue && u.canAccessLogs, true);
  assert.equal(u.canAccessSearch || u.canAccessReports || u.canAccessAnalytics || u.canAccessHealth, false);
  assert.equal(u.canDeleteData || u.canManageUsers || u.canManageSettings || u.canManageBranding, false);
  assert.ok(Object.values(getUserPermissions(user('Admin'))).every(Boolean));
  assert.equal(P.canUserAccessAdminPanel(user('User')), false);
  assert.equal(P.canUserAccessAdminPanel(user('Admin')), true);
});

test('permissions from the backend win over the role defaults', () => {
  const packer = user('User', { canAccessReports: true, canAccessLogs: false });
  assert.equal(P.canUserAccessReports(packer), true);
  assert.equal(P.canUserAccessLogs(packer), false);
  const admin = user('Admin', { canDeleteData: false, canManageSettings: false });
  assert.equal(P.canUserDeleteData(admin), false);
  assert.equal(P.canUserAccessSettingsPage(admin), false);
  assert.equal(P.canUserAccessAdminPanel(admin), true);
  // The Super Admin always has everything, whatever is stored.
  assert.equal(P.canUserDeleteData(user('Super Admin', { canDeleteData: false })), true);
});

test('only the Super Admin edits permissions and sees Supabase settings', () => {
  assert.equal(P.canUserEditPermissions(user('Admin')), false);
  assert.equal(P.canUserSeeSupabaseSettings(user('Admin')), false);
  assert.equal(P.canUserEditPermissions(user('Super Admin')), true);
  assert.equal(P.canUserSeeSupabaseSettings(user('Super Admin')), true);
});
