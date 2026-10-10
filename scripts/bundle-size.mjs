#!/usr/bin/env node
// Bundle-size check for the deployable Workers (ADR 0004). Runs
// `wrangler deploy --dry-run` in each app and reads wrangler's own
// "Total Upload: … / gzip: …" line, which is the compressed size Cloudflare
// enforces (3 MiB on the Workers Free plan). Warns at 2.5 MiB and fails at
// 3 MiB. Build the apps first: the API serves the admin's dist as assets.
//
// Usage: node scripts/bundle-size.mjs apps/api apps/storefront
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WARN_KIB = 2.5 * 1024;
const FAIL_KIB = 3 * 1024;
const LINE = /Total Upload: ([\d.]+) KiB \/ gzip: ([\d.]+) KiB/;

const apps = process.argv.slice(2);
if (apps.length === 0) {
  console.error('usage: node scripts/bundle-size.mjs <app-dir>...');
  process.exit(2);
}

const rows = [];
let failed = false;

for (const app of apps) {
  const outdir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const run = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', outdir], {
    cwd: resolve(app),
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  });
  rmSync(outdir, { recursive: true, force: true });
  const output = `${run.stdout}\n${run.stderr}`;
  const match = LINE.exec(output);
  if (run.status !== 0 || !match) {
    // A wrangler failure or a changed output format must fail, never pass.
    console.error(output);
    console.log(`::error title=Bundle size::${app}: wrangler dry run failed or printed no size`);
    failed = true;
    continue;
  }
  const raw = Number(match[1]);
  const gzip = Number(match[2]);
  let status = 'ok';
  if (gzip >= FAIL_KIB) {
    status = 'over the limit';
    failed = true;
    console.log(`::error title=Bundle size::${app} is ${mib(gzip)} gzip, at or over 3 MiB`);
  } else if (gzip >= WARN_KIB) {
    status = 'warning';
    console.log(`::warning title=Bundle size::${app} is ${mib(gzip)} gzip, over 2.5 MiB`);
  }
  rows.push({ app, raw, gzip, status });
}

const table = [
  '| Worker | Upload | Gzip | Share of 3 MiB | Status |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.app} | ${r.raw.toFixed(0)} KiB | ${r.gzip.toFixed(0)} KiB | ${((r.gzip / FAIL_KIB) * 100).toFixed(0)}% | ${r.status} |`,
  ),
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size (ADR 0004)\n\n${table}\n`);
}
process.exit(failed ? 1 : 0);

function mib(kib) {
  return `${(kib / 1024).toFixed(2)} MiB`;
}
