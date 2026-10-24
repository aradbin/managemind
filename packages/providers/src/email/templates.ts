// Staff emails in Bangla and English (phase-1-plan §5.7). Plain HTML with
// inline styles, which every mail client renders, plus a text version.
// Everything interpolated into HTML is escaped. Editable per-store
// templates for shopper emails arrive in Phase 5A.
import type { StoreRole } from '@managemind/shared';
import { formatDateTime, formatNumber, type Locale } from '@managemind/shared/i18n';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Fills {name} placeholders; `html` escapes each value. */
function fill(template: string, values: Record<string, string>, html: boolean): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) return match;
    return html ? escapeHtml(value) : value;
  });
}

interface Layout {
  locale: Locale;
  platformName: string;
  paragraphs: string[];
  values: Record<string, string>;
  /** Shown big and monospaced, e.g. a sign-in code. */
  code?: string;
  button?: { label: string; href: string };
  footer: string;
  /** The paragraphs are text from outside (a store's filled-in template), so all of it is escaped. */
  textParagraphs?: boolean;
}

function render(subjectTemplate: string, layout: Layout): RenderedEmail {
  const { values } = layout;
  const subject = fill(subjectTemplate, values, false);
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${
      layout.textParagraphs ? escapeHtml(fill(s, values, false)) : fill(s, values, true)
    }</p>`;
  const code = layout.code
    ? `<p style="margin:0 0 16px;font:700 28px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:4px">${escapeHtml(layout.code)}</p>`
    : '';
  const button = layout.button
    ? `<p style="margin:0 0 16px"><a href="${escapeHtml(layout.button.href)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1d4ed8;color:#ffffff;font-size:16px;text-decoration:none">${escapeHtml(layout.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151;word-break:break-all">${escapeHtml(layout.button.href)}</p>`
    : '';
  const [first = '', ...rest] = layout.paragraphs;
  const html = `<!doctype html>
<html lang="${layout.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:#111827;font-family:system-ui,'Noto Sans Bengali',Arial,sans-serif">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#374151">${escapeHtml(layout.platformName)}</p>
${p(first)}${code}${button}${rest.map(p).join('')}
<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#4b5563">${fill(layout.footer, values, true)}</p>
</div></body></html>`;
  const text = [
    ...[first, ...(layout.code ? [layout.code] : []), ...rest].map((s) => fill(s, values, false)),
    ...(layout.button ? [layout.button.href] : []),
    fill(layout.footer, values, false),
  ].join('\n\n');
  return { subject, html, text: `${text}\n` };
}

const ROLE_NAMES: Record<Locale, Record<StoreRole, string>> = {
  en: { owner: 'Owner', manager: 'Manager', staff: 'Staff', viewer: 'Viewer' },
  bn: { owner: 'মালিক', manager: 'ম্যানেজার', staff: 'কর্মী', viewer: 'দর্শক' },
};

const COPY = {
  en: {
    shopperSignInCode: {
      subject: 'Your {store} sign-in code',
      body: [
        'Use this code to sign in to your account at {store}. It works for {minutes} minutes.',
      ],
      footer:
        "If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.",
    },
    signInCode: {
      subject: 'Your {platform} sign-in code',
      body: ['Use this code to sign in to {platform}. It works for {minutes} minutes.'],
      footer:
        "If you didn't ask for this code, you can ignore this email. Nobody can sign in without it.",
    },
    invitation: {
      subject: '{inviter} invited you to {store} on {platform}',
      body: [
        '{inviter} invited you to help run {store} as {role}.',
        'The link works for {days} days. Sign in with this email address to accept.',
      ],
      button: 'Accept the invitation',
      footer: "If you weren't expecting this invitation, you can ignore this email.",
    },
    supportAccess: {
      subject: '{platform} support is working in {store}',
      body: [
        '{support} from {platform} support has {access} access to {store} until {until}.',
        'Reason: {reason}',
        "Everything support does is recorded in your store's activity log.",
      ],
      access: { viewer: 'read-only', manager: 'manager' },
      footer: "If you didn't ask for help, contact {platform} right away.",
    },
    domainProblem: {
      subject: '{domain} needs attention',
      body: [
        "{store}'s domain {domain} isn't working properly: {problem}",
        'Check the DNS record in Settings > Domains. Until it is fixed, shoppers may not reach your store at {domain}.',
      ],
      button: 'Open Domains',
      footer: 'You get this email because you own {store} on {platform}.',
    },
    welcomeOwner: {
      subject: '{store} is ready on {platform}',
      body: [
        'Your store {store} is set up on {platform}, and you are its owner.',
        'Sign in to the admin with this email address: {platform} sends a code each time, so there is no password to remember. The admin shows what is left to set up before your first order.',
        'Your store is at {storeUrl}.',
      ],
      button: 'Open the admin',
      footer: 'You get this email because {platform} created {store} for you.',
    },
    exportReady: {
      subject: 'Your {store} data is ready to download',
      body: [
        'The export of {store} from {platform} is ready: the products, orders, customers and settings as data files, spreadsheets for the main lists, and every image.',
        'It holds your shoppers’ names, phone numbers and addresses. Keep it safe and share it only with people who should see it.',
        'The link works until {expires}.',
      ],
      button: 'Download the export',
      footer: 'You get this email because you own {store} on {platform}.',
    },
    invoice: {
      issued: {
        subject: 'Invoice {number} from {platform}: {amount}',
        body: [
          'Your invoice {number} for {store} is ready: {amount}, due on {due}.',
          'You can see it, print it and find how to pay in the admin, under Settings → Plan and billing.',
        ],
      },
      due_soon: {
        subject: 'Invoice {number} is due on {due}',
        body: ['A reminder: invoice {number} for {store}, {amount}, is due on {due}.'],
      },
      due_today: {
        subject: 'Invoice {number} is due today',
        body: ['Invoice {number} for {store}, {amount}, is due today.'],
      },
      past_due: {
        subject: 'Invoice {number} is overdue',
        body: [
          'Invoice {number} for {store}, {amount}, was due on {due} and is not paid yet.',
          'If you have paid already, reply with the transaction reference and we will record it.',
        ],
      },
      final_notice: {
        subject: 'Final notice: {store} will be suspended on {suspend}',
        body: [
          'Invoice {number}, {amount}, is still unpaid. If it is not paid by {suspend}, {store} will be suspended: the store will show a maintenance page and the admin will be read-only.',
          'Paying lifts the suspension at once.',
        ],
      },
      suspend: {
        subject: '{store} is suspended for an unpaid invoice',
        body: [
          '{store} is suspended because invoice {number}, {amount}, is unpaid. Shoppers see a maintenance page.',
          'Pay from Settings → Plan and billing, and the store opens again at once.',
        ],
      },
      button: 'Open Plan and billing',
      footer: 'You get this email because you own {store} on {platform}.',
    },
  },
  bn: {
    shopperSignInCode: {
      subject: '{store}-এ সাইন ইনের কোড',
      body: ['{store}-এ আপনার অ্যাকাউন্টে সাইন ইন করতে এই কোডটি ব্যবহার করুন। এটি {minutes} মিনিট কাজ করবে।'],
      footer: 'আপনি এই কোড না চেয়ে থাকলে ইমেইলটি উপেক্ষা করুন। কোড ছাড়া কেউ সাইন ইন করতে পারবে না।',
    },
    signInCode: {
      subject: '{platform}-এ সাইন ইনের কোড',
      body: ['{platform}-এ সাইন ইন করতে এই কোডটি ব্যবহার করুন। এটি {minutes} মিনিট কাজ করবে।'],
      footer: 'আপনি এই কোড না চেয়ে থাকলে ইমেইলটি উপেক্ষা করুন। কোড ছাড়া কেউ সাইন ইন করতে পারবে না।',
    },
    invitation: {
      subject: '{inviter} আপনাকে {platform}-এ {store} দোকানে আমন্ত্রণ জানিয়েছেন',
      body: [
        '{inviter} আপনাকে {store} দোকান পরিচালনায় {role} হিসেবে যোগ দিতে আমন্ত্রণ জানিয়েছেন।',
        'লিংকটি {days} দিন কাজ করবে। আমন্ত্রণ গ্রহণ করতে এই ইমেইল ঠিকানা দিয়ে সাইন ইন করুন।',
      ],
      button: 'আমন্ত্রণ গ্রহণ করুন',
      footer: 'আপনি এই আমন্ত্রণ আশা না করে থাকলে ইমেইলটি উপেক্ষা করুন।',
    },
    supportAccess: {
      subject: '{platform} সাপোর্ট {store} দোকানে কাজ করছে',
      body: [
        '{platform} সাপোর্টের {support} {until} পর্যন্ত {store} দোকানে {access} প্রবেশাধিকার পেয়েছেন।',
        'কারণ: {reason}',
        'সাপোর্ট যা করে তার সবকিছু আপনার দোকানের কার্যক্রমের তালিকায় লেখা থাকে।',
      ],
      access: { viewer: 'শুধু দেখার', manager: 'ম্যানেজারের' },
      footer: 'আপনি সাহায্য না চেয়ে থাকলে এখনই {platform}-এর সাথে যোগাযোগ করুন।',
    },
    domainProblem: {
      subject: '{domain} ডোমেইনে সমস্যা',
      body: [
        '{store} দোকানের ডোমেইন {domain} ঠিকমতো কাজ করছে না: {problem}',
        'সেটিংস > ডোমেইন-এ DNS রেকর্ডটি দেখুন। ঠিক না হওয়া পর্যন্ত ক্রেতারা হয়তো {domain} দিয়ে আপনার দোকানে ঢুকতে পারবেন না।',
      ],
      button: 'ডোমেইন খুলুন',
      footer: 'আপনি {platform}-এ {store} দোকানের মালিক বলে এই ইমেইল পাচ্ছেন।',
    },
    welcomeOwner: {
      subject: '{platform}-এ {store} দোকান তৈরি',
      body: [
        '{platform}-এ আপনার দোকান {store} তৈরি হয়েছে, আর আপনি এর মালিক।',
        'এই ইমেইল ঠিকানা দিয়ে অ্যাডমিনে সাইন ইন করুন: {platform} প্রতিবার একটি কোড পাঠায়, তাই কোনো পাসওয়ার্ড মনে রাখতে হয় না। প্রথম অর্ডারের আগে কী কী বাকি, অ্যাডমিন তা দেখাবে।',
        'আপনার দোকানের ঠিকানা {storeUrl}।',
      ],
      button: 'অ্যাডমিন খুলুন',
      footer: '{platform} আপনার জন্য {store} দোকান তৈরি করেছে বলে এই ইমেইল পাচ্ছেন।',
    },
    exportReady: {
      subject: '{store}-এর ডেটা ডাউনলোডের জন্য তৈরি',
      body: [
        '{platform} থেকে {store}-এর এক্সপোর্ট তৈরি: পণ্য, অর্ডার, ক্রেতা ও সেটিংস ডেটা ফাইলে, প্রধান তালিকাগুলো স্প্রেডশিটে, আর সব ছবি।',
        'এতে আপনার ক্রেতাদের নাম, ফোন নম্বর ও ঠিকানা আছে। নিরাপদে রাখুন এবং শুধু যাদের দেখা উচিত তাদের সঙ্গে শেয়ার করুন।',
        'লিংকটি {expires} পর্যন্ত কাজ করবে।',
      ],
      button: 'এক্সপোর্ট ডাউনলোড করুন',
      footer: '{platform}-এ আপনি {store}-এর মালিক বলে এই ইমেইল পাচ্ছেন।',
    },
    invoice: {
      issued: {
        subject: '{platform}-এর ইনভয়েস {number}: {amount}',
        body: [
          '{store} দোকানের ইনভয়েস {number} তৈরি: {amount}, শেষ তারিখ {due}।',
          'অ্যাডমিনের সেটিংস → প্ল্যান ও বিল-এ এটি দেখতে, প্রিন্ট করতে ও কীভাবে টাকা দেবেন তা জানতে পারবেন।',
        ],
      },
      due_soon: {
        subject: 'ইনভয়েস {number}-এর শেষ তারিখ {due}',
        body: ['মনে করিয়ে দিচ্ছি: {store} দোকানের ইনভয়েস {number}, {amount}, শেষ তারিখ {due}।'],
      },
      due_today: {
        subject: 'ইনভয়েস {number}-এর শেষ তারিখ আজ',
        body: ['{store} দোকানের ইনভয়েস {number}, {amount}, আজকের মধ্যে দিতে হবে।'],
      },
      past_due: {
        subject: 'ইনভয়েস {number}-এর মেয়াদ পেরিয়েছে',
        body: [
          '{store} দোকানের ইনভয়েস {number}, {amount}, {due}-এর মধ্যে দেওয়ার কথা ছিল, এখনো দেওয়া হয়নি।',
          'আগেই দিয়ে থাকলে লেনদেনের রেফারেন্সসহ উত্তর দিন, আমরা লিখে রাখব।',
        ],
      },
      final_notice: {
        subject: 'শেষ নোটিশ: {suspend} তারিখে {store} সাময়িক বন্ধ হবে',
        body: [
          'ইনভয়েস {number}, {amount}, এখনো বাকি। {suspend}-এর মধ্যে না দিলে {store} সাময়িক বন্ধ হবে: দোকানে রক্ষণাবেক্ষণের পেজ দেখাবে, আর অ্যাডমিন শুধু দেখার জন্য খোলা থাকবে।',
          'টাকা দিলেই সঙ্গে সঙ্গে আবার চালু হবে।',
        ],
      },
      suspend: {
        subject: 'বাকি ইনভয়েসের জন্য {store} সাময়িক বন্ধ',
        body: [
          'ইনভয়েস {number}, {amount}, বাকি থাকায় {store} সাময়িক বন্ধ। ক্রেতারা রক্ষণাবেক্ষণের পেজ দেখছেন।',
          'সেটিংস → প্ল্যান ও বিল থেকে টাকা দিন, দোকান সঙ্গে সঙ্গে আবার খুলবে।',
        ],
      },
      button: 'প্ল্যান ও বিল খুলুন',
      footer: 'আপনি {platform}-এ {store} দোকানের মালিক বলে এই ইমেইল পাচ্ছেন।',
    },
  },
} as const satisfies Record<Locale, unknown>;

export interface SignInCodeEmail {
  locale: Locale;
  platformName: string;
  code: string;
  minutes: number;
}

export function signInCodeEmail(input: SignInCodeEmail): RenderedEmail {
  const copy = COPY[input.locale].signInCode;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    // Codes stay in Latin digits: they are typed into an input.
    code: input.code,
    values: { platform: input.platformName, minutes: formatNumber(input.locale, input.minutes) },
    footer: copy.footer,
  });
}

export interface ShopperSignInCodeEmail {
  locale: Locale;
  storeName: string;
  code: string;
  minutes: number;
}

/** A shopper's sign-in code (phase-4-plan §3.11), from the store, in the store's language. */
export function shopperSignInCodeEmail(input: ShopperSignInCodeEmail): RenderedEmail {
  const copy = COPY[input.locale].shopperSignInCode;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.storeName,
    paragraphs: [...copy.body],
    code: input.code,
    values: { store: input.storeName, minutes: formatNumber(input.locale, input.minutes) },
    footer: copy.footer,
  });
}

export interface InvitationEmail {
  locale: Locale;
  platformName: string;
  inviterName: string;
  storeName: string;
  role: StoreRole;
  link: string;
  days: number;
}

export function invitationEmail(input: InvitationEmail): RenderedEmail {
  const copy = COPY[input.locale].invitation;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    button: { label: copy.button, href: input.link },
    values: {
      platform: input.platformName,
      inviter: input.inviterName,
      store: input.storeName,
      role: ROLE_NAMES[input.locale][input.role],
      days: formatNumber(input.locale, input.days),
    },
    footer: copy.footer,
  });
}

export interface SupportAccessEmail {
  locale: Locale;
  platformName: string;
  supportName: string;
  storeName: string;
  role: 'viewer' | 'manager';
  reason: string;
  until: Date;
}

export function supportAccessEmail(input: SupportAccessEmail): RenderedEmail {
  const copy = COPY[input.locale].supportAccess;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    values: {
      platform: input.platformName,
      support: input.supportName,
      store: input.storeName,
      access: copy.access[input.role],
      reason: input.reason,
      until: formatDateTime(input.locale, input.until),
    },
    footer: copy.footer,
  });
}

export interface DomainProblemEmail {
  locale: Locale;
  platformName: string;
  storeName: string;
  domain: string;
  problem: string;
  link: string;
}

/** To a store's owners when the daily check finds their active domain broken (phase-3-plan §3.9). */
export function domainProblemEmail(input: DomainProblemEmail): RenderedEmail {
  const copy = COPY[input.locale].domainProblem;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    button: { label: copy.button, href: input.link },
    values: {
      platform: input.platformName,
      store: input.storeName,
      domain: input.domain,
      problem: input.problem,
    },
    footer: copy.footer,
  });
}

const MESSAGE_FOOTER: Record<Locale, string> = {
  en: 'You get this email because of your order at {store}. Reply to reach the store.',
  bn: '{store}-এ আপনার অর্ডারের জন্য এই ইমেইল পাঠানো হয়েছে। দোকানের সঙ্গে যোগাযোগ করতে উত্তর দিন।',
};

export interface StoreMessageEmail {
  locale: Locale;
  storeName: string;
  /** Already filled in (phase-5a-plan §3.7); escaped here. */
  subject: string;
  /** Filled in, plain text; paragraphs separated by blank lines. */
  body: string;
}

/**
 * A store's order, payment, return or refund email (phase-5a-plan §3.6), in
 * the same layout as the platform's emails, with the store's name on top.
 * The values were filled in plain (a shopper's name among them), so the
 * layout escapes the whole text, not only the values.
 */
export function storeMessageEmail(input: StoreMessageEmail): RenderedEmail {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return render(input.subject, {
    locale: input.locale,
    platformName: input.storeName,
    paragraphs,
    values: { store: input.storeName },
    footer: MESSAGE_FOOTER[input.locale],
    textParagraphs: true,
  });
}

/** For tests: every template's copy, per locale. */
export const TEMPLATE_COPY = COPY;

export interface WelcomeOwnerEmail {
  locale: Locale;
  platformName: string;
  storeName: string;
  adminUrl: string;
  storeUrl: string;
}

/** To a new store's owner (phase-5b-plan §3.2): where the admin and the store are. */
export function welcomeOwnerEmail(input: WelcomeOwnerEmail): RenderedEmail {
  const copy = COPY[input.locale].welcomeOwner;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    button: { label: copy.button, href: input.adminUrl },
    values: { platform: input.platformName, store: input.storeName, storeUrl: input.storeUrl },
    footer: copy.footer,
  });
}

export type InvoiceEmailKind =
  | 'issued'
  | 'due_soon'
  | 'due_today'
  | 'past_due'
  | 'final_notice'
  | 'suspend';

export interface InvoiceEmail {
  kind: InvoiceEmailKind;
  locale: Locale;
  platformName: string;
  storeName: string;
  number: string;
  /** Already formatted, e.g. "৳১,৫০০.০০". */
  amount: string;
  due: Date;
  link: string;
}

/** Our invoice and its reminders, to a store's owners (phase-5b-plan §3.7, §3.8). */
export function invoiceEmail(input: InvoiceEmail): RenderedEmail {
  const all = COPY[input.locale].invoice;
  const copy = all[input.kind];
  const suspend = new Date(input.due.getTime() + 14 * 86_400_000);
  const date = (d: Date) => formatDateTime(input.locale, d, { dateStyle: 'long' });
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    button: { label: all.button, href: input.link },
    values: {
      platform: input.platformName,
      store: input.storeName,
      number: input.number,
      amount: input.amount,
      due: date(input.due),
      suspend: date(suspend),
    },
    footer: all.footer,
  });
}

export interface ExportReadyEmail {
  locale: Locale;
  platformName: string;
  storeName: string;
  link: string;
  expires: Date;
}

/** A store export is ready (phase-5b-plan §3.10), to its owners. */
export function exportReadyEmail(input: ExportReadyEmail): RenderedEmail {
  const copy = COPY[input.locale].exportReady;
  return render(copy.subject, {
    locale: input.locale,
    platformName: input.platformName,
    paragraphs: [...copy.body],
    button: { label: copy.button, href: input.link },
    values: {
      platform: input.platformName,
      store: input.storeName,
      expires: formatDateTime(input.locale, input.expires, {
        dateStyle: 'long',
        timeStyle: 'short',
      }),
    },
    footer: copy.footer,
  });
}
