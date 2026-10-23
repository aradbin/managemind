// What the E2E flows share: the dev mailbox, signing in with a code, TOTP,
// the admin's own Bangla messages, and the axe check every screen gets.
import { createHmac } from 'node:crypto';
import { deflateSync, gzipSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { billingBn } from '../../apps/admin/src/i18n/billing-bn';
import { bn as baseBn } from '../../apps/admin/src/i18n/bn';
import { launchBn } from '../../apps/admin/src/i18n/launch-bn';
import { onlineStoreBn } from '../../apps/admin/src/i18n/online-store-bn';
import { ordersBn } from '../../apps/admin/src/i18n/orders-bn';
import { DEV_TOKEN } from './people';
import { API } from './urls';

// The base messages and the screens' own catalogs (apps/admin/src/i18n).
const bn = { ...baseBn, ...launchBn, ...billingBn, ...onlineStoreBn, ...ordersBn };
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
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`).join(' | ')}`,
    );
  expect(found, `accessibility on ${screen}`).toEqual([]);
}

/** Our JavaScript on a store page, compressed, stays under 50 KB (phase-3-plan §8). */
const SCRIPT_BUDGET = 50 * 1024;

/**
 * Astro inlines the theme's scripts into each page, so the budget is measured
 * on the rendered page: inline scripts plus any script files, gzipped. Meta's
 * and Google's tags load only after consent, and Turnstile only on the pages
 * that need it; they are not ours to count.
 */
export async function expectScriptBudget(page: Page, what: string): Promise<void> {
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script')]
      .filter((s) => !s.type || s.type === 'module' || s.type === 'text/javascript')
      .filter((s) => !s.src.startsWith('https://challenges.cloudflare.com/'))
      .map((s) => ({ src: s.src, text: s.textContent ?? '' })),
  );
  let bytes = 0;
  for (const s of scripts) {
    const body = s.src ? await (await page.request.get(s.src)).body() : Buffer.from(s.text);
    bytes += gzipSync(body, { level: 9 }).length;
  }
  expect(bytes, `JavaScript on ${what} (gzip bytes)`).toBeLessThan(SCRIPT_BUDGET);
}

/** A solid-colour PNG, for the image upload (the admin resizes it like a phone photo). */
export function pngImage(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const pixels = deflateSync(Buffer.concat(Array(height).fill(row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface NewStore {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  kind?: 'client' | 'demo' | 'test';
  /** Part of the plan's name as the list shows it; no plan when left out. */
  plan?: string;
  preset?: 'general' | 'fashion' | 'grocery';
}

/** Platform → New store, step by step on a phone, all at once on a desktop (phase-5b-plan §3.2). */
export async function createStore(page: Page, store: NewStore): Promise<void> {
  await page.goto(`${API}/platform`);
  await page.getByRole('link', { name: t('newStore.title') }).click();
  await expect(page.getByRole('heading', { name: t('newStore.title'), level: 1 })).toBeVisible();
  const next = async () => {
    const button = page.getByRole('button', { name: t('newStore.next') });
    if (await button.isVisible()) await button.click();
  };
  await page.getByLabel(t('store.name')).fill(store.name);
  await page.getByLabel(t('tenants.slug')).fill(store.slug);
  // "<slug>.<store domain> is free", whatever the store domain is here.
  const [before = '', after = ''] = t('newStore.slugFree', { host: '\u0000' }).split('\u0000');
  const literal = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(
    page.getByText(
      new RegExp(`^${literal(before)}${literal(store.slug)}\\.\\S+${literal(after)}$`),
    ),
  ).toBeVisible();
  if (store.kind) await page.getByLabel(t('newStore.kind')).selectOption(store.kind);
  await expectAccessible(page, 'new store');
  await next();
  await page.getByLabel(t('tenants.ownerEmail')).fill(store.ownerEmail);
  await page.getByLabel(t('tenants.ownerName')).fill(store.ownerName);
  await next();
  if (store.plan) {
    const select = page.getByRole('combobox', { name: t('subscription.plan'), exact: true });
    const value = await select
      .locator('option', { hasText: store.plan })
      .first()
      .getAttribute('value');
    await select.selectOption(value ?? '');
    await expect(page.getByLabel(t('newStore.billingDay'))).toBeVisible();
  }
  await next();
  if (store.preset) await page.getByLabel(t('newStore.preset')).selectOption(store.preset);
  await page.getByRole('button', { name: t('newStore.create') }).click();
  await expect(page.getByRole('heading', { name: store.name })).toBeVisible();
}
