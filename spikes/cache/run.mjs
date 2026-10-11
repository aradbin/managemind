// Runs the ADR 0007 experiments against the deployed spike Worker.
// From a Claude Code cloud session: NODE_USE_ENV_PROXY=1 node run.mjs <step>
// (the proxy adds the Cloudflare token). Elsewhere, set CLOUDFLARE_API_TOKEN.
// SPIKE_TOKEN must match the Worker's secret for the version steps.

const ZONE = 'managemind.site';
const A = 'https://spike-cache.managemind.site';
const B = 'https://spike-cache-b.managemind.site';
const CF = 'https://api.cloudflare.com/client/v4';
const headers = {
  'user-agent': 'managemind-spike',
  'content-type': 'application/json',
  ...(process.env.CLOUDFLARE_API_TOKEN
    ? { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
    : {}),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function zoneId() {
  const r = await fetch(`${CF}/zones?name=${ZONE}`, { headers }).then((r) => r.json());
  return r.result[0].id;
}

async function get(url) {
  const t = Date.now();
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  await r.arrayBuffer();
  return {
    cache: r.headers.get('x-cache'),
    colo: r.headers.get('x-colo'),
    version: r.headers.get('x-version'),
    ms: Date.now() - t,
  };
}

async function purge(zone, body) {
  const t = Date.now();
  const r = await fetch(`${CF}/zones/${zone}/purge_cache`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return {
    status: r.status,
    ok: j.success,
    errors: j.errors,
    retryAfter: r.headers.get('retry-after'),
    ms: Date.now() - t,
  };
}

// Polls until the URL misses; returns ms from the end of the purge call.
async function untilMiss(url, max = 60_000) {
  const t = Date.now();
  for (let n = 1; Date.now() - t < max; n++) {
    const r = await get(url);
    if (r.cache === 'MISS') return { afterMs: Date.now() - t, polls: n, colo: r.colo };
    await sleep(250);
  }
  return { afterMs: null };
}

async function warm(urls) {
  for (const u of urls) await get(u);
  const out = {};
  for (const u of urls) out[u] = (await get(u)).cache;
  return out;
}

const steps = {
  // Purge by tag, hostname, prefix and URL, each checking what stays cached.
  async purges() {
    const zone = await zoneId();
    const a1 = `${A}/t/store-a/p/1`;
    const a2 = `${A}/t/store-a/p/2`;
    const b1 = `${B}/t/store-b/p/1`;
    const cases = [
      ['tag product', { tags: ['tenant:store-a:product:1'] }, a1, [a2, b1]],
      ['tag store', { tags: ['tenant:store-a'] }, a2, [b1]],
      ['hostname', { hosts: ['spike-cache-b.managemind.site'] }, b1, [a1]],
      ['prefix', { prefixes: ['spike-cache.managemind.site/t/store-a/'] }, a1, [b1]],
      ['url', { files: [a2] }, a2, [a1, b1]],
    ];
    for (const [name, body, target, untouched] of cases) {
      console.log(name, 'warm', await warm([target, ...untouched]));
      const p = await purge(zone, body);
      const miss = await untilMiss(target);
      const others = {};
      for (const u of untouched) others[u] = (await get(u)).cache;
      console.log(name, JSON.stringify({ purge: p, miss, untouched: others }));
      // Refill what the poll left behind.
      await warm([target, ...untouched]);
    }
  },

  // How many tags one purge call accepts.
  async manyTags() {
    const zone = await zoneId();
    for (const n of [30, 100, 101]) {
      const tags = Array.from({ length: n }, (_, i) => `tenant:bulk:product:${i}`);
      console.log(n, 'tags', JSON.stringify(await purge(zone, { tags })));
    }
  },

  // Free plan: 5 a minute, bucket of 25 (per account). Fire 30 back to back,
  // then one every 12 s for a minute.
  async rateLimit() {
    const zone = await zoneId();
    const results = [];
    for (let i = 1; i <= 30; i++) {
      const p = await purge(zone, { tags: [`rl-probe-${i}`] });
      results.push(`${i}:${p.status}${p.retryAfter ? `(retry-after ${p.retryAfter})` : ''}`);
    }
    console.log('burst', results.join(' '));
    for (let i = 1; i <= 6; i++) {
      await sleep(12_000);
      const p = await purge(zone, { tags: [`rl-refill-${i}`] });
      console.log('refill', i, p.status, JSON.stringify(p.errors));
    }
  },

  // Fallback: catalog version in KV, bumped by the Worker.
  async version() {
    const ttl = process.argv[3] ?? '60';
    const u = `${A}/v/store-a/p/1?ttl=${ttl}`;
    const other = `${A}/v/store-c/p/1?ttl=${ttl}`;
    console.log('warm', await warm([u, other]), (await get(u)).version);
    const t = Date.now();
    const bump = await fetch(`${A}/bump/store-a?k=${process.env.SPIKE_TOKEN}`, {
      method: 'POST',
    }).then((r) => r.json());
    for (;;) {
      const r = await get(u);
      if (r.version === bump.version) {
        console.log(
          JSON.stringify({
            ttl,
            bump,
            visibleAfterMs: Date.now() - t,
            cache: r.cache,
            colo: r.colo,
          }),
        );
        break;
      }
      if (Date.now() - t > 120_000) {
        console.log('not visible after 120 s');
        break;
      }
      await sleep(500);
    }
    console.log('other store', await get(other));
  },
};

await steps[process.argv[2]]();
