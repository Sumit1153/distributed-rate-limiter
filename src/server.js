import { loadConfig } from './config.js';
import { loadDotEnv } from './env.js';
import { RedisLimiterStore } from './redis/store.js';
import { RateLimiter } from './limiter.js';
import { createGateway } from './gateway.js';

loadDotEnv();
const config = loadConfig();
const store = new RedisLimiterStore({ url: config.redisUrl, timeoutMs: config.redisTimeoutMs });
const limiter = new RateLimiter({ store });
const server = createGateway({ config, limiter });
server.listen(config.port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Gateway ready: http://localhost:${config.port}`);
  console.log(`Algorithm: ${config.algorithm} | limit: ${config.capacity}/${config.windowMs}ms | Redis: ${config.redisUrl}`);
});
function shutdown() {
  server.close();
  store.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
