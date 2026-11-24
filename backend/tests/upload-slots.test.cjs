'use strict';
// Several stations can upload at the same time; extra stations wait for a free slot.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createRuntime } = require('./gas-harness.cjs');
const { fakeDrive } = require('./fake-drive.cjs');

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const PACKERS = [1, 2, 3, 4, 5, 6].map((i) => [new Date(), `Packer ${i}`, `p${i}@example.com`, sha('PackerPass1'), 'User', 'Approved']);

function setup() {
  const rt = createRuntime({ users: PACKERS.map((r) => r.slice()) });
  const drive = fakeDrive();
  rt.sandbox.DriveApp = drive;
  drive.add('1DonGlWoJtRc30fsSi7zHjE5G5xlDPiLA', 'Default Videos');
  const tokens = PACKERS.map((r) => rt.call('login', { email: r[2], password: 'PackerPass1' }).token);
  const start = (i, order) => rt.call('startUpload', {
    token: tokens[i], orderId: order, platform: 'Amazon', recordingType: 'Forward', fileName: `${order}.mp4`,
    fileSize: 1000, recordingDate: '2026-11-24', totalChunks: 1,
  });
  return { rt, start, tokens };
}

test('four stations upload at once; the fifth waits for a free slot', () => {
  const { start } = setup();
  for (let i = 0; i < 4; i++) {
    const r = start(i, `ORD-${i}`);
    assert.equal(r.success, true, r.error);
    assert.ok(r.uploadId && !r.queuedInCloud, `station ${i + 1} should start right away`);
  }
  const fifth = start(4, 'ORD-4');
  assert.equal(fifth.queuedInCloud, true);
  assert.match(fifth.message, /All 4 upload slots are busy/);
});

test('releasing a slot lets the waiting station start', () => {
  const { rt, start, tokens } = setup();
  const ids = [0, 1, 2, 3].map((i) => start(i, `ORD-${i}`).uploadId);
  assert.equal(start(4, 'ORD-4').queuedInCloud, true);
  rt.call('releaseUploadSlot', { token: tokens[0], uploadId: ids[0] });
  const again = start(4, 'ORD-4');
  assert.ok(again.uploadId && !again.queuedInCloud);
});

test('a stalled upload frees its slot after 25 s without a heartbeat', () => {
  const { rt, start } = setup();
  [0, 1, 2, 3].forEach((i) => start(i, `ORD-${i}`));
  const slots = JSON.parse(rt.props.get('ACTIVE_UPLOAD_SLOTS'));
  const first = Object.keys(slots)[0];
  slots[first].lastHeartbeatAt = Date.now() - 30000;
  rt.props.set('ACTIVE_UPLOAD_SLOTS', JSON.stringify(slots));
  const r = start(4, 'ORD-4');
  assert.ok(r.uploadId && !r.queuedInCloud);
});

test('the limit can be changed with the MAX_PARALLEL_UPLOADS script property', () => {
  const { rt, start } = setup();
  rt.props.set('MAX_PARALLEL_UPLOADS', '1');
  assert.ok(start(0, 'ORD-0').uploadId);
  assert.equal(start(1, 'ORD-1').queuedInCloud, true);
});
