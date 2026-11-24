// Recording size and bitrate rules for "Highest quality". Run with: npm run test:web
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockedRecordingSize, bitrateForSize } from '../src/lib/recordingPipeline.ts';

test('default cap keeps 1080p and below unchanged, scales 4K down to 1080p', () => {
  assert.deepEqual(lockedRecordingSize(1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(lockedRecordingSize(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(lockedRecordingSize(3840, 2160), { width: 1920, height: 1080 });
});

test('4K cap keeps the camera full resolution, including portrait and 4:3', () => {
  assert.deepEqual(lockedRecordingSize(3840, 2160, 3840, 2160), { width: 3840, height: 2160 });
  assert.deepEqual(lockedRecordingSize(2160, 3840, 3840, 2160), { width: 2160, height: 3840 });
  assert.deepEqual(lockedRecordingSize(2592, 1944, 3840, 2160), { width: 2592, height: 1944 });
  assert.deepEqual(lockedRecordingSize(1080, 1920), { width: 1080, height: 1920 });
});

test('bitrate follows the size: ~7.5 Mbps at 1080p, capped at 25 Mbps for 4K', () => {
  assert.equal(bitrateForSize(1920, 1080), 7464960);
  assert.ok(bitrateForSize(1280, 720) > 3_000_000 && bitrateForSize(1280, 720) < 3_500_000);
  assert.equal(bitrateForSize(3840, 2160), 25_000_000);
  assert.equal(bitrateForSize(320, 240), 2_500_000);
});
