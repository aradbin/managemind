#!/usr/bin/env node
// Bundle-size check for the deployable Workers (ADR 0004). Runs
// `wrangler deploy --dry-run` in each app and reads wrangler's own
// "Total Upload: … / gzip: …" line, which is the compressed size Cloudflare
// enforces (3 MiB on the Workers Free plan). Warns at 2.5 MiB and fails at
// 3 MiB. Build the apps first: the API serves the admin's dist as assets.
//
// apps/admin is checked differently (phase-1-plan §7.3): the JavaScript a
// phone downloads before the sign-in screen (the entry, the sign-in route's
// chunk and their static imports), gzipped, at most 150 KiB.
//
// Usage: node scripts/bundle-size.mjs apps/api apps/storefront apps/admin
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

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

const ADMIN_WARN_KIB = 130;
const ADMIN_FAIL_KIB = 150;
let admin = null;

/**
 * Gzipped size of the JavaScript a phone downloads before the sign-in screen
 * shows: the entry, the sign-in route's lazy chunk, and everything either
 * imports statically, read from Vite's build manifest.
 */
function adminInitialJs(app) {
  const dist = resolve(app, 'dist');
  const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
  const roots = ['index.html', 'src/routes/sign-in.tsx?tsr-split=component'];
  const files = new Set();
  const visit = (key) => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`${app}: ${key} is not in the build manifest`);
    if (files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  for (const root of roots) visit(root);
  return [...files]
    .filter((f) => f.endsWith('.js'))
    .reduce((kib, f) => kib + gzipSync(readFileSync(join(dist, f)), { level: 9 }).length / 1024, 0);
}

for (const app of apps) {
  if (app.replace(/\/$/, '') === 'apps/admin') {
    const gzip = adminInitialJs(app);
    let status = 'ok';
    if (gzip > ADMIN_FAIL_KIB) {
      status = 'over the budget';
      failed = true;
      console.log(
        `::error title=Bundle size::${app} initial JS is ${gzip.toFixed(0)} KiB gzip, over 150 KiB`,
      );
    } else if (gzip > ADMIN_WARN_KIB) {
      status = 'warning';
      console.log(
        `::warning title=Bundle size::${app} initial JS is ${gzip.toFixed(0)} KiB gzip, over 130 KiB`,
      );
    }
    admin = { app, gzip, status };
    continue;
  }
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
  ...(admin
    ? [
        '',
        '| Admin | Sign-in JS (gzip) | Share of 150 KiB | Status |',
        '| --- | --- | --- | --- |',
        `| ${admin.app} | ${admin.gzip.toFixed(0)} KiB | ${((admin.gzip / ADMIN_FAIL_KIB) * 100).toFixed(0)}% | ${admin.status} |`,
      ]
    : []),
].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size (ADR 0004)\n\n${table}\n`);
}
process.exit(failed ? 1 : 0);

function mib(kib) {
  return `${(kib / 1024).toFixed(2)} MiB`;
}
