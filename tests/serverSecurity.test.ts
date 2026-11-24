import test from 'node:test';
import assert from 'node:assert/strict';
import { isDriveUploadUrl } from '../serverSecurity.ts';

test('accepts a real Drive resumable session URL', () => {
  assert.equal(isDriveUploadUrl('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&upload_id=ADPycdt-abc_123'), true);
});

test('rejects anything else (SSRF)', () => {
  for (const u of [
    'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://evil.example.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com.evil.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com:8443/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://user:pw@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    'http://169.254.169.254/computeMetadata/v1/',
    'http://localhost:3000/api/health',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    assert.equal(isDriveUploadUrl(u), false, u);
  }
});
