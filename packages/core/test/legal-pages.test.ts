// A store's legal pages from templates (phase-5b-plan §3.15): new stores'
// legal drafts follow their template, which is filled from the settings
// when shown; editing the text takes the page over.
import { permissionsOf } from '@managemind/shared';
import { richTextToPlainText } from '@managemind/shared/rich-text';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  createTenant,
  listPages,
  type OutboxEvent,
  pageForEditing,
  publishedPageBySlug,
  systemActor,
  type TenantTx,
  updatePage,
  updateStoreProfile,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let owner: Actor;
const run = <T>(fn: (tx: TenantTx) => Promise<T>, events?: OutboxEvent[]) =>
  withTenant(app, store, fn, events ? { afterCommit: (e) => void events.push(...e) } : {});
const lang = { locale: 'en' as const, fallback: 'bn' as const };
const platform = { platformName: 'managemind' };

beforeAll(async () => {
  app = await connectApp();
  const slug = `legal${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Tea & Co',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = {
    kind: 'user',
    userId: null,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: store,
    storeRole: 'owner',
  };
});
afterAll(() => app.end());

const pageOf = async (kind: string) =>
  (await run((tx) => listPages(tx, owner))).find((p) => p.kind === kind) as Awaited<
    ReturnType<typeof listPages>
  >[number];

describe('legal pages from templates', () => {
  it('follow their template, filled from the settings when shown', async () => {
    const returns = await pageOf('returns');
    expect(returns.followsTemplate).toBe(true);
    await run((tx) => updatePage(tx, owner, returns.id, { published: true }));
    const shown = async () => {
      const hit = await run((tx) =>
        publishedPageBySlug(tx, lang, returns.translations.en?.slug as string, platform),
      );
      if (!hit || !('found' in hit)) throw new Error('not found');
      return hit.found;
    };
    const first = await shown();
    expect(first.followsTemplate).toBe(true);
    expect(richTextToPlainText(first.body as never)).toContain('within 7 days of delivery');
    // A settings change shows at once.
    await run((tx) =>
      updateStoreProfile(tx, owner, {
        returns: { shopperRequests: true, windowDays: 10, refundMethods: ['cash'] },
      } as never),
    );
    expect(richTextToPlainText((await shown()).body as never)).toContain('within 10 days');
  });

  it('show the filled text in the editor, and stop following once edited', async () => {
    const terms = await pageOf('terms');
    const editing = await run((tx) => pageForEditing(tx, owner, terms.id, 'managemind'));
    expect(richTextToPlainText(editing.translations.en?.body as never)).toContain('Tea & Co');
    const body = {
      type: 'doc' as const,
      content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Ours' }] }],
    };
    const saved = await run((tx) =>
      updatePage(tx, owner, terms.id, { translations: { en: { title: 'Terms', body } } }),
    );
    expect(saved.followsTemplate).toBe(false);
    expect(saved.translations.en?.body).toEqual(body);
    // A page that doesn't follow its template is shown as written.
    const again = await run((tx) => pageForEditing(tx, owner, terms.id, 'managemind'));
    expect(again.translations.en?.body).toEqual(body);
  });
});
