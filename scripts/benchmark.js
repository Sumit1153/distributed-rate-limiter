#!/usr/bin/env node
/** Benchmark actual HTTP calls; results are measurements, not preset numbers. */
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const url = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const perAlgorithm = Math.max(1, Math.min(200, Number(process.argv[2] || 30)));
const concurrency = Math.max(1, Math.min(100, Number(process.argv[3] || 20)));

function percentile(values, fraction) {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.max(0, Math.ceil(a.length * fraction) - 1)] || 0;
}

async function runAlgorithm(algorithm) {
  const runId = randomUUID().slice(0, 8);
  const results = [];
  const start = performance.now();
  for (let begin = 0; begin < perAlgorithm; begin += concurrency) {
    const n = Math.min(concurrency, perAlgorithm - begin);
    const batch = await Promise.all(Array.from({ length: n }, async () => {
      const at = performance.now();
      const endpoint = `${url}/api/work?algorithm=${algorithm}`;
      try {
        const response = await fetch(endpoint, { headers: { 'x-demo-client-id': `bench-${algorithm}-${runId}` }, signal: AbortSignal.timeout(5000) });
        return { status: response.status, mode: response.headers.get('x-ratelimit-mode'), ms: performance.now() - at, selected: response.headers.get('x-ratelimit-algorithm') };
      } catch (error) { return { status: 0, mode: 'network-error', ms: performance.now() - at, error: error.message }; }
    }));
    results.push(...batch);
  }
  if (results.some((r) => r.selected !== algorithm)) throw new Error('Algorithm override disabled. Set ALLOW_DEMO_ALGORITHM_SWITCH=true in your local Docker Compose lab.');
  const durationMs = performance.now() - start;
  return { algorithm, requests: results.length, allowed: results.filter((r) => r.status === 200).length, blocked: results.filter((r) => r.status === 429).length, errors: results.filter((r) => ![200, 429].includes(r.status)).length, fallback: results.filter((r) => r.mode === 'memory-fallback').length, throughputRps: Math.round(results.length / (durationMs / 1000) * 10) / 10, p50Ms: Math.round(percentile(results.map((r) => r.ms), .5)*10)/10, p95Ms: Math.round(percentile(results.map((r) => r.ms), .95)*10)/10 };
}

async function main() {
  const cfg = await fetch(`${url}/api/config`).then((r) => r.json());
  if (!cfg.demoSwitch) throw new Error('Benchmark requires demo switch enabled. Use local Docker Compose; never expose it publicly.');
  const output = [];
  for (const algorithm of cfg.algorithms) output.push(await runAlgorithm(algorithm));
  console.table(output);
  await mkdir('results', { recursive: true });
  await writeFile('results/benchmark.json', JSON.stringify({ generatedAt: new Date().toISOString(), gatewayUrl: url, capacity: cfg.capacity, windowMs: cfg.windowMs, perAlgorithm, concurrency, results: output }, null, 2) + '\n');
  console.log('Wrote results/benchmark.json (ignored by Git). Do not claim measurements you have not run.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
