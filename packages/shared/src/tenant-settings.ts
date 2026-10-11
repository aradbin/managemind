// Per-store settings: typed JSON in platform.tenants.settings, validated with
// zod so new options need no migration (PLAN.md, extensibility). Unknown keys
// are refused, so a typo can never be stored silently. The store's name and
// default locale are columns, not settings.
import { z } from 'zod';
import { normalizePhone } from './phone';

/** A Bangladeshi mobile number, stored in E.164. */
export const phoneNumber = () =>
  z
    .string()
    .max(32)
    .transform((value, ctx) => {
      const phone = normalizePhone(value);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'must be a Bangladeshi mobile number' });
        return z.NEVER;
      }
      return phone;
    });

const text = (max: number) => z.string().trim().min(1).max(max);

export const storeProfile = z
  .object({
    contactEmail: z.email().max(254).optional(),
    contactPhone: phoneNumber().optional(),
    address: z
      .object({
        line1: text(200),
        line2: text(200).optional(),
        city: text(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const tenantSettings = z
  .object({
    version: z.literal(1).default(1),
    profile: storeProfile.default({}),
    display: z
      .object({
        /** Bangla or Western digits for prices and dates (Phase 3). */
        numerals: z.enum(['bengali', 'latin']).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export type TenantSettings = z.infer<typeof tenantSettings>;
export type StoreProfile = z.infer<typeof storeProfile>;

/** Settings for a new store: every default filled in. */
export const defaultTenantSettings = (): TenantSettings => tenantSettings.parse({});
