// Ensures the preview database for a PR and prints its Hyperdrive config ID.
//
//   tsx preview/database.ts --pr 12 --database shared|own [--skip-migrations]
//
// 1. Finds or creates the Neon branch (from production). A new branch gets a
//    fresh owner password, so production's never reaches a preview.
// 2. Applies the migrations and the demo seed as the owner role, unless
//    --skip-migrations (a PR changing migrations must not migrate the shared
//    branch ahead of master).
// 3. Creates the mm_app login role in app_rw and a Hyperdrive config for it if
//    the config does not exist yet. The password is generated here and stored
//    only in the role and the Hyperdrive config.
import { runMigrations } from '@managemind/db/migrate';
import { seed } from '@managemind/db/seed';
import pg from 'pg';
import { mask, notice, parseArgs, prNumber, requireEnv, setOutput } from '../lib/actions';
import { APP_ROLE, newPassword, setAppRole } from '../lib/app-role';
import { Cloudflare } from '../lib/cloudflare';
import { type Branch, DATABASE, Neon } from '../lib/neon';
import { branchName, DATABASE_LOCK, hyperdriveName, parseDatabase } from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const database = parseDatabase(args.get('database'));
const neon = new Neon(requireEnv('NEON_API_KEY'), requireEnv('NEON_PROJECT_ID'));
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));

const name = branchName(pr, database);
const configName = hyperdriveName(pr, database);

let fresh = false;
let branch = await neon.findBranch(name);
if (!branch) {
  branch = await createBranch(name);
  fresh = true;
  await neon.resetOwnerPassword(branch.id);
  // A config left from an earlier branch of this name points at a deleted host.
  const stale = await cf.findHyperdrive(configName);
  if (stale) await cf.deleteHyperdrive(stale.id);
  notice(`Created Neon branch ${name}`);
}

const ownerUrl = await neon.ownerUri(branch.id);
mask(ownerUrl);
mask(new URL(ownerUrl).password);

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
try {
  await owner.query('select pg_advisory_lock($1)', [DATABASE_LOCK]);
  if (args.has('skip-migrations') && !fresh) {
    notice(
      `This PR changes migrations: the shared preview database was not migrated. Add the db-branch label for a database with them.`,
    );
  } else {
    await runMigrations(ownerUrl);
    await seed(ownerUrl);
  }

  let config = await cf.findHyperdrive(configName);
  if (!config) {
    const password = newPassword();
    await setAppRole(owner, password);
    config = await cf.createHyperdrive(configName, {
      host: await neon.host(branch.id),
      database: DATABASE,
      user: APP_ROLE,
      password,
    });
    notice(`Created Hyperdrive config ${configName}`);
  }
  setOutput('hyperdrive_id', config.id);
  setOutput('branch', name);
} finally {
  await owner.end();
}

/** Creates the branch; if two runs raced, keeps the oldest and deletes the rest. */
async function createBranch(branch: string): Promise<Branch> {
  await neon.createBranch(branch);
  const all = (await neon.branches())
    .filter((b) => b.name === branch)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [keep, ...extra] = all;
  if (!keep) throw new Error(`Neon branch ${branch} vanished after creation`);
  for (const b of extra) await neon.deleteBranch(b.id);
  return keep;
}
