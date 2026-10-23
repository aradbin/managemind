// The help menu and our support details (phase-5b-plan §3.15, §7): a super
// admin sets them, support reads them, and every staff member sees them.
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, enrollAuthenticator, signIn } from './staff';
import { makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
beforeAll(async () => {
  owner = await connect(ownerUrl);
});
afterAll(() => owner.end());

let seq = 0;
async function signedIn(role: 'support' | 'super_admin' | null) {
  const email = `help${Date.now().toString(36)}${seq++}@example.test`;
  await owner.query(
    `insert into platform.users (name, email, email_verified, platform_role) values ('P', $1, true, $2)`,
    [email, role],
  );
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (role) await enrollAuthenticator(b);
  return b;
}

describe('the help menu', () => {
  it('shows what a super admin set, to every staff member', async () => {
    const admin = await signedIn('super_admin');
    const support = await signedIn('support');
    const staff = await signedIn(null);
    const details = {
      email: 'help@platform.example.test',
      whatsapp: '8801712345678',
      abuseEmail: 'abuse@platform.example.test',
      helpUrl: 'https://platform.example.test/help',
    };
    expect((await support.call('PUT', '/api/platform/support', details)).status).toBe(403);
    expect(
      (await admin.call('PUT', '/api/platform/support', { whatsapp: '01712345678' })).status,
    ).toBe(422);
    expect((await admin.call('PUT', '/api/platform/support', details)).status).toBe(200);
    expect(await (await support.get('/api/platform/support')).json()).toEqual(details);
    const help = (await (await staff.get('/v1/admin/help')).json()) as Json;
    expect(help).toMatchObject({
      helpUrl: details.helpUrl,
      email: details.email,
      whatsapp: details.whatsapp,
      privacyUrl: null,
    });
    // The abuse address is for the templates, not the menu.
    expect(help).not.toHaveProperty('abuseEmail');
  });
});
