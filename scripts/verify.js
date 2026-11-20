#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
const base = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
async function run() {
  const config = await fetch(`${base}/api/config`).then((r) => r.json());
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  const unique = `verify-${randomUUID().slice(0, 12)}`;
  const requests = await Promise.all(Array.from({ length: config.capacity + 5 }, () => fetch(`${base}/api/work`, { headers: config.demoSwitch ? { 'x-demo-client-id': unique } : {} })));
  const statuses = requests.map((r) => r.status);
  const modes = [...new Set(requests.map((r) => r.headers.get('x-ratelimit-mode')))];
  const counts = { allowed: statuses.filter((s) => s === 200).length, blocked: statuses.filter((s) => s === 429).length, others: statuses.filter((s) => ![200, 429].includes(s)).length };
  console.log(JSON.stringify({ config, health, ...counts, modes }, null, 2));
  if (counts.others) throw new Error('Some requests returned unexpected statuses');
  if (!counts.blocked) throw new Error('Expected at least one HTTP 429; check limit and concurrent traffic');
  console.log('PASS: Gateway returns HTTP 200 and rate-limited HTTP 429 under a burst.');
}
run().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
