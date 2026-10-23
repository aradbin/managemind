// A store's legal pages from templates (phase-5b-plan §3.15): terms of sale,
// privacy, returns and delivery, in Bangla and English, filled from the
// store's profile and settings each time the page is shown, so a settings
// change updates the page. An owner who edits a page takes it over: it
// stops following the template. The wording is a draft until the legal
// review approves it; it follows the Digital Commerce Operation Guidelines
// 2021 on delivery times, refunds and what a store must display.

import type { Locale } from '../money';
import { format, money } from '../money';
import type { RichTextDoc } from '../rich-text';

export const LEGAL_KINDS = ['terms', 'privacy', 'returns', 'delivery'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const isLegalKind = (kind: string): kind is LegalKind =>
  (LEGAL_KINDS as readonly string[]).includes(kind);

/** What the templates are filled from; every field but the store's name is optional. */
export interface LegalContext {
  storeName: string;
  businessName?: string | undefined;
  address?: string | undefined;
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
  tradeLicense?: string | undefined;
  dbid?: string | undefined;
  returns: {
    shopperRequests: boolean;
    windowDays: number;
    refundMethods: readonly string[];
    refundDeliveryFee: boolean;
  };
  zones: readonly {
    name: Record<Locale, string>;
    fee: number;
    estimate: Record<Locale, string> | null;
  }[];
  cod: boolean;
  online: boolean;
  /** The platform's abuse address, when the platform has set one. */
  abuseEmail?: string | undefined;
  platformName: string;
}

type Block = { h: string } | { p: string } | { ul: string[] };
type Values = Record<string, string>;

const REFUND_METHOD: Record<Locale, Record<string, string>> = {
  en: {
    gateway: 'back to the card or account you paid with',
    bkash: 'by bKash',
    cash: 'in cash',
    store_credit: 'as store credit',
  },
  bn: {
    gateway: 'যে কার্ড বা অ্যাকাউন্টে পরিশোধ করেছেন সেখানে',
    bkash: 'বিকাশে',
    cash: 'নগদে',
    store_credit: 'স্টোর ক্রেডিট হিসেবে',
  },
};

function contactLine(c: LegalContext, locale: Locale): string {
  const parts = [c.contactPhone, c.contactEmail].filter(Boolean);
  if (parts.length) return parts.join(locale === 'bn' ? ' বা ' : ' or ');
  return locale === 'bn'
    ? 'এই সাইটের যোগাযোগ পাতায় দেওয়া ঠিকানা'
    : 'the details on this site’s contact page';
}

function identity(c: LegalContext, locale: Locale): Block[] {
  const en = locale === 'en';
  const who = c.businessName ?? c.storeName;
  const lines = [
    c.address ? (en ? `Address: ${c.address}.` : `ঠিকানা: ${c.address}।`) : null,
    c.tradeLicense
      ? en
        ? `Trade license: ${c.tradeLicense}.`
        : `ট্রেড লাইসেন্স: ${c.tradeLicense}।`
      : null,
    c.dbid ? (en ? `Digital Business ID: ${c.dbid}.` : `ডিজিটাল বিজনেস আইডি: ${c.dbid}।`) : null,
  ].filter((l): l is string => l !== null);
  return [
    {
      p: en
        ? `This site is run by ${who}${c.businessName ? ` (${c.storeName})` : ''}. ${lines.join(' ')}`.trim()
        : `এই সাইটটি পরিচালনা করে ${who}${c.businessName ? ` (${c.storeName})` : ''}। ${lines.join(' ')}`.trim(),
    },
  ];
}

const TEMPLATES: Record<LegalKind, Record<Locale, (c: LegalContext, v: Values) => Block[]>> = {
  terms: {
    en: (c, v) => [
      { h: 'Who we are' },
      ...identity(c, 'en'),
      { h: 'Orders' },
      {
        p: 'An order is a request to buy. We confirm it by phone or message before we send it, and we may cancel it if an item is out of stock or the price shown was wrong; you pay nothing for a cancelled order.',
      },
      { h: 'Prices and payment' },
      {
        p: `Prices are in taka and include VAT where it applies. The delivery charge is shown before you place the order. You can pay ${v.payment}.`,
      },
      { h: 'Delivery and returns' },
      {
        p: 'Our delivery and returns pages say how long delivery takes, what it costs, and how to return an item.',
      },
      { h: 'Contact us' },
      {
        p: `For any question or complaint, contact ${v.contact}. We answer within two working days.`,
      },
    ],
    bn: (c, v) => [
      { h: 'আমরা কারা' },
      ...identity(c, 'bn'),
      { h: 'অর্ডার' },
      {
        p: 'অর্ডার হলো কেনার অনুরোধ। পাঠানোর আগে আমরা ফোন বা মেসেজে তা নিশ্চিত করি। পণ্য না থাকলে বা দেখানো দাম ভুল হলে আমরা অর্ডার বাতিল করতে পারি; বাতিল অর্ডারের জন্য আপনাকে কিছু দিতে হবে না।',
      },
      { h: 'দাম ও পরিশোধ' },
      {
        p: `দাম টাকায়, প্রযোজ্য হলে ভ্যাটসহ। অর্ডার দেওয়ার আগে ডেলিভারি চার্জ দেখানো হয়। আপনি ${v.payment} পরিশোধ করতে পারেন।`,
      },
      { h: 'ডেলিভারি ও রিটার্ন' },
      {
        p: 'ডেলিভারিতে কত দিন লাগে, খরচ কত এবং কীভাবে পণ্য ফেরত দেবেন, তা আমাদের ডেলিভারি ও রিটার্ন পাতায় লেখা আছে।',
      },
      { h: 'যোগাযোগ' },
      { p: `যেকোনো প্রশ্ন বা অভিযোগে যোগাযোগ করুন: ${v.contact}। আমরা দুই কর্মদিবসের মধ্যে উত্তর দিই।` },
    ],
  },
  privacy: {
    en: (c, v) => [
      { h: 'What we collect' },
      {
        p: 'Your name, phone number, delivery address and, if you give it, your email: what we need to deliver your order and to reach you about it. If you make an account, we keep your orders and saved addresses with it.',
      },
      { h: 'How we use it' },
      {
        p: 'To deliver your orders, to send you messages about them, and to answer you. We share your name, phone and address with the courier that delivers, and payments go through the payment company you choose. We don’t sell your data.',
      },
      { h: 'How long we keep it' },
      {
        p: 'Order records are kept as long as the law requires for sales and tax records. Messages we sent you are deleted after 90 days.',
      },
      { h: 'Your choices' },
      {
        p: `To see, correct or delete your personal data, contact ${v.contact}. We delete your name, phone, email and address from our records; the order amounts stay for our accounts.`,
      },
      { h: 'Who runs this site' },
      {
        p: `${c.businessName ?? c.storeName} decides how your data is used. The site runs on ${c.platformName}, which keeps the data on our behalf.${c.abuseEmail ? ` To report abuse, write to ${c.abuseEmail}.` : ''}`,
      },
    ],
    bn: (c, v) => [
      { h: 'আমরা কী তথ্য নিই' },
      {
        p: 'আপনার নাম, ফোন নম্বর, ডেলিভারির ঠিকানা এবং দিলে আপনার ইমেইল: অর্ডার পৌঁছাতে ও সে বিষয়ে আপনার সঙ্গে যোগাযোগ করতে যা দরকার। অ্যাকাউন্ট খুললে আপনার অর্ডার ও সংরক্ষিত ঠিকানা তার সঙ্গে থাকে।',
      },
      { h: 'আমরা তা কীভাবে ব্যবহার করি' },
      {
        p: 'আপনার অর্ডার পৌঁছাতে, সে বিষয়ে মেসেজ পাঠাতে এবং আপনাকে উত্তর দিতে। যে কুরিয়ার ডেলিভারি দেয় তাকে আপনার নাম, ফোন ও ঠিকানা দিই, আর পরিশোধ আপনার বেছে নেওয়া পেমেন্ট প্রতিষ্ঠানের মাধ্যমে হয়। আমরা আপনার তথ্য বিক্রি করি না।',
      },
      { h: 'কত দিন রাখি' },
      {
        p: 'বিক্রি ও করের হিসাবের জন্য আইন যত দিন বলে, অর্ডারের রেকর্ড তত দিন থাকে। আপনাকে পাঠানো মেসেজ ৯০ দিন পরে মুছে যায়।',
      },
      { h: 'আপনার অধিকার' },
      {
        p: `আপনার ব্যক্তিগত তথ্য দেখতে, ঠিক করতে বা মুছতে যোগাযোগ করুন: ${v.contact}। আমরা আমাদের রেকর্ড থেকে আপনার নাম, ফোন, ইমেইল ও ঠিকানা মুছে দিই; হিসাবের জন্য অর্ডারের টাকার অঙ্ক থাকে।`,
      },
      { h: 'এই সাইট কে চালায়' },
      {
        p: `আপনার তথ্য কীভাবে ব্যবহার হবে তা ঠিক করে ${c.businessName ?? c.storeName}। সাইটটি ${c.platformName}-এ চলে, যা আমাদের হয়ে তথ্য রাখে।${c.abuseEmail ? ` অপব্যবহারের অভিযোগ জানাতে লিখুন ${c.abuseEmail}।` : ''}`,
      },
    ],
  },
  returns: {
    en: (c, v) => [
      { h: 'Returning an item' },
      {
        p: c.returns.shopperRequests
          ? `You can ask to return an item within ${c.returns.windowDays} days of delivery, from your order’s tracking page or by contacting ${v.contact}. Items must be unused and in their packaging.`
          : `To return an item, contact ${v.contact} within ${c.returns.windowDays} days of delivery. Items must be unused and in their packaging.`,
      },
      { h: 'Refunds' },
      {
        p: `When the item reaches us and we have checked it, we refund you ${v.refunds}, within 10 days.${c.returns.refundDeliveryFee ? ' If the whole order comes back because of our mistake or a faulty item, the delivery charge is refunded too.' : ''}`,
      },
      { h: 'Damaged or wrong items' },
      {
        p: 'Tell us on the day of delivery, with a photo if you can. We pay for returning an item that was damaged, faulty or not what you ordered.',
      },
    ],
    bn: (c, v) => [
      { h: 'পণ্য ফেরত' },
      {
        p: c.returns.shopperRequests
          ? `ডেলিভারির ${c.returns.windowDays} দিনের মধ্যে অর্ডারের ট্র্যাকিং পাতা থেকে বা যোগাযোগ করে (${v.contact}) পণ্য ফেরতের অনুরোধ করতে পারেন। পণ্য অব্যবহৃত ও প্যাকেটে থাকতে হবে।`
          : `পণ্য ফেরত দিতে ডেলিভারির ${c.returns.windowDays} দিনের মধ্যে যোগাযোগ করুন: ${v.contact}। পণ্য অব্যবহৃত ও প্যাকেটে থাকতে হবে।`,
      },
      { h: 'টাকা ফেরত' },
      {
        p: `পণ্য আমাদের কাছে পৌঁছে পরীক্ষার পর ১০ দিনের মধ্যে আমরা ${v.refunds} টাকা ফেরত দিই।${c.returns.refundDeliveryFee ? ' আমাদের ভুল বা ত্রুটিপূর্ণ পণ্যের কারণে পুরো অর্ডার ফেরত এলে ডেলিভারি চার্জও ফেরত দেওয়া হয়।' : ''}`,
      },
      { h: 'নষ্ট বা ভুল পণ্য' },
      {
        p: 'ডেলিভারির দিনই জানান, পারলে ছবিসহ। নষ্ট, ত্রুটিপূর্ণ বা অর্ডারের সঙ্গে না মেলা পণ্য ফেরতের খরচ আমরা দিই।',
      },
    ],
  },
  delivery: {
    en: (c, v) => [
      { h: 'Where we deliver and what it costs' },
      ...(c.zones.length
        ? [{ ul: zoneLines(c, 'en') }]
        : [
            {
              p: 'We deliver across Bangladesh; the charge for your address is shown at checkout.',
            },
          ]),
      { h: 'How long it takes' },
      {
        p: 'We send your order once it is confirmed. Within the same city it arrives within 5 days, and elsewhere within 10 days. If it will be late, we tell you.',
      },
      { h: 'Paying' },
      { p: `You can pay ${v.payment}.` },
      { h: 'Questions' },
      { p: `Contact ${v.contact}.` },
    ],
    bn: (c, v) => [
      { h: 'কোথায় ডেলিভারি দিই ও খরচ কত' },
      ...(c.zones.length
        ? [{ ul: zoneLines(c, 'bn') }]
        : [{ p: 'আমরা সারা বাংলাদেশে ডেলিভারি দিই; আপনার ঠিকানার চার্জ চেকআউটে দেখানো হয়।' }]),
      { h: 'কত দিন লাগে' },
      {
        p: 'অর্ডার নিশ্চিত হলে আমরা পাঠিয়ে দিই। একই শহরের মধ্যে ৫ দিনের মধ্যে, অন্য জায়গায় ১০ দিনের মধ্যে পৌঁছায়। দেরি হলে আমরা জানাই।',
      },
      { h: 'পরিশোধ' },
      { p: `আপনি ${v.payment} পরিশোধ করতে পারেন।` },
      { h: 'প্রশ্ন' },
      { p: `যোগাযোগ করুন: ${v.contact}।` },
    ],
  },
};

function zoneLines(c: LegalContext, locale: Locale): string[] {
  return c.zones.map((z) => {
    const fee = format(money(z.fee), locale);
    const est = z.estimate?.[locale];
    return `${z.name[locale]}: ${fee}${est ? (locale === 'en' ? `, ${est}` : `, ${est}`) : ''}`;
  });
}

function payment(c: LegalContext, locale: Locale): string {
  const en = locale === 'en';
  const ways = [
    c.cod ? (en ? 'in cash on delivery' : 'ডেলিভারির সময় নগদে') : null,
    c.online ? (en ? 'online by card or mobile banking' : 'অনলাইনে কার্ড বা মোবাইল ব্যাংকিংয়ে') : null,
  ].filter((w): w is string => w !== null);
  if (!ways.length) return en ? 'as shown at checkout' : 'চেকআউটে দেখানো উপায়ে';
  return ways.join(en ? ' or ' : ' বা ');
}

function refunds(c: LegalContext, locale: Locale): string {
  const names = c.returns.refundMethods.map((m) => REFUND_METHOD[locale][m]).filter(Boolean);
  return (
    names.join(locale === 'en' ? ' or ' : ' বা ') ||
    (locale === 'en' ? 'the way you paid' : 'যেভাবে পরিশোধ করেছেন সেভাবে')
  );
}

const text = (t: string) => (t ? [{ type: 'text' as const, text: t }] : []);

/** The page's body, filled for this store, in one language. */
export function legalPageBody(kind: LegalKind, locale: Locale, c: LegalContext): RichTextDoc {
  const values: Values = {
    contact: contactLine(c, locale),
    payment: payment(c, locale),
    refunds: refunds(c, locale),
  };
  const blocks = TEMPLATES[kind][locale](c, values);
  return {
    type: 'doc',
    content: blocks.map((b) => {
      if ('h' in b)
        return { type: 'heading' as const, attrs: { level: 2 as const }, content: text(b.h) };
      if ('p' in b) return { type: 'paragraph' as const, content: text(b.p) };
      return {
        type: 'bulletList' as const,
        content: b.ul.map((item) => ({
          type: 'listItem' as const,
          content: [{ type: 'paragraph' as const, content: text(item) }],
        })),
      };
    }),
  };
}
