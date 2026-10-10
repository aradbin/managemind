// Creates or updates the PR's single preview comment.
//
//   tsx preview/comment.ts --pr 12 --status deployed|failed|removed \
//     [--api-url U] [--storefront-url U] [--database D] [--smoke passed|failed]
import { parseArgs, prNumber, requireEnv } from '../lib/actions';
import { apiClient } from '../lib/http';

const MARKER = '<!-- managemind-preview -->';
const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const repo = requireEnv('GITHUB_REPOSITORY');
const github = apiClient('https://api.github.com', requireEnv('GITHUB_TOKEN'), 'GitHub');
const run = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
const commit = (process.env.COMMIT_SHA ?? '').slice(0, 7);

const body = [
  MARKER,
  '### Preview',
  '',
  ...lines(args.get('status')),
  '',
  `[Workflow run](${run})`,
].join('\n');

const comments = await github.request<{ id: number; body?: string }[]>(
  'GET',
  `/repos/${repo}/issues/${pr}/comments?per_page=100`,
);
const existing = comments.find((c) => c.body?.includes(MARKER));
if (existing)
  await github.request('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
else await github.request('POST', `/repos/${repo}/issues/${pr}/comments`, { body });

function lines(status: string | undefined): string[] {
  if (status === 'removed')
    return ['Removed: the PR is closed, so its preview Workers and database are deleted.'];
  if (status === 'failed')
    return [`The preview for \`${commit}\` failed to deploy. See the workflow run.`];
  if (status !== 'deployed') throw new Error('--status deployed|failed|removed is required');
  const storefront = args.get('storefront-url') ?? '';
  const api = args.get('api-url') ?? '';
  const smoke = args.get('smoke') === 'passed' ? 'passed' : 'failed';
  return [
    `Deployed \`${commit}\`. Smoke test: **${smoke}**.`,
    '',
    '| | URL |',
    '| --- | --- |',
    `| Storefront (demo-fashion, en) | ${storefront}/?store=demo-fashion |`,
    `| Storefront (demo-grocery, bn) | ${storefront}/?store=demo-grocery |`,
    `| Admin | ${api}/admin/ |`,
    `| API health | ${api}/health |`,
    '',
    `Database: ${args.get('database') ?? 'shared preview branch'}.`,
  ];
}
