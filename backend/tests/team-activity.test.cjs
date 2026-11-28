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
  assert.deepEqual(v.today, { assigned: 0, remaining: 0, recorded: 2, returns: 1, uploaded: 1, uploadFailed: 1, packed: 1 });
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

test('a date range counts that range; today stays the default', () => {
  const { rt, admin } = setup();
  const now = Date.now();
  const yday = new Date(now - 24 * 3600e3);
  const old = new Date(now - 10 * 24 * 3600e3);
  rt.sheets.get('OrderLog').rows.push(
    [new Date(now - 60000), 'OD-T', 'Amazon', 'vineet@vms.com', 'f1', '', '1 MB', 'Completed', 'Forward', 'j1', 'video/mp4', 'Ready'],
    [yday, 'OD-Y1', 'Amazon', 'vineet@vms.com', 'f2', '', '1 MB', 'Completed', 'Forward', 'j2', 'video/mp4', 'Ready'],
    [yday, 'OD-Y2', 'Amazon', 'vineet@vms.com', 'f3', '', '1 MB', 'Completed', 'Forward', 'j3', 'video/mp4', 'Ready'],
    [old, 'OD-O', 'Amazon', 'vineet@vms.com', 'f4', '', '1 MB', 'Completed', 'Forward', 'j4', 'video/mp4', 'Ready'],
  );
  const v = (res) => res.users.find((u) => u.email === 'vineet@vms.com').today.recorded;
  const tzName = rt.sandbox.Session.getScriptTimeZone();
  const k = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tzName || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  assert.equal(v(rt.call('getTeamActivity', { token: admin })), 1, 'today');
  const y = rt.call('getTeamActivity', { token: admin, from: k(yday), to: k(yday) });
  assert.equal(y.from, k(yday));
  assert.equal(v(y), 2, 'yesterday');
  assert.equal(v(rt.call('getTeamActivity', { token: admin, from: k(new Date(now - 6 * 24 * 3600e3)), to: k(new Date(now)) })), 3, 'last 7 days');
  assert.equal(v(rt.call('getTeamActivity', { token: admin, from: k(new Date(now)), to: k(old) })), 4, 'reversed range is swapped');
});

test('backlog: pending orders assigned to the packer and uploads that never finished, any date', () => {
  const { rt, admin } = setup();
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 24 * 3600e3);
  const man = rt.sheets.get('OrderManifest');
  if (!man.rows.length) man.rows.push(['Timestamp','Order ID','Platform','Assigned Packer Name','Assigned Packer Email','Processed By Name','Processed By Email','Total Items Count','Items List','Status','Notes','Packed At','Packed By Name','Video Drive Link']);
  man.rows.push(
    [daysAgo(3), 'OLD-PEND', 'Amazon', 'Vineet', 'vineet@vms.com', 'A', 'alice@example.com', 1, '', 'Pending', '', '', '', ''],
    [daysAgo(0.1), 'NEW-PEND', 'D2C', 'Vineet', 'Vineet@VMS.com', 'A', 'alice@example.com', 1, '', 'Pending', '', '', '', ''],
    [daysAgo(2), 'DONE', 'Amazon', 'Vineet', 'vineet@vms.com', 'A', 'alice@example.com', 1, '', 'Packed', '', '', '', ''],
    [daysAgo(2), 'RAVI-PEND', 'Amazon', 'Ravi', 'ravi@vms.com', 'A', 'alice@example.com', 1, '', 'Pending', '', '', '', ''],
  );
  const ul = rt.sheets.get('UploadLog').rows;
  const U = (d, id, status, err = '') => [d, id, 'Amazon', 'vineet@vms.com', id + '.mp4', '1 MB', 'u-' + id, status, 0, '', status, err, 'Forward', 'Recorder', 'j-' + id];
  ul.push(U(daysAgo(2), 'UP-FAIL', 'Failed', 'Network'));
  ul.push(U(daysAgo(2.1), 'UP-RETRIED', 'Failed'), U(daysAgo(1), 'UP-RETRIED', 'Completed'));
  ul.push(U(daysAgo(1.5), 'UP-RECORDED', 'Failed'));
  ul.push(U(daysAgo(45), 'UP-ANCIENT', 'Failed'));
  rt.sheets.get('OrderLog').rows.push([daysAgo(1.4), 'UP-RECORDED', 'Amazon', 'vineet@vms.com', 'fidR', '', '1 MB', 'Completed', 'Forward', 'jr', 'video/mp4', 'Ready']);

  const res = rt.call('getTeamActivity', { token: admin });
  const v = res.users.find((u) => u.email === 'vineet@vms.com');
  assert.deepEqual(v.pendingOrders.map((o) => o.orderId), ['OLD-PEND', 'NEW-PEND'], 'oldest first, packed ones left out');
  assert.equal(v.pendingOrderCount, 2);
  assert.ok(v.pendingOrders[0].at < v.pendingOrders[1].at);
  assert.deepEqual(v.openUploads.map((o) => o.orderId), ['UP-FAIL'], 'retried, recorded and very old ones left out');
  assert.equal(v.openUploads[0].error, 'Network');
  const r = res.users.find((u) => u.email === 'ravi@vms.com');
  assert.deepEqual(r.pendingOrders.map((o) => o.orderId), ['RAVI-PEND']);
  // The backlog is the same whatever range is picked.
  const old = rt.call('getTeamActivity', { token: admin, from: '2020-01-01', to: '2020-01-02' });
  assert.equal(old.users.find((u) => u.email === 'vineet@vms.com').pendingOrderCount, 2);
});

test('assigned counts orders given to each packer in the range, not cancelled ones', () => {
  const { rt, admin } = setup();
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const save = (orderId, email, msAgo, status) => {
    const r = rt.call('saveOrderManifest', { token: admin, manifest: { orderId, platform: 'Amazon', assignedPackerName: email, assignedPackerEmail: email, processedAt: iso(msAgo), status: status || 'Pending', items: [{ gtin: '1', quantity: 1 }] } });
    assert.equal(r.success, true, JSON.stringify(r));
  };
  save('AS-1', 'vineet@vms.com', 60000);
  save('AS-2', 'Vineet@VMS.com', 120000, 'Packed');
  save('AS-3', 'vineet@vms.com', 180000, 'Cancelled');
  save('AS-4', 'ravi@vms.com', 60000);
  save('AS-5', 'vineet@vms.com', 3 * 24 * 3600e3);
  const pick = (res, e) => res.users.find((u) => u.email === e);
  const today = rt.call('getTeamActivity', { token: admin });
  assert.equal(pick(today, 'vineet@vms.com').today.assigned, 2);
  assert.equal(pick(today, 'ravi@vms.com').today.assigned, 1);
  assert.equal(pick(today, 'vineet@vms.com').today.remaining, 1, 'remaining = assigned in range and still Pending');
  assert.equal(pick(today, 'ravi@vms.com').today.remaining, 1);
  assert.equal(pick(today, 'vineet@vms.com').pendingOrderCount, 2, 'pending backlog is still any date');
  const day = (ms) => { const d = new Date(now - ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const week = rt.call('getTeamActivity', { token: admin, from: day(6 * 24 * 3600e3), to: day(0) });
  assert.equal(pick(week, 'vineet@vms.com').today.assigned, 3);
  assert.equal(pick(week, 'vineet@vms.com').today.remaining, 2);
});
