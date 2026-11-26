// Scan & Record: the platform comes from the order ID, never a default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatformFromOrderId as d } from '../src/lib/platformDetect.ts';

test('D2C order IDs', () => {
  for (const v of ['#OD-10063', 'OD-10063', '##OD-10063', ' # OD-10063 ', 'od-9844', 'D2C-1', '123456789012']) assert.equal(d(v), 'D2C', v);
});
test('Amazon order IDs', () => {
  for (const v of ['405-9801142-6317130', '408-4499450-3209959', 'AMZ-1', ' 404-6434071-1160340 ']) assert.equal(d(v), 'Amazon', v);
});
test('JioMart order IDs', () => {
  assert.equal(d('JM-55'), 'JioMart');
});
test('unknown formats are not guessed', () => {
  for (const v of ['', 'ABC123', 'ORDER-CCC-3003', '12345']) assert.equal(d(v), null, v);
});
