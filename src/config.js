export const ALGORITHMS = Object.freeze(['token_bucket', 'fixed_window', 'sliding_window', 'leaky_bucket']);

function intInRange(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid integer configuration: ${value}`);
  return parsed;
}

export function loadConfig(env = process.env) {
  const algorithm = env.RATE_LIMIT_ALGORITHM || 'token_bucket';
  if (!ALGORITHMS.includes(algorithm)) throw new Error(`RATE_LIMIT_ALGORITHM must be one of: ${ALGORITHMS.join(', ')}`);
  const backendUrl = new URL(env.BACKEND_URL || 'http://localhost:3001');
  const redisUrl = new URL(env.REDIS_URL || 'redis://127.0.0.1:6379');
  if (!['http:', 'https:'].includes(backendUrl.protocol)) throw new Error('BACKEND_URL must use http(s)');
  if (redisUrl.protocol !== 'redis:') throw new Error('REDIS_URL must use redis://');
  return Object.freeze({
    port: intInRange(env.PORT, 8080, 1, 65535),
    backendUrl: backendUrl.toString(),
    redisUrl: redisUrl.toString(),
    algorithm,
    capacity: intInRange(env.RATE_LIMIT_CAPACITY, 5, 1, 100000),
    windowMs: intInRange(env.RATE_LIMIT_WINDOW_MS, 10000, 100, 86400000),
    redisTimeoutMs: intInRange(env.REDIS_TIMEOUT_MS, 500, 50, 30000),
    allowDemoSwitch: env.ALLOW_DEMO_ALGORITHM_SWITCH === 'true'
  });
}
