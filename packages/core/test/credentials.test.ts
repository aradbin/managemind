// The credentials vault (phase-5a-plan §3.1): checked before saving, never
// read back, and bound to its store and kind by the encryption itself.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type CredentialCheck,
  createTenant,
  importKeyring,
  type Keyring,
  listCredentials,
  loadCredentials,
  openCredentials,
  removeCredentials,
  saveCredentials,
  sealCredentials,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let other: string;
let keyring: Keyring;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const actorAs = (role: StoreRole, tenantId = store): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ee',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId,
  storeRole: role,
});
const passes: CredentialCheck = async () => {};

async function newStore(prefix: string): Promise<string> {
  const slug = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return (
    await createTenant(app, systemActor, {
      slug,
      name: 'Credentials test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
}

beforeAll(async () => {
  app = await connectApp();
  keyring = await importKeyring(KEY);
  [store, other] = [await newStore('cred'), await newStore('credb')];
});
afterAll(() => app.end());
const run = <T>(fn: (tx: TenantTx) => Promise<T>, tenant = store) => withTenant(app, tenant, fn);

const sms = { provider: 'sms_net_bd', secrets: { apiKey: 'key-1234567890' }, config: {} };

describe('the credentials vault', () => {
  it('saves after the check, and lists only the provider and a hint', async () => {
    const seen: unknown[] = [];
    const summary = await run((tx) =>
      saveCredentials(tx, actorAs('manager'), keyring, 'sms', sms, async (c) => {
        seen.push(c.secrets);
      }),
    );
    expect(seen).toEqual([{ apiKey: 'key-1234567890' }]);
    expect(summary).toMatchObject({ kind: 'sms', provider: 'sms_net_bd', hint: '7890' });
    const list = await run((tx) => listCredentials(tx, actorAs('owner')));
    expect(JSON.stringify(list)).not.toContain('key-1234567890');
    const stored = await run((tx) =>
      tx.db.execute<{ ciphertext: Buffer }>(sql`select ciphertext from store.provider_credentials`),
    );
    expect(Buffer.from(stored.rows[0]?.ciphertext ?? []).toString()).not.toContain('key-1234');
  });

  it('decrypts for the code that calls the provider', async () => {
    const loaded = await run((tx) => loadCredentials(tx, keyring, 'sms'));
    expect(loaded).toMatchObject({ provider: 'sms_net_bd', secrets: { apiKey: 'key-1234567890' } });
    // Without a key (CREDENTIALS_KEY unset), the store simply has none.
    expect(await run((tx) => loadCredentials(tx, null, 'sms'))).toBeNull();
  });

  it('saves nothing when the provider refuses them', async () => {
    const refuse: CredentialCheck = async () => {
      throw new Error('invalid API key');
    };
    await expect(
      run((tx) =>
        saveCredentials(
          tx,
          actorAs('owner'),
          keyring,
          'sms',
          { ...sms, secrets: { apiKey: 'bad-key-0000' } },
          refuse,
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const loaded = await run((tx) => loadCredentials(tx, keyring, 'sms'));
    expect(loaded?.secrets).toEqual({ apiKey: 'key-1234567890' });
  });

  it('refuses the wrong provider for a kind, and SSLCommerz without a mode', async () => {
    await expect(
      run((tx) => saveCredentials(tx, actorAs('owner'), keyring, 'email', sms, passes)),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        saveCredentials(
          tx,
          actorAs('owner'),
          keyring,
          'sslcommerz',
          { provider: 'sslcommerz', secrets: { storeId: 'test1', storePassword: 'pw' } },
          passes,
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('is for owners and managers only', async () => {
    await expect(run((tx) => listCredentials(tx, actorAs('staff')))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run((tx) => saveCredentials(tx, actorAs('viewer'), keyring, 'sms', sms, passes)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('binds a ciphertext to its store and kind', async () => {
    const sealed = await sealCredentials(keyring, store, 'sms', { apiKey: 'x' });
    await expect(openCredentials(keyring, other, 'sms', sealed)).rejects.toThrow();
    await expect(openCredentials(keyring, store, 'email', sealed)).rejects.toThrow();
    expect(await openCredentials(keyring, store, 'sms', sealed)).toEqual({ apiKey: 'x' });
    const otherKey = await importKeyring(btoa('k'.repeat(32)));
    await expect(openCredentials(otherKey, store, 'sms', sealed)).rejects.toThrow();
  });

  it('removes a kind', async () => {
    await run((tx) => removeCredentials(tx, actorAs('owner'), 'sms'));
    expect(await run((tx) => loadCredentials(tx, keyring, 'sms'))).toBeNull();
    await expect(run((tx) => removeCredentials(tx, actorAs('owner'), 'sms'))).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
  });
});
