import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCommand, parseReply, RedisCommandError } from '../src/redis/resp.js';
import { LUA } from '../src/algorithms/lua.js';

test('encodes EVAL with byte-correct bulk lengths', () => {
  assert.equal(encodeCommand(['PING']).toString(), '*1\r\n$4\r\nPING\r\n');
  assert.equal(encodeCommand(['SET','x','café']).toString(), '*3\r\n$3\r\nSET\r\n$1\r\nx\r\n$5\r\ncafé\r\n');
});
test('parses simple response', () => assert.deepEqual(parseReply(Buffer.from('+PONG\r\n')).value, 'PONG'));
test('parses integer', () => assert.deepEqual(parseReply(Buffer.from(':123\r\n')).value, 123));
test('parses nil bulk', () => assert.equal(parseReply(Buffer.from('$-1\r\n')).value, null));
test('parses binary-safe bulk', () => assert.equal(parseReply(Buffer.from('$5\r\ncafé\r\n')).value, 'café'));
test('parses array', () => assert.deepEqual(parseReply(Buffer.from('*4\r\n:1\r\n:4\r\n:0\r\n:250\r\n')).value, [1,4,0,250]));
test('waits for incomplete array', () => assert.equal(parseReply(Buffer.from('*2\r\n:1\r\n')), null));
test('reports redis errors separately', () => assert.ok(parseReply(Buffer.from('-ERR bad script\r\n')).value instanceof RedisCommandError));
test('rejects invalid RESP', () => assert.throws(() => parseReply(Buffer.from('?oh\r\n'))));
for (const [name, script] of Object.entries(LUA)) {
  test(`${name} Lua uses server TIME and atomic Redis writes`, () => {
    assert.ok(script.includes("redis.call('TIME')"));
    assert.ok(script.includes('KEYS[1]'));
    assert.ok(script.includes("redis.call('PEXPIRE'"));
  });
}
