// Invitations (phase-1-plan §5.6). Inviting creates the person's user row
// if needed, so they can sign in with an email code; the invitation stores
// only a hash of its token, which lives only in the emailed link. Accepting
// needs that token and a session for the invited email.
import { schema } from '@managemind/db';
import { AppError, canManageRole, type StoreRole } from '@managemind/shared';
import { and, desc, eq } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { emit } from '../outbox';
import { type DbClient, type TenantTx, type WithTenantOptions, withTenant } from '../tenant';

const inv = schema.invitations;
const m = schema.memberships;
const u = schema.users;

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of the token, as stored in invitations.token_hash. */
export const hashToken = async (token: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

/** 32 random bytes, base64url. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface Invitation {
  id: string;
  email: string;
  role: StoreRole;
  expiresAt: Date;
  createdAt: Date;
}

const columns = {
  id: inv.id,
  email: inv.email,
  role: inv.role,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
};

/** Pending invitations, newest first (`staff.read`). */
export async function listInvitations(tx: TenantTx, actor: Actor): Promise<Invitation[]> {
  authorize(actor, 'staff.read');
  return tx.db
    .select(columns)
    .from(inv)
    .where(and(eq(inv.tenantId, tx.tenantId), eq(inv.status, 'pending')))
    .orderBy(desc(inv.createdAt));
}

/** The invitation and its token, for the caller to email. The token is never stored. */
export interface IssuedInvitation {
  invitation: Invitation;
  token: string;
}

/**
 * Invites an email address with a role the actor may give. A pending
 * invitation for the same address is replaced, so its old link stops working.
 */
export async function invite(
  tx: TenantTx,
  actor: Actor,
  input: { email: string; role: StoreRole },
): Promise<IssuedInvitation> {
  authorize(actor, 'staff.write');
  if (!canManageRole(actor.permissions, input.role)) throw new AppError('role_not_allowed');
  if (!actor.userId) throw new AppError('forbidden');
  const email = input.email.trim().toLowerCase();

  const [existing] = await tx.db.select({ id: u.id }).from(u).where(eq(u.email, email));
  if (existing) {
    const [member] = await tx.db
      .select({ id: m.id })
      .from(m)
      .where(and(eq(m.tenantId, tx.tenantId), eq(m.userId, existing.id)));
    if (member) throw new AppError('conflict', { detail: 'already a member of this store' });
  } else {
    // A user row lets them sign in with a code; sign-up stays closed.
    await tx.db.insert(u).values({ email, name: email.split('@')[0] ?? email });
  }

  await tx.db
    .update(inv)
    .set({ status: 'revoked' })
    .where(and(eq(inv.tenantId, tx.tenantId), eq(inv.email, email), eq(inv.status, 'pending')));
  const token = newToken();
  const [row] = await tx.db
    .insert(inv)
    .values({
      email,
      role: input.role,
      tokenHash: await hashToken(token),
      invitedBy: actor.userId,
      tenantId: tx.tenantId,
    })
    .returning(columns);
  if (!row) throw new AppError('internal', { detail: 'invitation insert returned no row' });

  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'staff.invited',
    entityType: 'invitation',
    entityId: row.id,
    after: { email, role: input.role },
  });
  await emit(tx, 'staff.invited', {
    aggregateType: 'invitation',
    aggregateId: row.id,
    payload: { invitationId: row.id, role: input.role },
  });
  return { invitation: row, token };
}

async function lockPending(tx: TenantTx, actor: Actor, id: string) {
  authorize(actor, 'staff.write');
  const [row] = await tx.db
    .select({ ...columns, status: inv.status })
    .from(inv)
    .where(and(eq(inv.id, id), eq(inv.tenantId, tx.tenantId)))
    .for('update');
  if (row?.status !== 'pending') throw new AppError('not_found');
  if (!canManageRole(actor.permissions, row.role)) throw new AppError('role_not_allowed');
  return row;
}

/** A new token and 7 more days; the old link stops working. */
export async function resendInvitation(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<IssuedInvitation> {
  await lockPending(tx, actor, id);
  const token = newToken();
  const [row] = await tx.db
    .update(inv)
    .set({ tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) })
    .where(eq(inv.id, id))
    .returning(columns);
  if (!row) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'staff.invitation_resent',
    entityType: 'invitation',
    entityId: id,
  });
  return { invitation: row, token };
}

export async function revokeInvitation(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  await lockPending(tx, actor, id);
  await tx.db.update(inv).set({ status: 'revoked' }).where(eq(inv.id, id));
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'staff.invitation_revoked',
    entityType: 'invitation',
    entityId: id,
  });
}

/**
 * Accepts with the emailed token, for the signed-in user whose email it was
 * sent to. Creates the membership (or keeps an existing one) and returns the
 * store, which the caller makes the session's active store.
 */
export async function acceptInvitation(
  client: DbClient,
  user: { id: string; email: string },
  token: string,
  options: WithTenantOptions = {},
): Promise<{ tenantId: string; role: StoreRole }> {
  const hash = await hashToken(token);
  const { rows } = await client.query<{ tenant_id: string }>(
    'select tenant_id from platform.invitations where token_hash = $1',
    [hash],
  );
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw new AppError('invitation_invalid');

  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const [row] = await tx.db
        .select({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          status: inv.status,
          expiresAt: inv.expiresAt,
        })
        .from(inv)
        .where(and(eq(inv.tokenHash, hash), eq(inv.tenantId, tenantId)))
        .for('update');
      if (row?.status !== 'pending' || row.expiresAt <= new Date()) {
        throw new AppError('invitation_invalid');
      }
      if (row.email !== user.email.toLowerCase()) {
        throw new AppError('invitation_invalid', { detail: 'sent to another email address' });
      }
      const [joined] = await tx.db
        .insert(m)
        .values({ tenantId, userId: user.id, role: row.role })
        .onConflictDoNothing()
        .returning({ id: m.id });
      await tx.db
        .update(inv)
        .set({ status: 'accepted', acceptedBy: user.id, acceptedAt: new Date() })
        .where(eq(inv.id, row.id));
      await recordAudit(tx, {
        actorType: 'staff',
        actorId: user.id,
        action: 'staff.joined',
        entityType: 'invitation',
        entityId: row.id,
        after: { role: row.role },
      });
      if (joined) {
        await emit(tx, 'staff.joined', {
          aggregateType: 'membership',
          aggregateId: joined.id,
          payload: { userId: user.id, role: row.role },
        });
      }
      return { tenantId, role: row.role };
    },
    options,
  );
}
