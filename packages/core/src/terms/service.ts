// Platform terms (phase-5b-plan §3.4, Q7): versions published by super
// admins, accepted by store owners. Owners are asked from the day a version
// is published; from its effective date, a store whose owners haven't
// accepted it is read-only for its owners until one of them does. Managers,
// staff and shoppers are never blocked.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { recordAudit } from '../audit';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import type { TenantTx } from '../tenant';

const v = schema.termsVersions;
const a = schema.termsAcceptances;

export interface TermsVersion {
  id: string;
  version: string;
  effectiveAt: Date;
  url: string;
  sha256: string;
  createdAt: Date;
}

export interface TermsVersionWithCount extends TermsVersion {
  /** Stores with an owner who accepted this version. */
  acceptedStores: number;
}

const columns = {
  id: v.id,
  version: v.version,
  effectiveAt: v.effectiveAt,
  url: v.url,
  sha256: v.sha256,
  createdAt: v.createdAt,
};

/** Versions, newest first, with how many stores accepted each (support). */
export async function listTermsVersions(
  tx: PlatformTx,
  actor: Actor,
): Promise<TermsVersionWithCount[]> {
  requirePlatformRole(actor, 'support');
  return tx.db
    .select({
      ...columns,
      acceptedStores: sql<number>`(select count(distinct ta.tenant_id)::int
        from platform.terms_acceptances ta where ta.version_id = "terms_versions"."id")`,
    })
    .from(v)
    .orderBy(desc(v.effectiveAt));
}

/**
 * Publishes a version (super_admin): owners are asked from now, and blocked
 * from `effectiveAt`. The SHA-256 pins the published text, so a changed text
 * is a new version.
 */
export async function publishTerms(
  tx: PlatformTx,
  actor: Actor,
  input: { version: string; effectiveAt: Date; url: string; sha256: string },
): Promise<TermsVersion> {
  requirePlatformRole(actor, 'super_admin');
  const version = input.version.trim();
  if (!/^[\w.-]{1,40}$/.test(version)) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'version', code: 'invalid', message: 'letters, digits, dots and dashes' }],
    });
  }
  if (!/^https:\/\//.test(input.url)) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'url', code: 'invalid', message: 'an https address' }],
    });
  }
  const [latest] = await tx.db.select(columns).from(v).orderBy(desc(v.effectiveAt)).limit(1);
  if (latest && input.effectiveAt <= latest.effectiveAt) {
    throw new AppError('validation_failed', {
      fields: [
        {
          path: 'effectiveAt',
          code: 'too_early',
          message: 'after the current version takes effect',
        },
      ],
    });
  }
  const [row] = await tx.db
    .insert(v)
    .values({
      version,
      effectiveAt: input.effectiveAt,
      url: input.url,
      sha256: input.sha256.toLowerCase(),
      publishedBy: actor.userId,
    })
    .onConflictDoNothing({ target: v.version })
    .returning(columns);
  if (!row) throw new AppError('conflict', { detail: 'that version exists' });
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    action: 'terms.published',
    entityType: 'terms_version',
    entityId: row.id,
    after: { version, effectiveAt: input.effectiveAt, url: input.url, sha256: row.sha256 },
  });
  return row;
}

export interface TermsStatus {
  /** The newest version this store's owners haven't accepted, or null. */
  pending: TermsVersion | null;
  /** It has taken effect: the owners' admin is read-only until one accepts. */
  blocking: boolean;
}

/** The terms a store's owners still have to accept (any store member may ask). */
export async function termsStatus(
  tx: { db: TenantTx['db'] },
  tenantId: string,
  now = new Date(),
): Promise<TermsStatus> {
  const [latest] = await tx.db
    .select({
      ...columns,
      accepted: sql<boolean>`exists (
        select 1 from platform.terms_acceptances ta join platform.memberships m
          on m.tenant_id = ta.tenant_id and m.user_id = ta.user_id and m.role = 'owner'
         where ta.tenant_id = ${tenantId} and ta.version_id = "terms_versions"."id")`,
    })
    .from(v)
    .orderBy(desc(v.effectiveAt))
    .limit(1);
  if (!latest || latest.accepted) return { pending: null, blocking: false };
  const { accepted: _accepted, ...pending } = latest;
  return { pending, blocking: pending.effectiveAt <= now };
}

/**
 * True when the owners' admin is read-only (§3.4): the actor is an owner by
 * membership (not through a support grant) and the store's current version
 * has taken effect unaccepted. One query, run with a write's store check.
 */
export async function ownerBlockedByTerms(
  tx: TenantTx,
  actor: Actor,
  now = new Date(),
): Promise<boolean> {
  if (actor.storeRole !== 'owner' || actor.supportGrantId) return false;
  return (await termsStatus(tx, tx.tenantId, now)).blocking;
}

/** An owner accepts a version for the store (append only; accepting twice is a no-op). */
export async function acceptTerms(
  tx: TenantTx,
  actor: Actor,
  input: { versionId: string; ip: string | null; userAgent: string | null },
): Promise<{ accepted: true }> {
  if (actor.storeRole !== 'owner' || actor.supportGrantId || !actor.userId) {
    throw new AppError('forbidden', { detail: 'only an owner can accept the platform terms' });
  }
  const [version] = await tx.db.select(columns).from(v).where(eq(v.id, input.versionId));
  if (!version) throw new AppError('not_found');
  const [user] = await tx.db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, actor.userId));
  const inserted = await tx.db
    .insert(a)
    .values({
      tenantId: tx.tenantId,
      userId: actor.userId,
      userEmail: user?.email ?? '',
      versionId: version.id,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: a.id });
  if (inserted.length) {
    await recordAudit(tx, {
      ...auditActor(actor, 'staff'),
      action: 'terms.accepted',
      entityType: 'terms_version',
      entityId: version.id,
      after: { version: version.version },
    });
  }
  return { accepted: true };
}
