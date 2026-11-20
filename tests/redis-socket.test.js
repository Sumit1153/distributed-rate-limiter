import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { RedisRespClient } from '../src/redis/resp.js';
import { RedisLimiterStore } from '../src/redis/store.js';

async function mockRedis(run, responder = () => '+PONG\r\n') {
  const server = net.createServer((socket) => socket.on('data', (data) => socket.write(responder(data.toString('utf8')))));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `redis://127.0.0.1:${server.address().port}`;
  try { await run(url); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('real TCP socket exchanges RESP PING with a mock Redis server', async () => {
  await mockRedis(async (url) => {
    const client = new RedisRespClient({ url, timeoutMs: 300 });
    try { assert.equal(await client.ping(), 'PONG'); }
    finally { client.close(); }
  });
});
test('Redis store converts array reply to limiter decision', async () => {
  await mockRedis(async (url) => {
    const store = new RedisLimiterStore({ url, timeoutMs: 300 });
    try {
      const result = await store.check({ key: 'rl:k', algorithm: 'token_bucket', capacity: 3, windowMs: 1000 });
      assert.deepEqual(result, { allowed: true, remaining: 2, retryMs: 0, resetMs: 1000 });
    } finally { store.close(); }
  }, () => '*4\r\n:1\r\n:2\r\n:0\r\n:1000\r\n');
});
test('unavailable Redis port rejects within configured timeout', async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server,'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const client = new RedisRespClient({ url: `redis://127.0.0.1:${port}`, timeoutMs: 200 });
  await assert.rejects(client.ping());
  client.close();
});
