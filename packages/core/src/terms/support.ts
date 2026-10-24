// The platform's support contacts and documents (phase-5b-plan §3.4, §3.15,
// §7): the help menu's guide, email and WhatsApp, the abuse address the
// store privacy template names, and the links to our privacy notice and
// data processing agreement. A platform setting a super admin edits; the
// help menu and templates show what is set.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import type { TenantTx } from '../tenant';

const url = z.url({ protocol: /^https$/ }).max(500);
export const supportInput = z
  .object({
    email: z.email().max(254).optional(),
    /** Digits with the country code, as wa.me links want them: 8801712345678. */
    whatsapp: z
      .string()
      .regex(/^8801[3-9]\d{8}$/)
      .optional(),
    abuseEmail: z.email().max(254).optional(),
    helpUrl: url.optional(),
    privacyUrl: url.optional(),
    dpaUrl: url.optional(),
  })
  .strict();
export type Support = z.infer<typeof supportInput>;

const KEY = 'support';

export async function getSupport(tx: { db: TenantTx['db'] }): Promise<Support> {
  const [row] = await tx.db
    .select({ value: schema.platformSettings.value })
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.key, KEY));
  const parsed = supportInput.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

export async function setSupport(tx: PlatformTx, actor: Actor, input: unknown): Promise<Support> {
  requirePlatformRole(actor, 'super_admin');
  const parsed = supportInput.safeParse(input);
  if (!parsed.success) {
    throw new AppError('validation_failed', {
      fields: parsed.error.issues.map((x) => ({
        path: x.path.join('.'),
        code: x.code,
        message: x.message,
      })),
    });
  }
  const before = await getSupport(tx);
  const s = schema.platformSettings;
  await tx.db
    .insert(s)
    .values({ key: KEY, value: parsed.data })
    .onConflictDoUpdate({ target: s.key, set: { value: parsed.data } });
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    action: 'platform.support_updated',
    before,
    after: parsed.data,
  });
  return parsed.data;
}
