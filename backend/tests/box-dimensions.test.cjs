'use strict';
// Box dimensions & volumetric weight: Super Admin switch, saved boxes, per-order details, report columns.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const users = () => [
  [new Date(), 'Sue Super', 'sue@example.com', sha('SuperPass1'), 'Super Admin', 'Approved'],
  [new Date(), 'Alice Admin', 'alice@example.com', sha('AdminPass1'), 'Admin', 'Approved'],
  [new Date(), 'Pat Packer', 'pat@example.com', sha('PackerPass1'), 'User', 'Approved'],
  [new Date(), 'Quinn Packer', 'quinn@example.com', sha('PackerPass2'), 'User', 'Approved'],
];
const PW = { 'sue@example.com': 'SuperPass1', 'alice@example.com': 'AdminPass1', 'pat@example.com': 'PackerPass1', 'quinn@example.com': 'PackerPass2' };
const login = (rt, email) => {
  const r = rt.call('login', { email, password: PW[email] });
  assert.equal(r.success, true, r.error);
  return r.token;
};
const today = () => new Date().toISOString().slice(0, 10);

test('only the Super Admin can switch the feature on or off and set the divisor', () => {
  const rt = createRuntime({ users: users() });
  const alice = login(rt, 'alice@example.com');
  const pat = login(rt, 'pat@example.com');
  for (const t of [alice, pat]) {
    const r = rt.call('setBoxFeature', { token: t, enabled: true });
    assert.equal(r.success, false);
    assert.match(r.error, /Only the Super Admin/);
  }
  assert.equal(rt.call('getBoxSettings', { token: pat }).enabled, false, 'off by default');
  const sue = login(rt, 'sue@example.com');
  const on = rt.call('setBoxFeature', { token: sue, enabled: true });
  assert.equal(on.success, true, on.error);
  assert.equal(on.enabled, true);
  assert.equal(on.divisor, 5000);
  const d = rt.call('setBoxFeature', { token: sue, divisor: 4000 });
  assert.equal(d.divisor, 4000);
  assert.equal(rt.call('setBoxFeature', { token: sue, divisor: 50 }).success, false);
  const seen = rt.call('getBoxSettings', { token: pat });
  assert.equal(seen.enabled, true);
  assert.equal(seen.divisor, 4000);
  const off = rt.call('setBoxFeature', { token: sue, enabled: false });
  assert.equal(off.enabled, false);
});

test('members add box sizes; the creator or an admin can remove them', () => {
  const rt = createRuntime({ users: users() });
  const sue = login(rt, 'sue@example.com');
  const pat = login(rt, 'pat@example.com');
  const quinn = login(rt, 'quinn@example.com');
  const alice = login(rt, 'alice@example.com');
  assert.match(rt.call('saveBoxPreset', { token: pat, name: 'Box-1', l: 10, b: 10, h: 3 }).error, /switched off/);
  rt.call('setBoxFeature', { token: sue, enabled: true });
  const a = rt.call('saveBoxPreset', { token: pat, name: 'Box-1', l: 10, b: 10, h: 3 });
  assert.equal(a.success, true, a.error);
  assert.deepEqual(a.presets.map((p) => [p.name, p.l, p.b, p.h, p.by]), [['Box-1', 10, 10, 3, 'pat@example.com']]);
  // Same name again updates the size instead of adding a second one.
  const upd = rt.call('saveBoxPreset', { token: quinn, name: 'box-1', l: 12, b: 10, h: 3 });
  assert.equal(upd.presets.length, 1);
  assert.equal(upd.presets[0].l, 12);
  assert.equal(upd.presets[0].by, 'pat@example.com');
  assert.equal(rt.call('saveBoxPreset', { token: pat, name: 'Bad', l: 0, b: 10, h: 3 }).success, false);
  const id = upd.presets[0].id;
  assert.match(rt.call('deleteBoxPreset', { token: quinn, id }).error, /Only the member who added/);
  const del = rt.call('deleteBoxPreset', { token: alice, id });
  assert.equal(del.success, true, del.error);
  assert.equal(del.presets.length, 0);
  rt.call('saveBoxPreset', { token: quinn, name: 'Box-2', l: 20, b: 15, h: 10 });
  const own = rt.call('getBoxSettings', { token: quinn }).presets[0];
  assert.equal(rt.call('deleteBoxPreset', { token: quinn, id: own.id }).success, true);
});

test('package details: volumetric and chargeable weight, one row per order and type, in the report', () => {
  const rt = createRuntime({ users: users() });
  const sue = login(rt, 'sue@example.com');
  const pat = login(rt, 'pat@example.com');
  assert.match(rt.call('savePackageDetails', { token: pat, orderId: '#OD-10063', platform: 'D2C', recordingType: 'Forward', l: 10, b: 10, h: 3, actualWeight: 0.2 }).error, /switched off/);
  rt.call('setBoxFeature', { token: sue, enabled: true });

  const r = rt.call('savePackageDetails', { token: pat, orderId: '#OD-10063', platform: 'D2C', recordingType: 'Forward', boxName: 'Box-1', l: 10, b: 10, h: 3, actualWeight: 0.2 });
  assert.equal(r.success, true, r.error);
  assert.equal(r.volumetricWeight, 0.06); // 300 / 5000
  assert.equal(r.chargeableWeight, 0.2);
  const big = rt.call('savePackageDetails', { token: pat, orderId: '408-1234567-1234567', platform: 'Amazon', recordingType: 'Forward', l: '30', b: '25', h: '20', actualWeight: '1,5' });
  assert.equal(big.volumetricWeight, 3); // 15000 / 5000
  assert.equal(big.chargeableWeight, 3);
  assert.equal(big.box, 'Custom');
  assert.match(rt.call('savePackageDetails', { token: pat, orderId: 'X1', platform: 'D2C', l: 10, b: 10 }).error, /all three/);
  assert.match(rt.call('savePackageDetails', { token: pat, orderId: 'X1', platform: 'D2C' }).error, /box size or the actual weight/);
  assert.match(rt.call('savePackageDetails', { token: pat, orderId: 'X1', platform: 'D2C', l: 'abc', b: 1, h: 1 }).error, /numbers above 0/);

  // Saving the same order again replaces its row; a Return of the same order is its own row.
  rt.call('savePackageDetails', { token: pat, orderId: 'OD-10063', platform: 'D2C', recordingType: 'Forward', boxName: 'Box-1', l: 10, b: 10, h: 3, actualWeight: 0.25 });
  rt.call('savePackageDetails', { token: pat, orderId: '#OD-10063', platform: 'D2C', recordingType: 'Return', actualWeight: 0.3 });
  const sh = rt.sheets.get('PackageDetails');
  assert.deepEqual(sh.rows[0].slice(0, 5), ['Timestamp', 'Order ID', 'Platform', 'Recording Type', 'Box']);
  const data = sh.rows.slice(1);
  assert.equal(data.length, 3);
  const fwd = data.filter((x) => x[1] === '#OD-10063' && x[3] === 'Forward');
  assert.equal(fwd.length, 1);
  assert.equal(fwd[0][8], 0.25);

  // The report gets the box columns for the matching order and type.
  rt.sheets.get('OrderLog').rows.push([new Date(), '#OD-10063', 'D2C', 'pat@example.com', 'FILEID12345', 'https://drive.google.com/file/d/FILEID12345/preview', '1 MB', 'Completed', 'Forward', 'job1', 'video/mp4', 'READY']);
  rt.sheets.get('OrderLog').rows.push([new Date(), 'NOBOX-1', 'D2C', 'pat@example.com', 'FILEID99999', '', '1 MB', 'Completed', 'Forward', 'job2', 'video/mp4', 'READY']);
  const rep = rt.call('getReportData', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(rep.success, true, rep.error);
  const row = rep.rows.find((x) => x['Order ID'] === '#OD-10063');
  assert.equal(row['Box'], 'Box-1');
  assert.equal(row['Length (cm)'], 10);
  assert.equal(row['Actual Weight (kg)'], 0.25);
  assert.equal(row['Volumetric Weight (kg)'], 0.06);
  assert.equal(row['Chargeable Weight (kg)'], 0.25);
  const none = rep.rows.find((x) => x['Order ID'] === 'NOBOX-1');
  assert.equal(none['Box'], '');
  assert.ok('Volumetric Weight (kg)' in none);
});

test('the report has no box columns while the feature is off and nothing was saved', () => {
  const rt = createRuntime({ users: users() });
  const sue = login(rt, 'sue@example.com');
  rt.sheets.get('OrderLog').rows.push([new Date(), 'A-1', 'D2C', 'pat@example.com', 'FILEID12345', '', '1 MB', 'Completed', 'Forward', 'j', 'video/mp4', 'READY']);
  const rep = rt.call('getReportData', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(rep.success, true, rep.error);
  assert.ok(!('Box' in rep.rows[0]));
});
