import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ALGORITHMS } from '../src/config.js';
import { identityFromRequest, selectAlgorithm, RateLimiter } from '../src/limiter.js';
import { RedisCommandError } from '../src/redis/resp.js';

test('defaults use token bucket and enforce non-demo algorithm lock', () => {
  const c = loadConfig({});
  assert.equal(c.algorithm, 'token_bucket');
  assert.equal(c.allowDemoSwitch, false);
  assert.equal(selectAlgorithm('sliding_window', c), 'token_bucket');
});
test('all four algorithms are available', () => assert.deepEqual(ALGORITHMS, ['token_bucket','fixed_window','sliding_window','leaky_bucket']));
test('demo enables per-algorithm selection', () => {
  const c = loadConfig({ ALLOW_DEMO_ALGORITHM_SWITCH: 'true' });
  assert.equal(selectAlgorithm('fixed_window', c), 'fixed_window');
  assert.throws(() => selectAlgorithm('fake', c));
});
test('invalid configuration is rejected', () => {
  for (const props of [{ PORT: 'abcd' }, { RATE_LIMIT_CAPACITY: '-1' }, { RATE_LIMIT_WINDOW_MS: '0' }, { REDIS_URL: 'https://example.com' }, { RATE_LIMIT_ALGORITHM: 'fake' }]) assert.throws(() => loadConfig(props));
});
test('client identity ignores demo headers outside demo mode', () => {
  const base = { socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(identityFromRequest({ ...base, headers: {} }), identityFromRequest({ ...base, headers: { 'x-demo-client-id': 'spoof' } }));
});
test('demo identities are stable and separate', () => {
  const req = (value) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-demo-client-id': value } });
  assert.equal(identityFromRequest(req('alice'), true), identityFromRequest(req('alice'), true));
  assert.notEqual(identityFromRequest(req('alice'), true), identityFromRequest(req('bob'), true));
});
test('invalid demo client ID rejected', () => {
  const req = { socket: {}, headers: { 'x-demo-client-id': 'a/b' } };
  assert.throws(() => identityFromRequest(req, true));
});
test('Redis error triggers memory fallback, then recovers', async () => {
  let broken = true;
  const limiter = new RateLimiter({ store: { check: async () => { if (broken) throw Error('ECONNREFUSED'); return { allowed: true, remaining: 2, retryMs: 0, resetMs: 10 }; } }, logger: { warn(){} } });
  const args = { key: 'x', algorithm: 'token_bucket', capacity: 3, windowMs: 1000 };
  assert.equal((await limiter.check(args)).mode, 'memory-fallback');
  assert.equal(limiter.failures, 1);
  broken = false;
  assert.equal((await limiter.check(args)).mode, 'redis');
});
test('Redis script errors do not silently bypass the limiter', async () => {
  const limiter = new RateLimiter({ store: { check: () => Promise.reject(new RedisCommandError('ERR invalid script')) } });
  await assert.rejects(limiter.check({ key: 'k', algorithm: 'fixed_window', capacity: 1, windowMs: 100 }), RedisCommandError);
});
