import { LOCALES } from '@managemind/shared/i18n';
import { describe, expect, it } from 'vitest';
import {
  invitationEmail,
  type RenderedEmail,
  signInCodeEmail,
  supportAccessEmail,
  TEMPLATE_COPY,
} from './templates';

const placeholders = (value: unknown): string[] =>
  [...JSON.stringify(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

const noLeftovers = (email: RenderedEmail) => {
  for (const part of [email.subject, email.html, email.text]) expect(part).not.toMatch(/\{\w+\}/);
};

describe('email templates', () => {
  it('use the same placeholders in Bangla and English', () => {
    for (const name of Object.keys(TEMPLATE_COPY.en) as (keyof typeof TEMPLATE_COPY.en)[]) {
      expect(placeholders(TEMPLATE_COPY.bn[name]), name).toEqual(
        placeholders(TEMPLATE_COPY.en[name]),
      );
    }
  });

  it.each(LOCALES)('render the sign-in code in %s', (locale) => {
    const email = signInCodeEmail({
      locale,
      platformName: 'managemind',
      code: '482913',
      minutes: 5,
    });
    noLeftovers(email);
    expect(email.html).toContain('482913');
    expect(email.text).toContain('482913');
    expect(email.html).toContain(`lang="${locale}"`);
    // The code never goes in the subject, which shows on lock screens.
    expect(email.subject).not.toContain('482913');
  });

  it('localises numbers but keeps codes in Latin digits', () => {
    const email = signInCodeEmail({
      locale: 'bn',
      platformName: 'managemind',
      code: '482913',
      minutes: 5,
    });
    expect(email.text).toContain('৫ মিনিট');
    expect(email.text).toContain('482913');
  });

  it.each(LOCALES)('render the invitation in %s, escaping names', (locale) => {
    const email = invitationEmail({
      locale,
      platformName: 'managemind',
      inviterName: 'Rahim <script>',
      storeName: 'Gadget & Co',
      role: 'manager',
      link: 'https://admin.example.test/invite#t=abc',
      days: 7,
    });
    noLeftovers(email);
    expect(email.html).toContain('Rahim &lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Gadget &amp; Co');
    expect(email.html).toContain('https://admin.example.test/invite#t=abc');
    expect(email.text).toContain('Rahim <script>');
    expect(email.text).toContain(locale === 'bn' ? 'ম্যানেজার' : 'Manager');
  });

  it.each(LOCALES)('render the support-access notice in %s', (locale) => {
    const email = supportAccessEmail({
      locale,
      platformName: 'managemind',
      supportName: 'Karim',
      storeName: 'Gadget Store',
      role: 'viewer',
      reason: 'The owner asked why an order is missing',
      until: new Date('2026-10-11T08:30:00Z'),
    });
    noLeftovers(email);
    expect(email.text).toContain('The owner asked why an order is missing');
    // 08:30 UTC is 14:30 in Dhaka.
    expect(email.text).toMatch(locale === 'bn' ? /২:৩০/ : /2:30/);
  });
});
