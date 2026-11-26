// Live station status: the admin view counts exactly like the packer's Upload Queue page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { queueCounts } from '../src/lib/queueCounts';
import { mergeStationReports } from '../src/lib/supabase/stations';

const item = (status: string, extra: Record<string, unknown> = {}) => ({ id: Math.random().toString(36), status, ...extra }) as any;

test('queueCounts matches the Upload Queue page', () => {
  const q = [
    ...Array.from({ length: 10 }, () => item('pending')),
    item('uploading'), item('uploading'),
    item('failed', { error: 'Network lost' }), item('paused'),
    item('failed', { error: 'Duplicate order ID' }),
    item('completed'),
  ];
  const c = queueCounts(q);
  assert.deepEqual(c, { waiting: 10, uploading: 2, failed: 3, duplicate: 1, completed: 1, total: 16 });
  // The page's "Pending / Uploading" tab = waiting + uploading.
  assert.equal(c.waiting + c.uploading, q.filter((i) => i.status === 'pending' || i.status === 'uploading').length);
});

test('newest report per station wins when both sources have one', () => {
  const m = mergeStationReports(
    [{ email: 'a@x', reportedAt: 200, n: 'sb' }, { email: 'b@x', reportedAt: 100, n: 'sb' }] as any[],
    [{ email: 'A@x', reportedAt: 100, n: 'gas' }, { email: 'b@x', reportedAt: 300, n: 'gas' }] as any[],
  );
  assert.deepEqual(m.map((x: any) => x.n), ['sb', 'gas']);
});
