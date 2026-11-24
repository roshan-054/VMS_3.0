import test from 'node:test';
import assert from 'node:assert/strict';
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { isMasterAdmin, isAdmin } = await import('../src/lib/permissions.ts');

test('no account is privileged by its email address', () => {
  for (const email of ['askroshan.2002@gmail.com', 'roshan.k@paraayan.com', 'admin@ops.local', 'master@vms.local']) {
    const u = { name: 'x', email, role: 'User' as const, status: 'Approved' as const };
    assert.equal(isMasterAdmin(u), false, email);
    assert.equal(isAdmin(u), false, email);
  }
});

test('admin roles from the backend are still recognised', () => {
  assert.equal(isAdmin({ name: 'a', email: 'a@x.com', role: 'Admin', status: 'Approved' }), true);
  assert.equal(isMasterAdmin({ name: 'a', email: 'a@x.com', role: 'Master Admin', status: 'Approved' }), true);
});
