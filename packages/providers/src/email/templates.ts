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
}

function render(subjectTemplate: string, layout: Layout): RenderedEmail {
  const { values } = layout;
  const subject = fill(subjectTemplate, values, false);
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${fill(s, values, true)}</p>`;
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
  },
  bn: {
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

/** For tests: every template's copy, per locale. */
export const TEMPLATE_COPY = COPY;
