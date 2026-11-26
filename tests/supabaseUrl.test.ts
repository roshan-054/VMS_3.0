// Settings > Supabase: the Project URL is accepted in the forms people paste, in the browser and in Code.gs alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizeSupabaseUrl } from '../src/lib/supabase/client';

const require = createRequire(import.meta.url);
const { createRuntime } = require('../backend/tests/gas-harness.cjs');

const GOOD = 'https://abcdefghijklmnopqrst.supabase.co';
const CASES: [string, string][] = [
  [GOOD, GOOD],
  ['  https://abcdefghijklmnopqrst.supabase.co/  ', GOOD],
  ['abcdefghijklmnopqrst.supabase.co', GOOD],
  ['http://abcdefghijklmnopqrst.supabase.co', GOOD],
  ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/', GOOD],
  ['"https://ABCDEFGHIJKLMNOPQRST.supabase.co"', GOOD],
  ['https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api', GOOD],
  ['abcdefghijklmnopqrst', GOOD],
  ['https://abcdefghijklmnopqrst.supabase.co:443/', GOOD],
  ['', ''],
  ['not a url', ''],
];

test('Project URL forms are cleaned up in the browser', () => {
  for (const [input, want] of CASES) assert.equal(normalizeSupabaseUrl(input), want, input);
});

test('Code.gs cleans up the Project URL the same way', () => {
  const rt = createRuntime();
  const fn = rt.sandbox.sbNormalizeUrl_;
  assert.equal(typeof fn, 'function');
  for (const [input, want] of CASES) assert.equal(fn(input), want, input);
});
