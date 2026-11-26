'use strict';
// Live Team page: today's work per user (recordings, uploads, packed orders) and last action.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function setup() {
  const rt = createRuntime({ users: [
    [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
    [new Date(), 'Vineet', 'vineet@vms.com', sha('PackerPass1'), 'User', 'Approved'],
    [new Date(), 'Ravi', 'ravi@vms.com', sha('PackerPass1'), 'User', 'Approved'],
    [new Date(), 'Pending Person', 'new@vms.com', sha('PackerPass1'), 'User', 'Pending'],
  ] });
  const tok = (e, p) => rt.call('login', { email: e, password: p }).token;
  return { rt, admin: tok('alice@example.com', 'AdminPass1'), vineet: tok('vineet@vms.com', 'PackerPass1') };
}

test('admin sees each approved user\'s work today and their last action', () => {
  const { rt, admin, vineet } = setup();
  const now = Date.now();
  const at = (minsAgo) => new Date(now - minsAgo * 60000);
  const yesterday = new Date(now - 36 * 3600e3);
  rt.sheets.get('OrderLog').rows.push(
    [at(30), 'OD-1', 'Amazon', 'vineet@vms.com', 'f1', '', '1 MB', 'Completed', 'Forward', 'j1', 'video/mp4', 'Ready'],
    [at(20), 'OD-2', 'Amazon', 'Vineet@VMS.com', 'f2', '', '1 MB', 'Completed', 'Forward', 'j2', 'video/mp4', 'Ready'],
    [yesterday, 'OD-0', 'Amazon', 'vineet@vms.com', 'f0', '', '1 MB', 'Completed', 'Forward', 'j0', 'video/mp4', 'Ready'],
    [at(50), 'OD-R', 'Amazon', 'ravi@vms.com', 'f3', '', '1 MB', 'Completed', 'Forward', 'j3', 'video/mp4', 'Ready'],
  );
  rt.sheets.get('ReturnLog').rows.push([at(15), 'RT-1', 'D2C', 'vineet@vms.com', 'f4', '', '1 MB', 'Completed', 'Return', 'j4', 'video/mp4', 'Ready']);
  const ul = rt.sheets.get('UploadLog').rows;
  ul.push([at(19), 'OD-2', 'Amazon', 'vineet@vms.com', 'OD-2.mp4', '1 MB', 'u2', 'Uploaded', 100, 'f2', 'Completed', '', 'Forward', 'Recorder', 'j2']);
  ul.push([at(10), 'OD-3', 'Amazon', 'vineet@vms.com', 'OD-3.mp4', '1 MB', 'u3', 'Error', 10, '', 'Failed', 'Network', 'Forward', 'Recorder', 'j5']);
  const pv = rt.call('logPackVerification', { token: vineet, log: { orderId: 'OD-4', platform: 'Amazon', assignedPacker: 'Vineet', verifiedByPacker: 'Vineet', packerEmail: 'vineet@vms.com', processedBy: 'Alice', status: 'MATCHED', totalRequired: 1, totalScanned: 1 } });
  assert.equal(pv.success, true, JSON.stringify(pv));

  const res = rt.call('getTeamActivity', { token: admin });
  assert.equal(res.success, true, JSON.stringify(res));
  assert.match(res.date, /^\d{4}-\d{2}-\d{2}$/);
  const emails = res.users.map((u) => u.email.toLowerCase());
  assert.ok(!emails.includes('new@vms.com'), 'users waiting for approval are not listed');
  const v = res.users.find((u) => u.email === 'vineet@vms.com');
  assert.deepEqual(v.today, { recorded: 2, returns: 1, uploaded: 1, uploadFailed: 1, packed: 1 });
  assert.equal(v.lastAction, 'Packed OD-4');
  const r = res.users.find((u) => u.email === 'ravi@vms.com');
  assert.equal(r.today.recorded, 1);
  assert.equal(r.lastAction, 'Recorded OD-R');
  const a = res.users.find((u) => u.email === 'alice@example.com');
  assert.equal(a.lastAction, 'Signed in');
});

test('packers cannot read the team board', () => {
  const { rt, vineet } = setup();
  const res = rt.call('getTeamActivity', { token: vineet });
  assert.equal(res.success, false);
});

test('station reports keep a short activity line and nothing else', () => {
  const { rt, admin, vineet } = setup();
  rt.call('reportStationQueue', { token: vineet, items: [], activity: { page: 'Scan & Record', orderId: 'OD-9', state: 'recording', lastAction: 'Started recording OD-9', lastActionAt: 123, extra: 'x'.repeat(5000) } });
  const st = rt.call('getStationQueues', { token: admin }).stations.find((s) => s.email === 'vineet@vms.com');
  assert.deepEqual(st.activity, { page: 'Scan & Record', orderId: 'OD-9', state: 'recording', lastAction: 'Started recording OD-9', lastActionAt: 123 });
  rt.call('reportStationQueue', { token: vineet, items: [], activity: { state: 'hacking' } });
  const st2 = rt.call('getStationQueues', { token: admin }).stations.find((s) => s.email === 'vineet@vms.com');
  assert.equal(st2.activity.state, '');
});
