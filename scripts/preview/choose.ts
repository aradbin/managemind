// Chooses what the preview runs (scope.ts) and sets the step outputs
// deploy, full, hyperdrive and describe.
//
//   tsx preview/choose.ts --base origin/master [--full-label]
import { execFileSync } from 'node:child_process';
import { notice, parseArgs, requireEnv, setOutput, warning } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { previewScope, utcDayStart } from './scope';

const args = parseArgs(process.argv.slice(2));
const base = args.get('base');
if (!base) throw new Error('--base <ref> is required');
const fullLabel = args.get('full-label') === 'true';

const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

let queriesToday: number | null = null;
if (fullLabel) {
  const cf = new Cloudflare(
    requireEnv('CLOUDFLARE_API_TOKEN'),
    requireEnv('CLOUDFLARE_ACCOUNT_ID'),
  );
  const now = new Date();
  try {
    const data = await cf.analytics<{
      viewer: { accounts: { hyperdrive: { count: number }[] }[] };
    }>(
      `query($acct: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $acct}) {
    hyperdrive: hyperdriveQueriesAdaptiveGroups(limit: 1, filter: {datetime_geq: $since, datetime_leq: $until}) { count }
  } } }`,
      { since: utcDayStart(now).toISOString(), until: now.toISOString() },
    );
    queriesToday = data.viewer.accounts[0]?.hyperdrive[0]?.count ?? 0;
  } catch (e) {
    warning(`Hyperdrive usage unavailable: ${(e as Error).message}`);
  }
}

const scope = previewScope({ files, fullLabel, queriesToday });
notice(scope.describe);
setOutput('deploy', String(scope.deploy));
setOutput('full', String(scope.full));
setOutput('hyperdrive', String(scope.hyperdrive));
setOutput('describe', scope.describe);
