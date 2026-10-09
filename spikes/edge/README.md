# Spike: edge state on the free plan (ADR 0006)

Throwaway Worker checking, on the Workers Free plan: the rate-limiting binding, a SQLite-backed Durable Object counter, Queues (no delay, `delaySeconds` up to 1800, retries, a dead-letter queue) and a Cron Trigger. Deleted after Phase 1.

```sh
wrangler queues create managemind-spike-edge
wrangler queues create managemind-spike-edge-dlq
pnpm --filter @managemind/spike-edge deploy
```

| Path (needs `?k=<SPIKE_TOKEN>`) | Purpose |
| --- | --- |
| `/rl?key=<k>` | One call to the rate-limiting binding (limit 5 per 60 s) |
| `/do?key=<k>` | One hit on the Durable Object counter (limit 5 per 60 s) |
| `/q?delay=<s>[&fail=1]` | Send a queue message; `fail=1` makes the consumer retry it until it is dead-lettered |

The consumer logs each delivery with its lag and attempt number; read them from Workers Logs.
