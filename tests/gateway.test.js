import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadConfig } from '../src/config.js';
import { RateLimiter } from '../src/limiter.js';
import { createGateway } from '../src/gateway.js';
import { MemoryLimiter } from '../src/algorithms/memory.js';

async function withServer(cb, { allowDemoSwitch = true, store = null, capacity = 2 } = {}) {
  const config = loadConfig({ ALLOW_DEMO_ALGORITHM_SWITCH: String(allowDemoSwitch), RATE_LIMIT_CAPACITY: String(capacity) });
  const memory = new MemoryLimiter();
  const limiter = new RateLimiter({ store, memory, logger: { warn(){} } });
  const calls = [];
  const server = createGateway({ config, limiter, fetchImpl: async (_url, options) => {
    calls.push(options);
    return new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } });
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await cb({ base, limiter, calls }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('root serves dashboard', () => withServer(async ({base}) => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /LimitLab/);
}));
test('static assets exist', () => withServer(async ({base}) => {
  for (const path of ['/styles.css','/app.js']) assert.equal((await fetch(base+path)).status, 200);
}));
test('config exposes safe nonsecret settings', () => withServer(async ({base}) => {
  const body = await fetch(base+'/api/config').then((r) => r.json());
  assert.equal(body.capacity, 2);
  assert.equal(body.demoSwitch, true);
  assert.equal('redisUrl' in body, false);
}));
test('routes return 404 for unknown paths', () => withServer(async ({base}) => {
  assert.equal((await fetch(base+'/unknown')).status, 404);
}));
test('rate limit allows two then rejects third with 429 and headers', () => withServer(async ({base, calls}) => {
  const headers = { 'x-demo-client-id': 'alice' };
  const first = await fetch(base+'/api/work', { headers });
  const second = await fetch(base+'/api/work', { headers });
  const third = await fetch(base+'/api/work', { headers });
  assert.deepEqual([first.status,second.status,third.status], [200,200,429]);
  assert.equal(third.headers.get('x-ratelimit-mode'), 'memory-fallback');
  assert.equal(third.headers.get('ratelimit-remaining'), '0');
  assert.ok(Number(third.headers.get('retry-after')) >= 1);
  assert.equal(calls.length, 2);
}));
test('concurrent requests cannot bypass in-process fallback limit', () => withServer(async ({base}) => {
  const results = await Promise.all(Array.from({length:50},()=>fetch(base+'/api/work', { headers: { 'x-demo-client-id': 'bob' } })));
  assert.equal(results.filter((r)=>r.status===200).length, 2);
  assert.equal(results.filter((r)=>r.status===429).length, 48);
}));
test('independent clients have different counters in demo mode', () => withServer(async ({base}) => {
  const get = (user) => fetch(base+'/api/work',{headers:{'x-demo-client-id':user}});
  await get('alice'); await get('alice');
  assert.equal((await get('alice')).status, 429);
  assert.equal((await get('bob')).status, 200);
}));
test('switching algorithms works only in demo mode', () => withServer(async ({base}) => {
  const res = await fetch(base+'/api/work?algorithm=sliding_window');
  assert.equal(res.headers.get('x-ratelimit-algorithm'), 'sliding_window');
}));
test('demo switch cannot override production algorithm', () => withServer(async ({base}) => {
  const res = await fetch(base+'/api/work?algorithm=sliding_window');
  assert.equal(res.headers.get('x-ratelimit-algorithm'), 'token_bucket');
}, {allowDemoSwitch:false}));
test('bad demo algorithm yields 400', () => withServer(async ({base}) => {
  assert.equal((await fetch(base+'/api/work?algorithm=bad')).status, 400);
}));
test('bad demo ID yields 400', () => withServer(async ({base}) => {
  assert.equal((await fetch(base+'/api/work', {headers:{'x-demo-client-id':'bad/id'}})).status, 400);
}));
test('metrics count requests and blocks', () => withServer(async ({base}) => {
  await fetch(base+'/api/work'); await fetch(base+'/api/work'); await fetch(base+'/api/work');
  const m = await fetch(base+'/api/metrics').then((r)=>r.json());
  assert.deepEqual([m.requests,m.allowed,m.blocked,m.fallbackRequests],[3,2,1,3]);
}));
test('Redis shared-store mode shows redis header', () => withServer(async ({base}) => {
  const res = await fetch(base+'/api/work');
  assert.equal(res.headers.get('x-ratelimit-mode'),'redis');
}, {store:{check:async()=>({allowed:true,remaining:1,retryMs:0,resetMs:100})}}));
test('allowed requests include mode and quota headers', () => withServer(async ({base}) => {
  const response = await fetch(base+'/api/work');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('ratelimit-limit'), '2');
  assert.equal(response.headers.get('x-ratelimit-mode'), 'memory-fallback');
}));
