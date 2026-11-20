import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectAlgorithm, identityFromRequest } from './limiter.js';
import { ALGORITHMS } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');

export function makeMetrics() {
  return { total: 0, allowed: 0, blocked: 0, fallback: 0, upstreamErrors: 0, latencies: [] };
}

function sendJSON(res, status, obj, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function statSnapshot(m) {
  const sorted = [...m.latencies].sort((a,b) => a-b);
  const pct = (x) => sorted.length ? sorted[Math.ceil(sorted.length * x) - 1] : 0;
  return { requests: m.total, allowed: m.allowed, blocked: m.blocked, fallbackRequests: m.fallback, upstreamErrors: m.upstreamErrors, p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99) };
}

export function createGateway({ config, limiter, fetchImpl = fetch, metrics = makeMetrics(), now = () => performance.now() }) {
  return http.createServer(async (req, res) => {
    const started = now();
    const done = () => {
      if (!req.url?.startsWith('/api/work')) return;
      metrics.latencies.push(Math.max(0, Math.round((now() - started) * 10)/10));
      if (metrics.latencies.length > 10000) metrics.latencies.shift();
    };
    res.once('finish', done);
    const base = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'GET' && (base.pathname === '/' || base.pathname === '/styles.css' || base.pathname === '/app.js')) {
        const filename = base.pathname === '/' ? 'index.html' : base.pathname.slice(1);
        const mime = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'application/javascript' : 'text/html';
        res.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'x-content-type-options': 'nosniff' });
        res.end(await readFile(join(PUBLIC, filename)));
        return;
      }
      if (req.method === 'GET' && base.pathname === '/api/health') {
        sendJSON(res, 200, { status: 'ok', redisMode: limiter.lastMode, redisFailures: limiter.failures });
        return;
      }
      if (req.method === 'GET' && base.pathname === '/api/config') {
        sendJSON(res, 200, { algorithm: config.algorithm, algorithms: ALGORITHMS, capacity: config.capacity, windowMs: config.windowMs, demoSwitch: config.allowDemoSwitch, memoryFallback: true });
        return;
      }
      if (req.method === 'GET' && base.pathname === '/api/metrics') {
        sendJSON(res, 200, statSnapshot(metrics));
        return;
      }
      if (req.method !== 'GET' || base.pathname !== '/api/work') {
        sendJSON(res, 404, { error: 'Not found', routes: ['GET /', 'GET /api/work', 'GET /api/config', 'GET /api/metrics', 'GET /api/health'] });
        return;
      }
      let algorithm;
      let identity;
      try {
        algorithm = selectAlgorithm(base.searchParams.get('algorithm'), config);
        identity = identityFromRequest(req, config.allowDemoSwitch);
      } catch (error) { sendJSON(res, 400, { error: error.message }); return; }

      metrics.total++;
      const decision = await limiter.check({ key: `rl:v1:${algorithm}:${identity}`, algorithm, capacity: config.capacity, windowMs: config.windowMs });
      const headers = {
        'ratelimit-limit': String(config.capacity),
        'ratelimit-remaining': String(Math.max(0, decision.remaining)),
        'ratelimit-reset': String(Math.ceil(decision.resetMs / 1000)),
        'x-ratelimit-algorithm': algorithm,
        'x-ratelimit-mode': decision.mode,
        'x-content-type-options': 'nosniff'
      };
      if (decision.mode === 'memory-fallback') {
        metrics.fallback++;
        headers.warning = '199 - "Redis unavailable; per-instance rate limiting"';
      }
      if (!decision.allowed) {
        metrics.blocked++;
        headers['retry-after'] = String(Math.max(1, Math.ceil(decision.retryMs / 1000)));
        sendJSON(res, 429, { error: 'Too Many Requests', retryAfterMs: decision.retryMs, algorithm, mode: decision.mode }, headers);
        return;
      }
      metrics.allowed++;
      try {
        const upstream = await fetchImpl(new URL('/work', config.backendUrl), { signal: AbortSignal.timeout(3000), headers: { 'x-request-id': cryptoRandomID() } });
        const body = await upstream.text();
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', ...headers });
        res.end(body);
      } catch (error) {
        metrics.upstreamErrors++;
        sendJSON(res, 502, { error: 'Backend unavailable', detail: 'The upstream service could not be reached' }, headers);
      }
    } catch (error) {
      if (!res.headersSent) sendJSON(res, 500, { error: 'Gateway internal error' });
    }
  });
}

import { randomUUID as cryptoRandomID } from 'node:crypto';
