import { createDb } from '@managemind/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  acceptInvitation,
  actorFor,
  changeRole,
  createTenant,
  getStore,
  grantSupportAccess,
  invite,
  leaveStore,
  listInvitations,
  listMembers,
  listMyStores,
  removeMember,
  resendInvitation,
  revokeInvitation,
  revokeSupportAccess,
  setActiveStore,
  setPlatformRole,
  systemActor,
  type TenantTx,
  transitionTenant,
  updateStoreProfile,
  withPlatform,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
const unique = () => `i${Date.now().toString(36)}${seq++}`;

async function newUser(platformRole: string | null = null) {
  const email = `${unique()}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified, platform_role) values ('User', $1, true, $2) returning id`,
    [email, platformRole],
  );
  return { id: rows[0]?.id as string, email };
}

async function newStore() {
  const slug = unique();
  const ownerEmail = `${slug}@example.test`;
  const { id, ownerUserId } = await createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    owner: { email: ownerEmail, name: 'Owner' },
  });
  return { id, ownerUserId, ownerEmail };
}

const db = () => createDb(app);
const as = (userId: string, tenantId: string | null) => actorFor(db(), userId, tenantId);
const inStore = <T>(tenantId: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(app, tenantId, fn);

async function addMember(tenantId: string, role: string) {
  const u = await newUser();
  await owner.query(
    `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
    [tenantId, u.id, role],
  );
  const { rows } = await owner.query<{ id: string }>(
    `select id from platform.memberships where tenant_id = $1 and user_id = $2`,
    [tenantId, u.id],
  );
  return { ...u, memberId: rows[0]?.id as string };
}

const sessionsOf = async (userId: string) =>
  (await owner.query(`select 1 from platform.sessions where user_id = $1`, [userId])).rowCount;
const addSession = (userId: string) =>
  owner.query<{ id: string }>(
    `insert into platform.sessions (user_id, token, expires_at) values ($1, $2, now() + interval '1 day') returning id`,
    [userId, unique()],
  );

describe('actorFor', () => {
  it('gives members their role’s permissions in the active store only', async () => {
    const store = await newStore();
    const other = await newStore();
    const actor = await as(store.ownerUserId, store.id);
    expect(actor).toMatchObject({ tenantId: store.id, storeRole: 'owner' });
    expect(actor.permissions.has('staff.manage_owners')).toBe(true);
    const outside = await as(store.ownerUserId, other.id);
    expect(outside.tenantId).toBeUndefined();
    expect(outside.permissions.size).toBe(0);
  });

  it('counts only live support grants, and only for platform users', async () => {
    const store = await newStore();
    const support = await newUser('support');
    expect((await as(support.id, store.id)).tenantId).toBeUndefined();
    const { grant } = await grantSupportAccess(app, await as(support.id, null), store.id, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 30,
    });
    const actor = await as(support.id, store.id);
    expect(actor).toMatchObject({ storeRole: 'viewer', supportGrantId: grant.id });
    expect(actor.permissions.has('customers.read')).toBe(false);
    await revokeSupportAccess(app, actor, grant.id);
    expect((await as(support.id, store.id)).tenantId).toBeUndefined();
    // A grant row for someone who lost their platform role gives nothing.
    const former = await newUser();
    await owner.query(
      `insert into platform.support_grants (tenant_id, user_id, role, reason, granted_by, expires_at)
       values ($1, $2, 'viewer', 'left over from before', $2, now() + interval '1 hour')`,
      [store.id, former.id],
    );
    expect((await as(former.id, store.id)).tenantId).toBeUndefined();
  });
});

describe('members', () => {
  it('lists only this store’s members, in pages', async () => {
    const store = await newStore();
    await addMember(store.id, 'staff');
    await addMember(store.id, 'viewer');
    const viewer = await as((await addMember(store.id, 'viewer')).id, store.id);
    const first = await inStore(store.id, (tx) => listMembers(tx, viewer, { limit: 2 }));
    const rest = await inStore(store.id, (tx) =>
      listMembers(tx, viewer, { after: first[1]?.id as string }),
    );
    expect([...first, ...rest].map((x) => x.role).sort()).toEqual([
      'owner',
      'staff',
      'viewer',
      'viewer',
    ]);
    const other = await newStore();
    expect(await inStore(other.id, (tx) => listMembers(tx, viewer))).toHaveLength(1);
  });

  it('applies no-escalation, the last-owner rule and the self rule', async () => {
    const store = await newStore();
    const managerUser = await addMember(store.id, 'manager');
    const staff = await addMember(store.id, 'staff');
    const manager = await as(managerUser.id, store.id);
    const ownerActor = await as(store.ownerUserId, store.id);
    const [ownerMember] = (
      await owner.query<{ id: string }>(
        `select id from platform.memberships where tenant_id = $1 and role = 'owner'`,
        [store.id],
      )
    ).rows;

    await expect(
      inStore(store.id, (tx) => changeRole(tx, manager, staff.memberId, 'manager')),
    ).rejects.toMatchObject({ code: 'role_not_allowed' });
    await expect(
      inStore(store.id, (tx) => changeRole(tx, manager, managerUser.memberId, 'viewer')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      inStore(store.id, (tx) => removeMember(tx, manager, ownerMember?.id as string)),
    ).rejects.toMatchObject({ code: 'role_not_allowed' });
    await inStore(store.id, (tx) => changeRole(tx, manager, staff.memberId, 'viewer'));

    await expect(inStore(store.id, (tx) => leaveStore(tx, ownerActor))).rejects.toMatchObject({
      code: 'last_owner',
    });
    await inStore(store.id, (tx) => changeRole(tx, ownerActor, managerUser.memberId, 'owner'));
    await inStore(store.id, (tx) => leaveStore(tx, ownerActor));
    expect((await as(store.ownerUserId, store.id)).tenantId).toBeUndefined();
  });

  it('signs out a member whose role changes or who is removed', async () => {
    const store = await newStore();
    const staff = await addMember(store.id, 'staff');
    await addSession(staff.id);
    const ownerActor = await as(store.ownerUserId, store.id);
    await inStore(store.id, (tx) => changeRole(tx, ownerActor, staff.memberId, 'viewer'));
    expect(await sessionsOf(staff.id)).toBe(0);
    await addSession(staff.id);
    await inStore(store.id, (tx) => removeMember(tx, ownerActor, staff.memberId));
    expect(await sessionsOf(staff.id)).toBe(0);
    const audit = await owner.query(
      `select action from store.audit_log where tenant_id = $1 and action like 'staff.%' order by created_at`,
      [store.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['staff.role_changed', 'staff.removed']);
  });
});

describe('invitations', () => {
  it('invites, replaces a pending invitation, and accepts with the latest token', async () => {
    const store = await newStore();
    const ownerActor = await as(store.ownerUserId, store.id);
    const email = `${unique()}@Example.test`;
    const first = await inStore(store.id, (tx) => invite(tx, ownerActor, { email, role: 'staff' }));
    const second = await inStore(store.id, (tx) =>
      invite(tx, ownerActor, { email, role: 'manager' }),
    );
    expect(await inStore(store.id, (tx) => listInvitations(tx, ownerActor))).toMatchObject([
      { email: email.toLowerCase(), role: 'manager' },
    ]);
    const { rows } = await owner.query<{ id: string; email_verified: boolean }>(
      `select id, email_verified from platform.users where email = $1`,
      [email.toLowerCase()],
    );
    const invitee = { id: rows[0]?.id as string, email: email.toLowerCase() };
    expect(rows[0]?.email_verified).toBe(false);

    await expect(acceptInvitation(app, invitee, first.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });
    await expect(acceptInvitation(app, await newUser(), second.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });
    expect(await acceptInvitation(app, invitee, second.token)).toEqual({
      tenantId: store.id,
      role: 'manager',
    });
    expect((await as(invitee.id, store.id)).storeRole).toBe('manager');
    await expect(acceptInvitation(app, invitee, second.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });
    await expect(
      inStore(store.id, (tx) => invite(tx, ownerActor, { email, role: 'staff' })),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('checks who may invite whom, expiry, resend and revoke', async () => {
    const store = await newStore();
    const manager = await as((await addMember(store.id, 'manager')).id, store.id);
    const staff = await as((await addMember(store.id, 'staff')).id, store.id);
    const email = `${unique()}@example.test`;
    await expect(
      inStore(store.id, (tx) => invite(tx, staff, { email, role: 'viewer' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      inStore(store.id, (tx) => invite(tx, manager, { email, role: 'owner' })),
    ).rejects.toMatchObject({ code: 'role_not_allowed' });

    const issued = await inStore(store.id, (tx) => invite(tx, manager, { email, role: 'viewer' }));
    const resent = await inStore(store.id, (tx) =>
      resendInvitation(tx, manager, issued.invitation.id),
    );
    const user = {
      id: (
        await owner.query<{ id: string }>(`select id from platform.users where email = $1`, [email])
      ).rows[0]?.id as string,
      email,
    };
    await expect(acceptInvitation(app, user, issued.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });
    await owner.query(
      `update platform.invitations set expires_at = now() - interval '1 minute' where id = $1`,
      [issued.invitation.id],
    );
    await expect(acceptInvitation(app, user, resent.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });

    const again = await inStore(store.id, (tx) => invite(tx, manager, { email, role: 'viewer' }));
    await inStore(store.id, (tx) => revokeInvitation(tx, manager, again.invitation.id));
    await expect(acceptInvitation(app, user, again.token)).rejects.toMatchObject({
      code: 'invitation_invalid',
    });
  });
});

describe('support access', () => {
  it('lets support give itself Viewer access with a reason, audited in both logs, and names the owners', async () => {
    const store = await newStore();
    const support = await as((await newUser('support')).id, null);
    await expect(
      grantSupportAccess(app, support, store.id, {
        role: 'manager',
        reason: 'needs a fix made',
        minutes: 30,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      grantSupportAccess(app, support, store.id, { role: 'viewer', reason: 'short', minutes: 300 }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const granted = await grantSupportAccess(app, support, store.id, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 240,
    });
    expect(granted.owners).toEqual([{ email: store.ownerEmail, name: 'Owner', locale: 'bn' }]);
    const audits = await owner.query(
      `select 'platform' as log, actor_type from platform.audit_log where entity_id = $1
       union all select 'store', actor_type from store.audit_log where entity_id = $1`,
      [granted.grant.id],
    );
    expect(audits.rows).toEqual([
      { log: 'platform', actor_type: 'platform' },
      { log: 'store', actor_type: 'platform' },
    ]);
    await expect(
      grantSupportAccess(app, await as((await newUser()).id, null), store.id, {
        role: 'viewer',
        reason: 'not a platform user',
        minutes: 5,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets super admins grant Manager access, and only them revoke someone else’s grant', async () => {
    const store = await newStore();
    const admin = await as((await newUser('super_admin')).id, null);
    const support = await as((await newUser('support')).id, null);
    const { grant } = await grantSupportAccess(app, admin, store.id, {
      role: 'manager',
      reason: 'fixing a stuck setting',
      minutes: 60,
    });
    await expect(revokeSupportAccess(app, support, grant.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await revokeSupportAccess(app, admin, grant.id);
  });
});

describe('my stores and platform roles', () => {
  it('lists my stores and switches the session to one I may act in', async () => {
    const store = await newStore();
    const other = await newStore();
    const me = await as(store.ownerUserId, null);
    const session = (await addSession(store.ownerUserId)).rows[0]?.id as string;
    expect((await withPlatform(app, (tx) => listMyStores(tx, me))).map((s) => s.tenantId)).toEqual([
      store.id,
    ]);
    await expect(
      withPlatform(app, (tx) => setActiveStore(tx, me, session, other.id)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const next = await withPlatform(app, (tx) => setActiveStore(tx, me, session, store.id));
    expect(next.storeRole).toBe('owner');
    const { rows } = await owner.query(
      `select active_tenant_id from platform.sessions where id = $1`,
      [session],
    );
    expect(rows[0]?.active_tenant_id).toBe(store.id);
  });

  it('shows support grants among my stores', async () => {
    const store = await newStore();
    const support = await as((await newUser('support')).id, null);
    await grantSupportAccess(app, support, store.id, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 10,
    });
    const stores = await withPlatform(app, (tx) => listMyStores(tx, support));
    expect(stores).toMatchObject([{ tenantId: store.id, role: 'viewer' }]);
    expect(stores[0]?.supportUntil).toBeInstanceOf(Date);
  });

  it('lets super admins and the CLI set platform roles, signing the user out', async () => {
    const user = await newUser();
    await addSession(user.id);
    const support = await as((await newUser('support')).id, null);
    await expect(
      withPlatform(app, (tx) => setPlatformRole(tx, support, user.id, 'support')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await withPlatform(app, (tx) => setPlatformRole(tx, systemActor as Actor, user.id, 'support'));
    expect((await as(user.id, null)).platformRole).toBe('support');
    expect(await sessionsOf(user.id)).toBe(0);
  });
});

describe('every command checks its own permission', () => {
  it('refuses an actor without the permission or platform role', async () => {
    const store = await newStore();
    const fake = '0199d000-0000-7000-8000-00000000ffff';
    const nobody: Actor = {
      kind: 'user',
      userId: (await newUser()).id,
      platformRole: null,
      permissions: new Set(),
    };
    const storeCommands: ((tx: TenantTx) => Promise<unknown>)[] = [
      (tx) => getStore(tx, nobody),
      (tx) => updateStoreProfile(tx, nobody, { name: 'x' }),
      (tx) => listMembers(tx, nobody),
      (tx) => changeRole(tx, nobody, fake, 'viewer'),
      (tx) => removeMember(tx, nobody, fake),
      (tx) => listInvitations(tx, nobody),
      (tx) => invite(tx, nobody, { email: 'x@example.test', role: 'viewer' }),
      (tx) => resendInvitation(tx, nobody, fake),
      (tx) => revokeInvitation(tx, nobody, fake),
    ];
    for (const command of storeCommands) {
      await expect(inStore(store.id, command)).rejects.toMatchObject({ code: 'forbidden' });
    }
    const platformCommands = [
      () =>
        createTenant(app, nobody, {
          slug: unique(),
          name: 'x',
          owner: { email: 'x@example.test', name: 'x' },
        }),
      () => transitionTenant(app, nobody, store.id, 'suspend', { reason: 'no reason' }),
      () =>
        grantSupportAccess(app, nobody, store.id, {
          role: 'viewer',
          reason: 'not allowed at all',
          minutes: 5,
        }),
      () => revokeSupportAccess(app, nobody, fake),
      () =>
        withPlatform(app, (tx) => setPlatformRole(tx, nobody, nobody.userId as string, 'support')),
    ];
    for (const command of platformCommands) {
      await expect(command()).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});
