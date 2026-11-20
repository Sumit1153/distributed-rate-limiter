/** A per-process fallback. It deliberately does not pretend to enforce global limits. */
export class MemoryLimiter {
  constructor({ now = () => Date.now(), sweepEvery = 300, maxEntries = 30000 } = {}) {
    this.now = now;
    this.entries = new Map();
    this.calls = 0;
    this.sweepEvery = sweepEvery;
    this.maxEntries = maxEntries;
  }

  check({ key, algorithm, capacity, windowMs }) {
    const now = this.now();
    this.calls++;
    if (this.calls % this.sweepEvery === 0) this.sweep(now);
    // Bound memory if very large numbers of unique clients connect during an outage.
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.sweep(now);
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    }
    let state = this.entries.get(key);
    if (!state || state.expires <= now) state = { tokens: capacity, ts: now, count: 0, times: [], water: 0, expires: now + 2 * windowMs };
    let allowed = false;
    let remaining = 0;
    let retryMs = 0;
    let resetMs = 0;
    const rate = capacity / windowMs;

    if (algorithm === 'token_bucket') {
      state.tokens = Math.min(capacity, state.tokens + Math.max(0, now - state.ts) * rate);
      state.ts = now;
      allowed = state.tokens >= 1 - 1e-9;
      if (allowed) state.tokens -= 1;
      remaining = Math.floor(Math.max(0, state.tokens));
      retryMs = allowed ? 0 : Math.ceil((1 - state.tokens) / rate);
      resetMs = Math.ceil((capacity - state.tokens) / rate);
    } else if (algorithm === 'fixed_window') {
      const slot = Math.floor(now / windowMs);
      if (state.slot !== slot) { state.slot = slot; state.count = 0; }
      allowed = state.count < capacity;
      if (allowed) state.count++;
      remaining = Math.max(0, capacity - state.count);
      resetMs = (slot + 1) * windowMs - now;
      retryMs = allowed ? 0 : resetMs;
    } else if (algorithm === 'sliding_window') {
      state.times = state.times.filter((time) => time > now - windowMs);
      allowed = state.times.length < capacity;
      if (allowed) state.times.push(now);
      remaining = capacity - state.times.length;
      resetMs = state.times.length ? Math.max(0, state.times[0] + windowMs - now) : 0;
      retryMs = allowed ? 0 : resetMs;
    } else if (algorithm === 'leaky_bucket') {
      state.water = Math.max(0, state.water - Math.max(0, now - state.ts) * rate);
      state.ts = now;
      allowed = state.water + 1 <= capacity + 1e-9;
      if (allowed) state.water += 1;
      remaining = Math.floor(Math.max(0, capacity - state.water));
      retryMs = allowed ? 0 : Math.ceil((state.water + 1 - capacity) / rate);
      resetMs = Math.ceil(state.water / rate);
    } else throw new Error(`Unknown algorithm: ${algorithm}`);

    state.expires = now + 2 * windowMs;
    this.entries.set(key, state);
    return { allowed, remaining, retryMs: Math.max(0, retryMs), resetMs: Math.max(0, resetMs) };
  }

  sweep(now = this.now()) {
    for (const [key, state] of this.entries) if (state.expires <= now) this.entries.delete(key);
  }
}
