import { randomUUID } from 'node:crypto';
import { LUA } from '../algorithms/lua.js';
import { RedisRespClient } from './resp.js';

export class RedisLimiterStore {
  constructor({ url, timeoutMs } = {}) {
    this.client = new RedisRespClient({ url, timeoutMs });
  }
  async check({ key, algorithm, capacity, windowMs }) {
    const source = LUA[algorithm];
    if (!source) throw new Error(`Unsupported algorithm: ${algorithm}`);
    const result = await this.client.query(['EVAL', source, 1, key, capacity, windowMs, randomUUID()]);
    if (!Array.isArray(result) || result.length !== 4 || result.some((n) => typeof n !== 'number')) {
      throw new Error('Unexpected Redis script response');
    }
    const [allowed, remaining, retryMs, resetMs] = result;
    return { allowed: allowed === 1, remaining, retryMs, resetMs };
  }
  async ping() { return this.client.ping(); }
  close() { this.client.close(); }
}
