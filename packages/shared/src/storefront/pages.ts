// Static pages (phase-3-plan §3.5, Q12): about, contact, the policies and
// custom pages, written by the store in both languages. Policy pages start
// empty except for suggested headings, until the legal review provides
// templates.
import { z } from 'zod';
import { richTextDoc } from '../catalog/rich-text-schema';
import { catalogSlug, cleanString, perLocale } from '../catalog/schemas';
import type { Locale } from '../money';
import type { RichTextDoc } from '../rich-text';

export const PAGE_KINDS = [
  'about',
  'contact',
  'privacy',
  'returns',
  'delivery',
  'terms',
  'custom',
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export const MAX_PAGES = 30;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

export const pageTranslation = z.object({
  title: cleanString(120),
  /** Generated from the title when left out. */
  slug: catalogSlug.optional(),
  body: richTextDoc.nullable().optional(),
  seoTitle: optionalText(120),
  seoDescription: optionalText(320),
});

export const pageCreate = z.object({
  kind: z.enum(PAGE_KINDS),
  published: z.boolean().default(false),
  position: z.int().min(0).max(1000).optional(),
  translations: perLocale(pageTranslation),
});
export type PageCreate = z.infer<typeof pageCreate>;

export const pagePatch = z.object({
  published: z.boolean().optional(),
  position: z.int().min(0).max(1000).optional(),
  /** A language set to null removes that translation (never the store's default). */
  translations: z.partialRecord(z.enum(['bn', 'en']), pageTranslation.nullable()).optional(),
});
export type PagePatch = z.infer<typeof pagePatch>;

const HEADINGS: Record<Exclude<PageKind, 'custom'>, Record<Locale, string[]>> = {
  about: { bn: ['আমাদের কথা', 'আমরা কী বিক্রি করি'], en: ['Our story', 'What we sell'] },
  contact: {
    bn: ['ফোন ও হোয়াটসঅ্যাপ', 'ঠিকানা', 'কখন খোলা থাকে'],
    en: ['Phone and WhatsApp', 'Address', 'Opening hours'],
  },
  privacy: {
    bn: ['আমরা কী তথ্য সংগ্রহ করি', 'তথ্য কীভাবে ব্যবহার করি', 'কুকি', 'যোগাযোগ'],
    en: ['What we collect', 'How we use it', 'Cookies', 'Contact us'],
  },
  returns: {
    bn: ['কোন পণ্য ফেরত দেওয়া যায়', 'কত দিনের মধ্যে', 'কীভাবে ফেরত দেবেন', 'টাকা ফেরত'],
    en: ['What can be returned', 'Within how many days', 'How to return', 'Refunds'],
  },
  delivery: {
    bn: ['ডেলিভারি এলাকা', 'ডেলিভারি চার্জ', 'কত দিনে পৌঁছায়', 'ক্যাশ অন ডেলিভারি'],
    en: ['Where we deliver', 'Delivery charges', 'How long it takes', 'Cash on delivery'],
  },
  terms: {
    bn: ['অর্ডার', 'দাম ও পেমেন্ট', 'দায়বদ্ধতা', 'যোগাযোগ'],
    en: ['Orders', 'Prices and payment', 'Liability', 'Contact us'],
  },
};

/** A new page's body: its kind's suggested headings, each with an empty paragraph. */
export function suggestedPageBody(kind: PageKind, locale: Locale): RichTextDoc | null {
  if (kind === 'custom') return null;
  return {
    type: 'doc',
    content: HEADINGS[kind][locale].flatMap((text) => [
      {
        type: 'heading' as const,
        attrs: { level: 2 as const },
        content: [{ type: 'text' as const, text }],
      },
      { type: 'paragraph' as const },
    ]),
  };
}

/** Default titles of the fixed kinds. */
export const PAGE_TITLES: Record<Exclude<PageKind, 'custom'>, Record<Locale, string>> = {
  about: { bn: 'আমাদের সম্পর্কে', en: 'About us' },
  contact: { bn: 'যোগাযোগ', en: 'Contact' },
  privacy: { bn: 'গোপনীয়তা নীতি', en: 'Privacy policy' },
  returns: { bn: 'রিটার্ন নীতি', en: 'Returns' },
  delivery: { bn: 'ডেলিভারি তথ্য', en: 'Delivery' },
  terms: { bn: 'শর্তাবলি', en: 'Terms and conditions' },
};
