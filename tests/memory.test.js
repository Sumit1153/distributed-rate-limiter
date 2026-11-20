import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLimiter } from '../src/algorithms/memory.js';

for (const algorithm of ['token_bucket', 'fixed_window', 'sliding_window', 'leaky_bucket']) {
  test(`${algorithm}: accepts up to configured capacity then blocks`, () => {
    let at = 1000;
    const limiter = new MemoryLimiter({ now: () => at });
    const args = { algorithm, key: 'user', capacity: 3, windowMs: 1000 };
    for (let i = 0; i < 3; i++) assert.equal(limiter.check(args).allowed, true);
    const blocked = limiter.check(args);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryMs > 0);
  });
  test(`${algorithm}: recovers capacity after a full window`, () => {
    let at = 2000;
    const limiter = new MemoryLimiter({ now: () => at });
    const args = { algorithm, key: 'user', capacity: 2, windowMs: 1000 };
    limiter.check(args); limiter.check(args);
    assert.equal(limiter.check(args).allowed, false);
    at += 1001;
    assert.equal(limiter.check(args).allowed, true);
  });
  test(`${algorithm}: clients are independent`, () => {
    const limiter = new MemoryLimiter({ now: () => 1000 });
    const opts = { algorithm, capacity: 1, windowMs: 1000 };
    assert.equal(limiter.check({ ...opts, key: 'alice' }).allowed, true);
    assert.equal(limiter.check({ ...opts, key: 'alice' }).allowed, false);
    assert.equal(limiter.check({ ...opts, key: 'bob' }).allowed, true);
  });
}

test('token bucket: partial refill permits one token but not two', () => {
  let t = 0;
  const l = new MemoryLimiter({ now: () => t });
  const args = { algorithm: 'token_bucket', key: 'k', capacity: 2, windowMs: 2000 };
  l.check(args); l.check(args);
  t = 1000;
  assert.equal(l.check(args).allowed, true);
  assert.equal(l.check(args).allowed, false);
});
test('sliding window: oldest request expires out of rolling interval', () => {
  let t = 1000;
  const l = new MemoryLimiter({ now: () => t });
  const args = { algorithm: 'sliding_window', key: 'k', capacity: 2, windowMs: 1000 };
  l.check(args);
  t = 1500;
  l.check(args);
  t = 2001;
  assert.equal(l.check(args).allowed, true);
  assert.equal(l.check(args).allowed, false);
});
test('fixed window: reset at exact boundary', () => {
  let t = 999;
  const l = new MemoryLimiter({ now: () => t });
  const args = { algorithm: 'fixed_window', key: 'k', capacity: 1, windowMs: 1000 };
  assert.equal(l.check(args).allowed, true);
  t = 1000;
  assert.equal(l.check(args).allowed, true);
});
test('memory fallback bounds entries', () => {
  const l = new MemoryLimiter({ now: () => 0, maxEntries: 4 });
  for (let i = 0; i < 100; i++) l.check({ key: String(i), algorithm: 'token_bucket', capacity: 1, windowMs: 1000 });
  assert.ok(l.entries.size <= 4);
});
test('memory fallback sweeps expired entries', () => {
  let t = 0;
  const l = new MemoryLimiter({ now: () => t });
  l.check({ key: 'old', algorithm: 'token_bucket', capacity: 1, windowMs: 100 });
  t = 201;
  l.sweep();
  assert.equal(l.entries.size, 0);
});
test('memory fallback rejects unknown algorithm', () => {
  const l = new MemoryLimiter();
  assert.throws(() => l.check({ algorithm: 'unknown', key: 'k', capacity: 1, windowMs: 1000 }));
});
