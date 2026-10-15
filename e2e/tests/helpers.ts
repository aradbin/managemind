// What the E2E flows share: the dev mailbox, signing in with a code, TOTP,
// the admin's own Bangla messages, and the axe check every screen gets.
import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { bn } from '../../apps/admin/src/i18n/bn';
import { DEV_TOKEN } from './people';
import { API } from './urls';

type Key = keyof typeof bn;

/** An admin message in Bangla, with {placeholders} filled. */
export function t(key: Key, params: Record<string, string> = {}): string {
  return bn[key].replace(/\{(\w+)\}/g, (m, name: string) => params[name] ?? m);
}

interface Mail {
  subject: string;
  text: string;
  createdAt: string;
}

async function mailbox(to: string): Promise<Mail[]> {
  const res = await fetch(`${API}/v1/_dev/mailbox?to=${encodeURIComponent(to)}`, {
    headers: DEV_TOKEN ? { 'x-dev-token': DEV_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`mailbox: ${res.status}`);
  return (await res.json()) as Mail[];
}

/** The newest email to `to` after `since` emails were already there. */
export async function nextMail(to: string, since: number): Promise<Mail> {
  for (let i = 0; i < 60; i++) {
    const mails = await mailbox(to);
    if (mails.length > since && mails[0]) return mails[0];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no new email for ${to}`);
}

export const mailCount = async (to: string) => (await mailbox(to)).length;

/** Signs in on a page already at /sign-in (or sent there). */
export async function signInHere(page: Page, email: string): Promise<void> {
  await page.getByLabel(t('signIn.email')).fill(email);
  const before = await mailCount(email);
  await page.getByRole('button', { name: t('signIn.send') }).click();
  const mail = await nextMail(email, before);
  const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
  if (!code) throw new Error('no code in the sign-in email');
  await page.getByLabel(t('signIn.code')).fill(code);
  await page.getByRole('button', { name: t('signIn.submit') }).click();
  // Signed in once the admin has moved on from the sign-in screen.
  await page.waitForURL((url) => url.pathname !== '/sign-in');
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${API}/sign-in`);
  await signInHere(page, email);
}

/** The current code for an otpauth secret (RFC 6238, SHA-1, 30 s, 6 digits). */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** No serious or critical WCAG 2.1 A/AA violations on what's on screen (phase-1-plan §7.3). */
export async function expectAccessible(page: Page, screen: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const found = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(found, `accessibility on ${screen}`).toEqual([]);
}
