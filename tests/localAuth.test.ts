// Offline sign-in rules. Run with: npm run test:web
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as any).localStorage = new MemoryStorage();
// Simulate an old install that still has the v3 store with plain-text default passwords.
localStorage.setItem('vms_local_users_v3', JSON.stringify([
  { name: 'Workstation Admin', email: 'admin@ops.local', role: 'Admin', status: 'Approved', passwordHash: 'Admin@123' },
]));

const auth = await import('../src/lib/localAuth.ts');

test('legacy v3 user store with plain-text passwords is wiped on load', () => {
  assert.equal(localStorage.getItem('vms_local_users_v3'), null);
});

test('built-in accounts and Admin@123 do not work offline', async () => {
  for (const id of ['admin', 'admin@ops.local', 'askroshan.2002@gmail.com']) {
    await assert.rejects(auth.localLogin(id, 'Admin@123'), /cannot be reached/);
  }
});

test('there are no default users in the local directory', () => {
  assert.deepEqual(auth.getLocalUsers(), []);
});

test('a user who signed in online can sign in offline with the same password only', async () => {
  const user = { name: 'Pat', email: 'pat@example.com', role: 'User' as const, status: 'Approved' as const };
  await auth.rememberOfflineCredential(user, 'PackerPass1');

  const raw = localStorage.getItem('vms_offline_credentials_v1')!;
  assert.ok(!raw.includes('PackerPass1'), 'password must not be stored');

  const ok = await auth.localLogin('pat@example.com', 'PackerPass1');
  assert.equal(ok.success, true);
  assert.equal(ok.user.email, 'pat@example.com');
  assert.ok(auth.isLocalSessionToken(ok.token));
  assert.equal((await auth.localLogin('pat', 'PackerPass1')).success, true, 'user ID prefix works');

  await assert.rejects(auth.localLogin('pat@example.com', 'packerpass1'), /Incorrect password/);
  await assert.rejects(auth.localLogin('pat@example.com', 'wrong'), /Incorrect password/);
});

test('cached role cannot be upgraded by signing in offline', async () => {
  const res = await auth.localLogin('pat@example.com', 'PackerPass1');
  assert.equal(res.user.role, 'User');
});

test('deleting a user also removes their offline credential', async () => {
  auth.deleteLocalUserByEmail('pat@example.com');
  await assert.rejects(auth.localLogin('pat@example.com', 'PackerPass1'), /cannot be reached/);
});

test('user directory cache never stores passwords', () => {
  auth.syncAllLocalUsers([{ name: 'A', email: 'a@example.com', role: 'Admin', status: 'Approved', passwordHash: 'x' } as any]);
  assert.ok(!localStorage.getItem('vms_local_users_v4')!.includes('passwordHash'));
});
