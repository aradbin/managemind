// Uploads source maps to Sentry, matched to the deployed code by debug IDs.
// Runs after the builds and before the deploys, because injecting the debug
// IDs changes the files that are deployed.
//
//   tsx production/sourcemaps.ts --release <sha>
//
// Expects the builds with SENTRY_SOURCEMAPS=1 and the API's dry-run bundle in
// apps/api/dist/worker. Without SENTRY_AUTH_TOKEN it skips the upload.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notice, parseArgs } from '../lib/actions';
import { type SentryApp, sentry } from '../lib/sentry';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const release = parseArgs(process.argv.slice(2)).get('release');
if (!release) throw new Error('--release <sha> is required');

if (!process.env.SENTRY_AUTH_TOKEN) {
  notice('SENTRY_AUTH_TOKEN is not set: source maps are not uploaded');
  process.exit(0);
}

const builds: [SentryApp, string][] = [
  ['api', 'apps/api/dist/worker'],
  ['storefront', 'apps/storefront/dist/server'],
  ['admin', 'apps/admin/dist'],
];

const cli = (args: string[]) => execFileSync('sentry-cli', args, { stdio: 'inherit' });

for (const [app, dir] of builds) {
  const path = join(root, dir);
  cli(['sourcemaps', 'inject', path]);
  cli([
    'sourcemaps',
    'upload',
    '--org',
    sentry.org,
    '--project',
    sentry.projects[app].slug,
    '--release',
    release,
    path,
  ]);
}
