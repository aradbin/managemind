// A store's provider credentials (phase-5a-plan §3.1, §6.3): owners and
// managers save, check and remove them. Secrets go in and never come back.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  isCredentialKind,
  listCredentials,
  loadCredentials,
  removeCredentials,
  saveCredentials,
} from '@managemind/core';
import { smsProviderFor } from '@managemind/providers/sms';
import { AppError } from '@managemind/shared';
import { CREDENTIAL_KINDS, credentialInput } from '@managemind/shared/credentials';
import { credentialCheck } from '../credential-checks';
import { credentialsKeyring } from '../notifications';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });

const Kind = z.object({ kind: z.enum(CREDENTIAL_KINDS) });
const Credential = z
  .object({
    kind: z.enum(CREDENTIAL_KINDS),
    provider: z.string(),
    mode: z.enum(['sandbox', 'live']).nullable(),
    hint: z.string().openapi({ description: 'The last 4 characters of the store ID or key' }),
    config: z.record(z.string(), z.unknown()),
    checkedAt: z.string().nullable(),
    checkError: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('Credential');

export const CREDENTIAL_ROUTES = {
  credentials: r({
    method: 'get',
    path: '/credentials',
    summary: "The store's provider credentials, without secrets (settings.credentials)",
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(Credential) } },
        description: 'Credentials',
      },
    },
  }),
  saveCredential: r({
    method: 'put',
    path: '/credentials/{kind}',
    summary: 'Check with the provider, then save (settings.credentials)',
    request: {
      params: Kind,
      body: { content: { 'application/json': { schema: credentialInput } }, required: true },
    },
    responses: {
      200: { content: { 'application/json': { schema: Credential } }, description: 'Saved' },
    },
  }),
  smsBalance: r({
    method: 'get',
    path: '/credentials/sms/balance',
    summary: "The SMS gateway's balance, when it reports one (settings.credentials)",
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({
              balance: z.number().nullable(),
              error: z.string().nullable(),
            }),
          },
        },
        description: 'Balance',
      },
    },
  }),
  removeCredential: r({
    method: 'delete',
    path: '/credentials/{kind}',
    summary: 'Remove (settings.credentials)',
    request: { params: Kind },
    responses: { 204: { description: 'Removed' } },
  }),
} as const;

export function registerCredentials(admin: OpenAPIHono<StaffEnv>): void {
  const R = CREDENTIAL_ROUTES;
  admin.openapi(R.credentials, async (c) =>
    c.json(await inStore(c, (tx) => listCredentials(tx, c.var.staff.actor)), 200),
  );
  admin.openapi(R.saveCredential, async (c) => {
    const { kind } = c.req.valid('param');
    if (!isCredentialKind(kind)) throw new AppError('not_found');
    const keyring = await credentialsKeyring(c.env);
    if (!keyring) {
      throw new AppError('feature_unavailable', {
        detail: 'The platform has no credentials key yet (CREDENTIALS_KEY)',
      });
    }
    const saved = await inStore(
      c,
      (tx) =>
        saveCredentials(
          tx,
          c.var.staff.actor,
          keyring,
          kind,
          c.req.valid('json'),
          credentialCheck(),
        ),
      { write: true },
    );
    return c.json(saved, 200);
  });
  admin.openapi(R.smsBalance, async (c) => {
    if (!c.var.staff.actor.permissions.has('settings.credentials')) throw new AppError('forbidden');
    const keyring = await credentialsKeyring(c.env);
    const saved = await inStore(c, (tx) => loadCredentials(tx, keyring, 'sms'));
    if (!saved) throw new AppError('not_found');
    try {
      const balance = await smsProviderFor(saved.provider, saved.secrets, saved.config).balance();
      return c.json({ balance, error: null }, 200);
    } catch (e) {
      // Shown next to the gateway, as the check that saved it passed then.
      return c.json({ balance: null, error: e instanceof Error ? e.message : String(e) }, 200);
    }
  });
  admin.openapi(R.removeCredential, async (c) => {
    const { kind } = c.req.valid('param');
    await inStore(c, (tx) => removeCredentials(tx, c.var.staff.actor, kind), { write: true });
    return c.body(null, 204);
  });
}
