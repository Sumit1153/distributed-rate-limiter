#!/usr/bin/env node
/** Demonstrate a shared global quota across two independently running gateways. */
import { randomUUID } from 'node:crypto';
const a = process.env.GATEWAY_A || 'http://127.0.0.1:8080';
const b = process.env.GATEWAY_B || 'http://127.0.0.1:8081';
async function main() {
  const config = await fetch(`${a}/api/config`).then((r) => r.json());
  if (!config.demoSwitch) throw new Error('Enable local demo mode on both gateways for the shared client identity');
  const id = `multi-${randomUUID().slice(0, 12)}`;
  const requests = await Promise.all(Array.from({ length: config.capacity + 8 }, (_, i) => fetch((i % 2 ? a : b) + '/api/work?algorithm=token_bucket', { headers: { 'x-demo-client-id': id } })));
  const statuses = requests.map((r) => r.status);
  const modes = [...new Set(requests.map((r) => r.headers.get('x-ratelimit-mode')))];
  const allowed = statuses.filter((s) => s === 200).length;
  const blocked = statuses.filter((s) => s === 429).length;
  console.log({ allowed, blocked, modes, gatewayA: a, gatewayB: b });
  if (modes.length !== 1 || modes[0] !== 'redis') throw new Error('Expected Redis-backed decisions on both gateways. Check Redis connection.');
  if (allowed !== config.capacity || blocked !== requests.length - config.capacity) throw new Error('Global capacity not enforced across gateways.');
  console.log('PASS: Both gateways share one atomic Redis quota.');
}
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exitCode = 1; });
