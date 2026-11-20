# Verification guide — produce evidence before making claims

## Automated local tests

```powershell
npm test
```

These validate JavaScript algorithm behavior, HTTP routes, concurrent memory-fallback requests, simulated Redis outage/recovery, and RESP2 protocol behavior. **They do not execute Lua against a live Redis server.**

## Live Redis test with Docker Desktop

In a terminal within the project folder:

```powershell
docker compose up -d --build
docker compose ps
node scripts/verify.js
```

Look for a successful `PASS`, mixed `200/429` responses, and an `x-ratelimit-mode` of `redis`. If the mode says fallback, Redis is not being reached; investigate `docker compose logs gateway redis`.

## Failure injection

```powershell
docker compose stop redis
node scripts/verify.js
```

Expected: gateway stays up and serves `200`/`429`, decisions show `memory-fallback`. Then recover:

```powershell
docker compose start redis
node scripts/verify.js
```

Expected: responses return to mode `redis`. The two modes **do not preserve one global count through an outage**, so never claim exact distributed enforcement during failure.

## Verify two gateway instances share Redis

Start a second gateway on port 8081 (in a separate terminal):

```powershell
docker compose run --rm --no-deps -p 127.0.0.1:8081:8080 gateway
```

In the first terminal:

```powershell
node scripts/verify-distributed.js
```

Both instances should report `redis`; requests distributed across them must share the same token bucket. Stop the second temporary gateway with `Ctrl+C`.

## Benchmark

```powershell
node scripts/benchmark.js 30 20
```

Collects 30 calls per algorithm at a concurrency of 20 and writes a timestamped `results/benchmark.json`. It reports measured request outcomes, throughput, p50 and p95 latency. Numbers vary by computer and configuration; the benchmark compares different behaviors, not a universal ranking. It is only allowed when demo switching is explicitly enabled.

## Evidence checklist for GitHub

- [ ] `npm test` passes locally
- [ ] `docker compose ps` shows all services running
- [ ] `node scripts/verify.js` returns `redis` mode and 429 responses
- [ ] Redis stop → fallback verified; Redis start → recovery verified
- [ ] Optionally verify two-gateway shared quota
- [ ] Save real benchmark JSON or screenshots (redact sensitive paths, secrets) for your README

## Troubleshooting

- **`docker` not recognized:** Start Docker Desktop, close and reopen the VS Code terminal, then retry.
- **Port 8080 in use:** Stop the old process or edit host-side port mapping in `compose.yaml`.
- **Red Redis indicator:** Check `docker compose logs redis gateway`. Use `docker compose ps` to check that the database is healthy.
- **Only fallback results:** Redis may be unreachable; the app is correctly protecting availability but is not exercising distributed admission.
- **Browser shows Google search:** Paste `http://127.0.0.1:8080` into the browser address bar **without asterisks or quotes**.
- **Cannot switch algorithms in local non-Docker mode:** Set `ALLOW_DEMO_ALGORITHM_SWITCH=true` for a local-only lab; leave it `false` for anything public.
