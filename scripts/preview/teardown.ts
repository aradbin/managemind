// Deletes a PR's preview resources. On the shared database it only drops the
// PR's own login role (ADR 0011, amended Oct 23).
//
//   tsx preview/teardown.ts --pr 12                 # PR closed: everything
//   tsx preview/teardown.ts --pr 12 --database-only # db-branch label removed
import pg from 'pg';
import { mask, notice, parseArgs, prNumber, requireEnv } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { Neon } from '../lib/neon';
import {
  apiWorker,
  branchName,
  directRole,
  hyperdriveName,
  importDeadLetters,
  importQueue,
  outboxQueue,
  storefrontWorker,
} from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const neon = new Neon(requireEnv('NEON_API_KEY'), requireEnv('NEON_PROJECT_ID'));
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));

if (!args.has('database-only')) {
  // The storefront binds to the API, so it goes first. Cloudflare won't
  // delete a Worker that consumes a queue, nor a queue a Worker still binds:
  // so the queues' consumers are detached, then the API Worker deleted,
  // then the queues.
  const queues = [outboxQueue(pr), importQueue(pr), importDeadLetters(pr)];
  await cf.deleteWorker(storefrontWorker(pr));
  for (const queue of queues) await cf.detachQueueConsumers(queue);
  await cf.deleteWorker(apiWorker(pr));
  notice(`Deleted Workers ${storefrontWorker(pr)} and ${apiWorker(pr)}`);
  for (const queue of queues) {
    if (await cf.deleteQueue(queue)) notice(`Deleted queue ${queue}`);
  }
  await dropSharedRole();
}

const config = await cf.findHyperdrive(hyperdriveName(pr, 'own'));
if (config) await cf.deleteHyperdrive(config.id);
const branches = (await neon.branches()).filter((b) => b.name === branchName(pr, 'own'));
for (const b of branches) await neon.deleteBranch(b.id);
if (config || branches.length)
  notice(`Deleted the PR's database (Neon branch ${branchName(pr, 'own')})`);

/** Drops the PR's login role on the shared branch, which has nothing else of the PR's. */
async function dropSharedRole(): Promise<void> {
  const shared = await neon.findBranch(branchName(pr, 'shared'));
  if (!shared) return;
  const url = await neon.ownerUri(shared.id);
  mask(url);
  mask(new URL(url).password);
  const owner = new pg.Client({ connectionString: url });
  await owner.connect();
  try {
    // Sessions still open as the role (the pooler's) would make the drop
    // fail; ending them is best effort.
    await owner
      .query('select pg_terminate_backend(pid) from pg_stat_activity where usename = $1', [
        directRole(pr),
      ])
      .catch(() => undefined);
    await owner.query(`drop role if exists ${directRole(pr)}`);
    notice(`Dropped role ${directRole(pr)} on the shared branch`);
  } finally {
    await owner.end();
  }
}
