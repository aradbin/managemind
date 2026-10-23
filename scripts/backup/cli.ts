// The backup workflows' steps (phase-5b-plan §3.14, ADR 0028):
//   tsx backup/cli.ts upload --file <dump.age>     nightly: to backups/daily/, Sundays also weekly/
//   tsx backup/cli.ts latest --out <dump.age>      the newest daily copy
//   tsx backup/cli.ts branch create|delete         the monthly test's Neon branch
//   tsx backup/cli.ts check --restored <url>       the restore checks against production
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dhakaDate } from '@managemind/shared/billing';
import pg from 'pg';
import { mask, notice, parseArgs, requireEnv, setOutput, summary } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { Neon } from '../lib/neon';
import { checkRestore } from './checks';

const BRANCH = 'restore-test';
const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(command === 'branch' ? rest.slice(1) : rest);
const bucket = process.env.R2_BUCKET || 'managemind-files';
const cloudflare = () =>
  new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const neon = () => new Neon(requireEnv('NEON_API_KEY'), requireEnv('NEON_PROJECT_ID'));
const MiB = (n: number) => `${(n / 2 ** 20).toFixed(1)} MiB`;

async function connect(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

switch (command) {
  case 'upload': {
    const file = args.get('file') ?? '';
    const body = new Uint8Array(readFileSync(file));
    const sha256 = createHash('sha256').update(body).digest('hex');
    const now = new Date();
    const day = dhakaDate(now);
    const cf = cloudflare();
    const keys = [`backups/daily/${day}.dump.age`];
    // Sunday in Dhaka also keeps a weekly copy (the bucket keeps 4 of those).
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 0) keys.push(`backups/weekly/${day}.dump.age`);
    for (const key of keys) await cf.r2Put(bucket, key, body, 'application/octet-stream');
    summary(
      `### Backup ${day}\n\n| Copy | Size | SHA-256 |\n| --- | --- | --- |\n${keys
        .map((k) => `| \`${k}\` | ${MiB(body.byteLength)} | \`${sha256}\` |`)
        .join('\n')}`,
    );
    notice(`backup ${day}: ${MiB(body.byteLength)}, sha256 ${sha256}`);
    break;
  }
  case 'latest': {
    const cf = cloudflare();
    const keys: string[] = [];
    for await (const o of cf.r2List(bucket, 'backups/daily/')) keys.push(o.key);
    const key = keys.sort().at(-1);
    if (!key) throw new Error('no daily backup in R2');
    const body = await cf.r2Get(bucket, key);
    if (!body) throw new Error(`${key} could not be read`);
    writeFileSync(args.get('out') ?? 'latest.dump.age', body);
    summary(`Restoring \`${key}\` (${MiB(body.byteLength)}).`);
    setOutput('key', key);
    break;
  }
  case 'branch': {
    const n = neon();
    const existing = await n.findBranch(BRANCH);
    if (existing) await n.deleteBranch(existing.id);
    if (rest[0] === 'delete') break;
    // A branch of production, with an empty database on it to restore into.
    const branch = await n.createBranch(BRANCH);
    await n.resetOwnerPassword(branch.id);
    const owner = await n.ownerUri(branch.id);
    mask(owner);
    const client = await connect(owner);
    await client.query('create database restore_check');
    await client.end();
    const target = new URL(owner);
    target.pathname = '/restore_check';
    mask(target.toString());
    setOutput('url', target.toString());
    break;
  }
  case 'check': {
    const source = await connect(requireEnv('DATABASE_URL_MIGRATIONS'));
    const restored = await connect(args.get('restored') ?? '');
    try {
      const report = await checkRestore(source, restored);
      summary(
        `### Restore test\n\n- Tables: ${report.tables}\n- Rows: ${report.rows.restored} restored, ${report.rows.source} in production\n- Newest order: ${report.newestOrderHours === null ? 'none' : `${report.newestOrderHours} hours old`}\n- Result: ${report.ok ? 'passed' : `**failed**: ${report.problems.join('; ')}`}`,
      );
      if (!report.ok) process.exitCode = 1;
    } finally {
      await Promise.all([source.end(), restored.end()]);
    }
    break;
  }
  default:
    throw new Error(`unknown command ${command}: upload, latest, branch create|delete, check`);
}
