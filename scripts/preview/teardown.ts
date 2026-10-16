// Deletes a PR's preview resources. Never touches the shared database.
//
//   tsx preview/teardown.ts --pr 12                 # PR closed: everything
//   tsx preview/teardown.ts --pr 12 --database-only # db-branch label removed
import { notice, parseArgs, prNumber, requireEnv } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { Neon } from '../lib/neon';
import {
  apiWorker,
  branchName,
  hyperdriveName,
  importDeadLetters,
  importQueue,
  storefrontWorker,
} from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const neon = new Neon(requireEnv('NEON_API_KEY'), requireEnv('NEON_PROJECT_ID'));
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));

if (!args.has('database-only')) {
  // The storefront binds to the API, so it goes first. Cloudflare won't
  // delete a Worker that consumes a queue, nor a queue a Worker still binds:
  // so the import queues' consumers are detached, then the API Worker
  // deleted, then the queues.
  const queues = [importQueue(pr), importDeadLetters(pr)];
  await cf.deleteWorker(storefrontWorker(pr));
  for (const queue of queues) await cf.detachQueueConsumers(queue);
  await cf.deleteWorker(apiWorker(pr));
  notice(`Deleted Workers ${storefrontWorker(pr)} and ${apiWorker(pr)}`);
  for (const queue of queues) {
    if (await cf.deleteQueue(queue)) notice(`Deleted queue ${queue}`);
  }
}

const config = await cf.findHyperdrive(hyperdriveName(pr, 'own'));
if (config) await cf.deleteHyperdrive(config.id);
const branches = (await neon.branches()).filter((b) => b.name === branchName(pr, 'own'));
for (const b of branches) await neon.deleteBranch(b.id);
if (config || branches.length)
  notice(`Deleted the PR's database (Neon branch ${branchName(pr, 'own')})`);
