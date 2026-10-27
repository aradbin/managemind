// Expenses (phase-8-plan §3.6): categories, entries and recurring entries.
// An expense is in taka on the day it was spent (Dhaka); there is no
// currency field (PLAN.md: no multi-currency).
import { z } from 'zod';
import { cleanString } from '../catalog/schemas';
import { BACK_OFFICE_LIMITS } from './limits';
import { optionalNote, SPEND_METHODS } from './purchasing';

/** The categories a store starts with (§3.6); staff rename, add and archive them. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { key: 'rent', name: { bn: 'ভাড়া', en: 'Rent' } },
  { key: 'salaries', name: { bn: 'বেতন ও মজুরি', en: 'Salaries and wages' } },
  { key: 'ads', name: { bn: 'ফেসবুক ও অনলাইন বিজ্ঞাপন', en: 'Facebook and online ads' } },
  { key: 'packaging', name: { bn: 'প্যাকেজিং', en: 'Packaging' } },
  { key: 'delivery', name: { bn: 'ডেলিভারি ও কুরিয়ার', en: 'Delivery and courier' } },
  { key: 'utilities', name: { bn: 'বিদ্যুৎ, পানি ও গ্যাস', en: 'Utilities' } },
  { key: 'internet', name: { bn: 'ইন্টারনেট ও ফোন', en: 'Internet and phone' } },
  {
    key: 'bank_charges',
    name: { bn: 'ব্যাংক ও মোবাইল ব্যাংকিং চার্জ', en: 'Bank and mobile-banking charges' },
  },
  { key: 'equipment', name: { bn: 'যন্ত্রপাতি', en: 'Equipment' } },
  { key: 'other', name: { bn: 'অন্যান্য', en: 'Other' } },
] as const;

export const EXPENSE_CADENCES = ['monthly', 'weekly'] as const;
export type ExpenseCadence = (typeof EXPENSE_CADENCES)[number];

/** A monthly entry's day: 1–28, or this for the month's last day. */
export const LAST_DAY_OF_MONTH = 0;

/** At most 2 MB after the browser shrinks it, as return photos (Q8). */
export const RECEIPT_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const RECEIPT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const amount = z.int().min(1).max(BACK_OFFICE_LIMITS.maxAmount);
const date = z.iso.date();

export const expenseCategoryInput = z
  .object({
    name: z.object({ bn: cleanString(100), en: cleanString(100) }).strict(),
    position: z.int().min(0).max(1000).optional(),
  })
  .strict();

export const expenseCategoryPatch = expenseCategoryInput
  .extend({ archived: z.boolean() })
  .partial()
  .strict();

const expenseFields = {
  spentOn: date,
  categoryId: z.uuid(),
  amount,
  method: z.enum(SPEND_METHODS),
  payee: optionalNote(200),
  note: optionalNote(1000),
};

export const expenseInput = z.object(expenseFields).strict();
export type ExpenseInput = z.infer<typeof expenseInput>;

export const expensePatch = z.object(expenseFields).partial().strict();
export type ExpensePatch = z.infer<typeof expensePatch>;

const recurringFields = {
  categoryId: z.uuid(),
  amount,
  method: z.enum(SPEND_METHODS),
  payee: optionalNote(200),
  note: optionalNote(1000),
  cadence: z.enum(EXPENSE_CADENCES),
  /** Monthly: 1–28, or 0 for the last day. Weekly: 1 (Monday) to 7 (Sunday), as ISO. */
  day: z.int().min(0).max(28),
  startsOn: date,
  endsOn: date.nullable().optional(),
  active: z.boolean().optional(),
};

const validDay = (v: { cadence?: ExpenseCadence | undefined; day?: number | undefined }) =>
  v.cadence !== 'weekly' || v.day === undefined || (v.day >= 1 && v.day <= 7);
const endsAfterStart = (v: { startsOn?: string | undefined; endsOn?: string | null | undefined }) =>
  !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;

export const recurringExpenseInput = z
  .object(recurringFields)
  .strict()
  .refine(validDay, { message: 'a weekday from 1 to 7', path: ['day'] })
  .refine(endsAfterStart, { message: 'on or after the start', path: ['endsOn'] });
export type RecurringExpenseInput = z.infer<typeof recurringExpenseInput>;

/** Changes only future posts (§3.6). */
export const recurringExpensePatch = z
  .object(recurringFields)
  .partial()
  .strict()
  .refine(validDay, { message: 'a weekday from 1 to 7', path: ['day'] })
  .refine(endsAfterStart, { message: 'on or after the start', path: ['endsOn'] });
export type RecurringExpensePatch = z.infer<typeof recurringExpensePatch>;
