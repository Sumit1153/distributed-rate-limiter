import { createHash } from 'node:crypto';
import { MemoryLimiter } from './algorithms/memory.js';
import { ALGORITHMS } from './config.js';
import { RedisCommandError } from './redis/resp.js';

export function selectAlgorithm(raw, config) {
  // Production defaults cannot be overridden by a user-supplied query string.
  if (!config.allowDemoSwitch) return config.algorithm;
  const requested = raw || config.algorithm;
  if (!ALGORITHMS.includes(requested)) throw new Error(`Invalid demo algorithm: ${requested}`);
  return requested;
}

export function identityFromRequest(req, allowDemoSwitch = false) {
  // The demo identifier is purposefully untrusted and disabled by default.
  const demo = allowDemoSwitch ? req.headers['x-demo-client-id'] : null;
  if (demo && (typeof demo !== 'string' || !/^[\w-]{1,64}$/.test(demo))) {
    throw new Error('Invalid x-demo-client-id');
  }
  const source = demo ? `demo:${demo}` : `ip:${req.socket.remoteAddress || 'unknown'}`;
  return createHash('sha256').update(source).digest('hex').slice(0, 32);
}

export class RateLimiter {
  constructor({ store, memory = new MemoryLimiter(), logger = console } = {}) {
    this.store = store;
    this.memory = memory;
    this.logger = logger;
    this.lastMode = 'not-checked';
    this.failures = 0;
  }

  async check(args) {
    if (!this.store) return { ...this.memory.check(args), mode: 'memory-fallback' };
    try {
      const result = await this.store.check(args);
      this.lastMode = 'redis';
      return { ...result, mode: 'redis' };
    } catch (error) {
      // A Lua/validation error is a server bug, not a Redis outage. Don't hide it.
      if (error instanceof RedisCommandError) throw error;
      this.failures++;
      if (this.lastMode !== 'memory-fallback') this.logger.warn?.(`Redis unavailable; using per-instance memory fallback: ${error.message}`);
      this.lastMode = 'memory-fallback';
      return { ...this.memory.check(args), mode: 'memory-fallback' };
    }
  }
}
