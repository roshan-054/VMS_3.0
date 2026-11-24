import test from 'node:test';
import assert from 'node:assert/strict';
import { getStationServerInfo, hasStationServer, _resetStationServerCache } from '../src/lib/serverFeatures.ts';

const realFetch = globalThis.fetch;
function mockFetch(impl: (url: string) => Promise<Response>) {
  let calls = 0;
  (globalThis as any).fetch = (url: string) => { calls++; return impl(url); };
  return () => calls;
}

test.afterEach(() => { (globalThis as any).fetch = realFetch; _resetStationServerCache(); });

test('GitHub Pages 404 page means no station server', async () => {
  mockFetch(async () => new Response('<!DOCTYPE html><title>404</title>', { status: 404 }));
  assert.equal(await hasStationServer(), false);
});

test('an HTML 200 (SPA fallback) is not mistaken for the server', async () => {
  mockFetch(async () => new Response('<!doctype html><div id="root"></div>', { status: 200 }));
  assert.equal(await hasStationServer(), false);
});

test('network failure means no station server', async () => {
  mockFetch(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(await hasStationServer(), false);
});

test('server.ts health response is detected', async () => {
  mockFetch(async () => Response.json({ status: 'ok', stationServer: true }));
  assert.deepEqual(await getStationServerInfo(), { available: true });
});

test('result is cached: one probe for many callers', async () => {
  const calls = mockFetch(async () => new Response('nope', { status: 404 }));
  await Promise.all([hasStationServer(), hasStationServer(), hasStationServer()]);
  await hasStationServer();
  assert.equal(calls(), 1);
});
