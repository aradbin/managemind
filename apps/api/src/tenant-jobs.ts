// Store jobs in the API (phase-5b-plan §3.9, §3.10): starting the
// tenant-jobs workflow, the export's signed link and its download, and the
// owners' email when an export is ready. The jobs themselves run in GitHub
// Actions (scripts/jobs); the Worker only queues them and serves the file.
import { type OpenAPIHono, z } from '@hono/zod-openapi';
import { exportExpiry, getJob, type TenantJob } from '@managemind/core';
import { createDb } from '@managemind/db';
import { exportReadyEmail } from '@managemind/providers/email';
import { isUuid } from '@managemind/shared';
import { createMailer } from './auth/email';
import { withClient } from './db';
import { type AppEnv, type Env, getConfig } from './env';
import { log } from './log';

const WORKFLOW = 'tenant-jobs.yml';

/** A job as the platform screen and Settings show it. */
export const Job = z
  .object({
    id: z.uuid(),
    kind: z.enum(['export', 'purge', 'reset']),
    status: z.enum(['pending', 'running', 'succeeded', 'failed']),
    progress: z.record(z.string(), z.unknown()),
    error: z.string().nullable(),
    attempts: z.number().int(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    createdAt: z.date(),
    /** A finished export's signed link, until it expires. */
    downloadUrl: z.string().nullable(),
    expiresAt: z.date().nullable(),
  })
  .openapi('TenantJob');

/**
 * Starts the tenant-jobs workflow after the response, in production only:
 * the workflow works on the production database. Without the token, or
 * when GitHub doesn't answer, the workflow's daily run picks the job up.
 */
export function dispatchJobs(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): void {
  const config = getConfig(env);
  if (config.ENVIRONMENT !== 'production' || !env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) {
    return;
  }
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`;
  ctx.waitUntil(
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'managemind-api',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'master' }),
    })
      .then((res) => {
        if (!res.ok) log('warn', 'jobs dispatch refused', { status: res.status });
      })
      .catch((e) => log('warn', 'jobs dispatch failed', { error: String(e) })),
  );
}

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`managemind exports\0${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The signed download link for an export, valid until `expires` (§3.10). */
export async function exportUrl(env: Env, jobId: string, expires: Date): Promise<string> {
  const config = getConfig(env);
  const exp = Math.floor(expires.getTime() / 1000);
  const token = base64url(await hmac(config.AUTH_SECRET, `${jobId}.${exp}`));
  const host = config.ADMIN_HOST ?? 'localhost';
  return `https://${host}/v1/exports/${jobId}?expires=${exp}&token=${token}`;
}

/** Checks a link's token in constant time, and that it hasn't expired. */
export async function exportTokenValid(
  env: Env,
  jobId: string,
  expires: string,
  token: string,
  now = Date.now(),
): Promise<boolean> {
  const exp = Number(expires);
  if (!Number.isInteger(exp) || exp * 1000 < now) return false;
  const expected = base64url(await hmac(getConfig(env).AUTH_SECRET, `${jobId}.${exp}`));
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** GET /v1/exports/{job}: streams the zip from R2 to whoever holds the link. */
export function registerExports(app: OpenAPIHono<AppEnv>): void {
  app.get('/v1/exports/:id', async (c) => {
    const id = c.req.param('id');
    const expires = c.req.query('expires') ?? '';
    const token = c.req.query('token') ?? '';
    const gone = () => c.text('This link has expired or is not valid.', 404);
    if (!isUuid(id) || !(await exportTokenValid(c.env, id, expires, token))) return gone();
    const job = await withClient(c.env, c.executionCtx, (client) =>
      getJob({ db: createDb(client) }, id),
    );
    if (job?.kind !== 'export' || job.status !== 'succeeded' || !job.fileKey) return gone();
    const object = await c.env.FILES.get(job.fileKey);
    if (!object) return gone();
    log('info', 'export downloaded', { tenant_id: job.tenantId, job_id: id });
    return new Response(object.body, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(object.size),
        'content-disposition': `attachment; filename="${job.fileKey.split('/').pop() ?? 'export.zip'}"`,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    });
  });
}

/** `tenant.exported`: each owner gets the link, in their language. */
export async function exportEmails(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  event: { tenantId: string; payload: unknown },
): Promise<void> {
  const { jobId, expiresAt } = event.payload as { jobId: string; expiresAt: string };
  const config = getConfig(env);
  const expires = new Date(expiresAt);
  if (expires.getTime() < Date.now()) return;
  const link = await exportUrl(env, jobId, expires);
  await withClient(env, ctx, async (client) => {
    const owners = await client.query<{ email: string; locale: 'bn' | 'en'; store: string }>(
      `select u.email, u.locale, t.name as store
         from platform.memberships m join platform.users u on u.id = m.user_id
         join platform.tenants t on t.id = m.tenant_id
        where m.tenant_id = $1 and m.role = 'owner'`,
      [event.tenantId],
    );
    const mailer = createMailer(env, config, ctx);
    for (const owner of owners.rows) {
      mailer.sendLater(
        {
          to: owner.email,
          ...exportReadyEmail({
            locale: owner.locale,
            platformName: config.PLATFORM_NAME,
            storeName: owner.store,
            link,
            expires,
          }),
        },
        'export_ready',
      );
    }
  });
}

/**
 * A job as the platform screen and Settings show it, with a finished
 * export's link for those who may download the store's data: its owners and
 * super admins, never support staff, who see a store's data only through a
 * granted support session.
 */
export async function jobOut(env: Env, job: TenantJob, withLink: boolean) {
  const expiresAt =
    withLink && job.kind === 'export' && job.status === 'succeeded' && job.finishedAt
      ? exportExpiry(job.finishedAt)
      : null;
  const live = expiresAt && expiresAt.getTime() > Date.now() ? expiresAt : null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: (job.progress ?? {}) as Record<string, unknown>,
    error: job.error,
    attempts: job.attempts,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    downloadUrl: live ? await exportUrl(env, job.id, live) : null,
    expiresAt: live,
  };
}
