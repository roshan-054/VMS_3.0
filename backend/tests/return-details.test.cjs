'use strict';
// Return details (type, logistics partner, condition, customer) and Return & RTO analytics.
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
const returnRow = (oid, pf = 'D2C') => [new Date(), oid, pf, 'pat@example.com', 'FILE' + oid.replace(/\W/g, '') + '12345', '', '1 MB', 'Completed', 'Return', 'j-' + oid, 'video/mp4', 'READY'];
const forwardRow = (oid, pf = 'D2C') => [new Date(), oid, pf, 'pat@example.com', 'FWD' + oid.replace(/\W/g, '') + '12345', '', '1 MB', 'Completed', 'Forward', 'f-' + oid, 'video/mp4', 'READY'];

test('logistics partners: defaults, members add, creator or admin removes', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  const quinn = login(rt, 'quinn@example.com');
  const alice = login(rt, 'alice@example.com');
  const s = rt.call('getReturnSettings', { token: pat });
  assert.equal(s.success, true, s.error);
  assert.ok(s.partners.some((x) => x.name === 'Delhivery'), 'common couriers listed by default');
  assert.ok(s.conditions.includes('Damaged'));
  assert.deepEqual(s.returnTypes, ['RTO', 'Customer Return']);
  const add = rt.call('saveLogisticsPartner', { token: pat, name: '  Shiprocket   Quick ' });
  assert.equal(add.success, true, add.error);
  assert.equal(add.partner.name, 'Shiprocket Quick');
  const again = rt.call('saveLogisticsPartner', { token: quinn, name: 'shiprocket quick' });
  assert.equal(again.partners.filter((x) => /shiprocket/i.test(x.name)).length, 1, 'no duplicate');
  const id = add.partner.id;
  assert.match(rt.call('deleteLogisticsPartner', { token: quinn, id }).error, /Only the member who added/);
  // Default partners can only be removed by an admin.
  const dl = s.partners[0].id;
  assert.match(rt.call('deleteLogisticsPartner', { token: pat, id: dl }).error, /Only the member who added/);
  assert.equal(rt.call('deleteLogisticsPartner', { token: pat, id }).success, true);
  const del = rt.call('deleteLogisticsPartner', { token: alice, id: dl });
  assert.equal(del.success, true, del.error);
  assert.ok(!del.partners.some((x) => x.id === dl));
  // The list persists for everyone.
  assert.ok(!rt.call('getReturnSettings', { token: quinn }).partners.some((x) => x.id === dl));
});

test('return details: validation, one row per order, new partner saved, in the report', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  const sue = login(rt, 'sue@example.com');
  assert.match(rt.call('saveReturnDetails', { token: pat, platform: 'D2C' }).error, /Order ID is required/);
  assert.match(rt.call('saveReturnDetails', { token: pat, orderId: 'OD-1', platform: 'D2C' }).error, /at least one/);
  assert.match(rt.call('saveReturnDetails', { token: pat, orderId: 'OD-1', platform: 'D2C', pincode: '1234' }).error, /6 digits/);
  assert.match(rt.call('saveReturnDetails', { token: pat, orderId: 'OD-1', platform: 'D2C', customerPhone: '98765' }).error, /10 digits/);

  const r = rt.call('saveReturnDetails', { token: pat, orderId: 'od-10063', platform: 'D2C', returnType: 'RTO', logisticsPartner: 'Trackon',
    condition: 'Good / resellable', notes: 'Seal intact', pincode: '110 001', customerName: 'Ravi K', customerPhone: '+91 98765 43210', notReceivedClaim: true });
  assert.equal(r.success, true, r.error);
  assert.equal(r.orderId, '#OD-10063');
  assert.equal(r.pincode, '110001');
  assert.equal(r.customerPhone, '9876543210');
  assert.ok(rt.call('getReturnSettings', { token: pat }).partners.some((x) => x.name === 'Trackon'), 'typed partner kept for later');

  const r2 = rt.call('saveReturnDetails', { token: pat, orderId: '#OD-10063', platform: 'D2C', returnType: 'RTO', logisticsPartner: 'Trackon', condition: 'Damaged', pincode: '110001' });
  assert.equal(r2.replaced, true);
  const data = rt.sheets.get('ReturnDetails').rows;
  assert.deepEqual(data[0].slice(0, 6), ['Timestamp', 'Order ID', 'Platform', 'Return Type', 'Logistics Partner', 'Return Condition']);
  assert.equal(data.length, 2);
  assert.equal(data[1][5], 'Damaged');

  const info = rt.call('getReturnOrderInfo', { token: pat, orderId: 'OD-10063', platform: 'D2C' });
  assert.equal(info.saved.condition, 'Damaged');
  assert.equal(info.order, null);

  rt.sheets.get('ReturnLog').rows.push(returnRow('#OD-10063'));
  rt.sheets.get('OrderLog').rows.push(forwardRow('#OD-10063'));
  const rep = rt.call('getReportData', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(rep.success, true, rep.error);
  const ret = rep.rows.find((x) => x['Recording Type'] === 'Return');
  assert.equal(ret['Return Type'], 'RTO');
  assert.equal(ret['Logistics Partner'], 'Trackon');
  assert.equal(ret['Return Condition'], 'Damaged');
  assert.equal(ret['Pincode'], '110001');
  const fwd = rep.rows.find((x) => x['Recording Type'] === 'Forward');
  assert.equal(fwd['Return Type'], '');
  assert.ok('Customer Phone' in fwd);
});

test('the report has no return columns when no return details were saved', () => {
  const rt = createRuntime({ users: users() });
  const sue = login(rt, 'sue@example.com');
  rt.sheets.get('ReturnLog').rows.push(returnRow('A-1'));
  const rep = rt.call('getReportData', { token: sue, fromDate: today(), toDate: today() });
  assert.ok(!('Return Type' in rep.rows[0]));
});

test('order data: customer and pincode come from the ShopifyOrders tab by header', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  rt.addSheet('ShopifyOrders', [
    ['Synced At', 'Order ID', 'Order Date', 'Payment', 'Customer Name', 'Customer Phone', 'Shipping Pincode', 'Shipping City', 'Courier'],
    [new Date(), '#OD-2001', new Date(), 'COD', 'Meena S', '9000000001', '560001', 'Bengaluru', 'Delhivery'],
  ]);
  const info = rt.call('getReturnOrderInfo', { token: pat, orderId: 'OD-2001', platform: 'D2C' });
  assert.equal(info.success, true, info.error);
  assert.equal(info.saved, null);
  assert.equal(info.order.customerName, 'Meena S');
  assert.equal(info.order.pincode, '560001');
  assert.equal(info.order.logisticsPartner, 'Delhivery');
});

test('return analytics: rates by partner and pincode, repeat and suspicious customers', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  const sue = login(rt, 'sue@example.com');
  assert.match(rt.call('getReturnAnalytics', { token: pat, fromDate: today(), toDate: today() }).error || '', /permission|not allowed|access/i);

  const now = new Date();
  const orders = [['Synced At', 'Order ID', 'Order Date', 'Customer Name', 'Phone', 'Email', 'Shipping Zip', 'City', 'Tracking Company']];
  // Suspicious: 4 orders, 2 RTOs + 1 not-received claim.
  ['3001', '3002', '3003', '3004'].forEach((n) => orders.push([now, '#OD-' + n, now, 'Raj', '9111111111', 'raj@x.com', '400001', 'Mumbai', 'Delhivery']));
  // Loyal repeat buyer: 3 orders, no returns.
  ['3101', '3102', '3103'].forEach((n) => orders.push([now, '#OD-' + n, now, 'Anu', '9222222222', '', '560001', 'Bengaluru', 'Blue Dart']));
  // One-off with one customer return.
  orders.push([now, '#OD-3201', now, 'Kiran', '9333333333', '', '560001', 'Bengaluru', 'Blue Dart']);
  rt.addSheet('ShopifyOrders', orders);

  const save = (oid, extra) => {
    const r = rt.call('saveReturnDetails', { token: pat, orderId: oid, platform: 'D2C', ...extra });
    assert.equal(r.success, true, r.error);
    rt.sheets.get('ReturnLog').rows.push(returnRow('#' + oid.replace(/^#/, '')));
  };
  save('OD-3001', { returnType: 'RTO', logisticsPartner: 'Delhivery' });
  save('OD-3002', { returnType: 'RTO', logisticsPartner: 'Delhivery' });
  save('OD-3003', { returnType: 'Customer Return', logisticsPartner: 'Delhivery', notReceivedClaim: true, condition: 'Empty box' });
  save('OD-3201', { returnType: 'Customer Return', logisticsPartner: 'Blue Dart', condition: 'Damaged' });

  const a = rt.call('getReturnAnalytics', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(a.success, true, a.error);
  assert.deepEqual(a.orderData, { available: true, hasCustomer: true, hasPincode: true, hasCourier: true, hasTags: false, hasPayMode: false });
  assert.equal(a.totals.returns, 4);
  assert.equal(a.totals.rto, 2);
  assert.equal(a.totals.customerReturns, 2);
  assert.equal(a.totals.notReceivedClaims, 1);
  assert.equal(a.rateBase, 'orders');
  assert.equal(a.returnRate, 50); // 4 of 8 orders

  const dl = a.byPartner.find((x) => x.name === 'Delhivery');
  assert.equal(dl.orders, 4);
  assert.equal(dl.returns, 3);
  assert.equal(dl.rto, 2);
  assert.equal(dl.returnRate, 75);
  const pin = a.byPincode.find((x) => x.name === '560001');
  assert.equal(pin.orders, 4);
  assert.equal(pin.returns, 1);
  assert.equal(pin.returnRate, 25);
  assert.equal(pin.city, 'Bengaluru');

  assert.equal(a.suspicious.length, 1);
  const raj = a.suspicious[0];
  assert.equal(raj.name, 'Raj');
  assert.equal(raj.orders, 4);
  assert.equal(raj.rto, 2);
  assert.equal(raj.claims, 1);
  assert.equal(raj.phone, '91xxxxxx11');
  assert.equal(raj.phoneFull, '9111111111');
  assert.ok(raj.reasons.some((x) => /RTO/.test(x)));

  const repeatNames = a.repeatCustomers.map((x) => x.name).sort();
  assert.deepEqual(repeatNames, ['Anu', 'Raj']);
  assert.equal(a.repeatCustomers.find((x) => x.name === 'Anu').returns, 0);
  assert.ok(a.byCondition.some((x) => x.name === 'Damaged' && x.count === 1));
});

test('return analytics without order data: counts from returns, rate from packed videos', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  const sue = login(rt, 'sue@example.com');
  for (let i = 0; i < 4; i++) rt.sheets.get('OrderLog').rows.push(forwardRow('F-' + i));
  rt.sheets.get('ReturnLog').rows.push(returnRow('F-0'));
  rt.sheets.get('ReturnLog').rows.push(returnRow('F-1'));
  rt.call('saveReturnDetails', { token: pat, orderId: 'F-0', platform: 'D2C', returnType: 'RTO', customerPhone: '9444444444', pincode: '700001' });
  rt.call('saveReturnDetails', { token: pat, orderId: 'F-1', platform: 'D2C', returnType: 'RTO', customerPhone: '9444444444', pincode: '700001' });
  const a = rt.call('getReturnAnalytics', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(a.success, true, a.error);
  assert.equal(a.orderData.available, false);
  assert.equal(a.rateBase, 'packed');
  assert.equal(a.returnRate, 50);
  assert.equal(a.byPincode[0].name, '700001');
  assert.equal(a.byPincode[0].returnRate, null);
  assert.equal(a.suspicious.length, 1, 'two RTOs for one phone');
  assert.equal(a.repeatCustomers.length, 1);
});

test('return analytics by Shopify tag and payment mode, with a tag filter', () => {
  const rt = createRuntime({ users: users() });
  const pat = login(rt, 'pat@example.com');
  const sue = login(rt, 'sue@example.com');
  const now = new Date();
  const rows = [['Synced At', 'Order ID', 'Order Date', 'Payment Mode', 'Tags', 'Customer Phone']];
  rows.push([now, '#OD-1', now, 'COD', 'AiSensy_COD_Confirmed', '9000000001']);
  rows.push([now, '#OD-2', now, 'COD', 'AiSensy_COD_Confirmed, Source: Google', '9000000002']);
  rows.push([now, '#OD-3', now, 'COD', 'AiSensy_COD_Cancelled', '9000000003']);
  rows.push([now, '#OD-4', now, 'Prepaid', 'Source: Facebook', '9000000004']);
  rows.push([now, '#OD-5', now, 'Prepaid', '', '9000000005']);
  rt.addSheet('ShopifyOrders', rows);
  ['#OD-1', '#OD-2', '#OD-4', '#OD-5'].forEach((o) => rt.sheets.get('OrderLog').rows.push(forwardRow(o)));
  rt.sheets.get('ReturnLog').rows.push(returnRow('#OD-2'));
  rt.call('saveReturnDetails', { token: pat, orderId: '#OD-2', platform: 'D2C', returnType: 'RTO' });
  rt.sheets.get('ReturnLog').rows.push(returnRow('#OD-4'));

  const a = rt.call('getReturnAnalytics', { token: sue, fromDate: today(), toDate: today() });
  assert.equal(a.success, true, a.error);
  assert.equal(a.orderData.hasTags, true);
  const t = (n) => a.byTag.find((x) => x.name === n);
  assert.deepEqual([t('AiSensy (all)').orders, t('AiSensy (all)').packed, t('AiSensy (all)').returns, t('AiSensy (all)').rto], [3, 2, 1, 1]);
  assert.equal(t('AiSensy (all)').returnRate, 50); // 1 of 2 packed
  assert.deepEqual([t('AiSensy_COD_Confirmed').orders, t('AiSensy_COD_Confirmed').returns], [2, 1]);
  assert.equal(t('AiSensy_COD_Cancelled').packed, 0);
  assert.equal(t('Source: Facebook').returns, 1);
  assert.equal(t('No tag').orders, 1);
  assert.ok(a.tags.includes('AiSensy (all)') && a.tags.includes('AiSensy_COD_Confirmed'));
  const cod = a.byPayment.find((x) => x.name === 'COD');
  assert.deepEqual([cod.orders, cod.returns], [3, 1]);

  const f = rt.call('getReturnAnalytics', { token: sue, fromDate: today(), toDate: today(), tag: 'AiSensy*' });
  assert.equal(f.totals.returns, 1);
  assert.equal(f.totals.ordersInData, 3);
  assert.equal(f.totals.forwardPacked, 2);
  const g = rt.call('getReturnAnalytics', { token: sue, fromDate: today(), toDate: today(), tag: 'Source: Facebook' });
  assert.equal(g.totals.returns, 1);
  assert.equal(g.recent[0].orderId, '#OD-4');
});
