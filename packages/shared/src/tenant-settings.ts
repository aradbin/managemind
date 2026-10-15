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

/** A VAT category for products taxed differently from the standard rate. */
const vatCategory = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    name: text(100),
    /** 0 for zero-rated. */
    rateBasisPoints: z.int().min(0).max(10_000),
    /** Outside VAT altogether, as opposed to taxed at 0%. */
    exempt: z.boolean().default(false),
  })
  .strict();

/**
 * VAT (phase-2-plan §3.9, Q4): off by default, because many small merchants
 * aren't registered; 15% with prices including VAT once turned on. Phase 4
 * calculates VAT per order line from these settings.
 */
export const taxSettings = z
  .object({
    vatEnabled: z.boolean().default(false),
    /** The standard rate in basis points: 1500 = 15%. */
    rateBasisPoints: z.int().min(0).max(10_000).default(1500),
    pricesIncludeVat: z.boolean().default(true),
    categories: z
      .array(vatCategory)
      .max(20)
      .refine((list) => new Set(list.map((c) => c.key)).size === list.length, 'keys must differ')
      .default([]),
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
    tax: taxSettings.default({
      vatEnabled: false,
      rateBasisPoints: 1500,
      pricesIncludeVat: true,
      categories: [],
    }),
  })
  .strict();

export type TaxSettings = z.infer<typeof taxSettings>;
export type TenantSettings = z.infer<typeof tenantSettings>;
export type StoreProfile = z.infer<typeof storeProfile>;

/** Settings for a new store: every default filled in. */
export const defaultTenantSettings = (): TenantSettings => tenantSettings.parse({});
