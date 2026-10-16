import { describe, expect, it } from 'vitest';
import { richTextDoc } from '../catalog/rich-text-schema';
import { PAGE_KINDS, pageCreate, suggestedPageBody } from './pages';
import { signPreviewToken, verifyPreviewToken } from './preview-token';

describe('static pages', () => {
  it('suggests headings for the fixed kinds, as a valid description', () => {
    for (const kind of PAGE_KINDS) {
      for (const locale of ['bn', 'en'] as const) {
        const body = suggestedPageBody(kind, locale);
        if (kind === 'custom') expect(body).toBeNull();
        else expect(richTextDoc.parse(body)).toEqual(body);
      }
    }
  });

  it('needs a title in at least one language', () => {
    expect(pageCreate.safeParse({ kind: 'about', translations: {} }).success).toBe(false);
    expect(
      pageCreate.parse({ kind: 'about', translations: { bn: { title: ' আমাদের কথা ' } } }),
    ).toMatchObject({
      published: false,
      translations: { bn: { title: 'আমাদের কথা' } },
    });
  });
});

describe('preview tokens', () => {
  const tenant = '01900000-0000-7000-8000-00000000000a';
  const now = new Date('2026-10-16T10:00:00Z');

  it('verify for 15 minutes', async () => {
    const { token, expiresAt } = await signPreviewToken(tenant, 'secret', now);
    expect(expiresAt).toBe('2026-10-16T10:15:00.000Z');
    expect(await verifyPreviewToken(token, 'secret', now)).toBe(tenant);
    expect(await verifyPreviewToken(token, 'secret', new Date('2026-10-16T10:14:59Z'))).toBe(
      tenant,
    );
    expect(await verifyPreviewToken(token, 'secret', new Date('2026-10-16T10:15:00Z'))).toBeNull();
  });

  it('refuse another secret, a changed store or garbage', async () => {
    const { token } = await signPreviewToken(tenant, 'secret', now);
    expect(await verifyPreviewToken(token, 'other', now)).toBeNull();
    const forged = token.replace(tenant, '01900000-0000-7000-8000-00000000000b');
    expect(await verifyPreviewToken(forged, 'secret', now)).toBeNull();
    expect(await verifyPreviewToken('nope', 'secret', now)).toBeNull();
  });
});
