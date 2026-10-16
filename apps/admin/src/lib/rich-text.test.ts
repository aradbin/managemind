import { richTextDoc } from '@managemind/shared/catalog';
import { describe, expect, it } from 'vitest';
import { toRichTextDoc } from './rich-text';

const text = (t: string, marks?: object[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: object[]) => ({ type: 'paragraph', content });
const li = (...content: object[]) => ({ type: 'listItem', content });
const ul = (...items: object[]) => ({ type: 'bulletList', content: items });

describe('toRichTextDoc', () => {
  it('keeps what the whitelist allows and drops the editor’s extra attributes', () => {
    const doc = toRichTextDoc({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, id: 'x' }, content: [text('শাড়ি')] },
        p(
          text('সুতি', [{ type: 'bold' }]),
          text(' লিংক', [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com',
                target: '_blank',
                rel: 'noopener',
                class: null,
              },
            },
          ]),
        ),
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [li(p(text('এক')))] },
      ],
    });
    expect(doc).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('শাড়ি')] },
        p(
          text('সুতি', [{ type: 'bold' }]),
          text(' লিংক', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ),
        { type: 'orderedList', content: [li(p(text('এক')))] },
      ],
    });
    expect(richTextDoc.safeParse(doc).success).toBe(true);
  });

  it('fixes what ProseMirror allows and the API refuses', () => {
    let deep: object = ul(li(p(text('6'))));
    for (const n of [5, 4, 3, 2, 1]) deep = ul(li(p(text(String(n))), deep));
    const doc = toRichTextDoc({
      type: 'doc',
      content: [
        ul(li({ type: 'heading', attrs: { level: 3 }, content: [text('শিরোনাম')] })),
        p(
          text('a'),
          { type: 'hardBreak' },
          text('b', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        ),
        { type: 'bulletList', content: [] },
        deep,
      ],
    });
    expect(doc.content?.[0]).toEqual(ul(li(p(text('শিরোনাম')))));
    expect(doc.content?.[1]).toEqual(p(text('a'), text(' '), text('b')));
    expect(doc.content).toHaveLength(3);
    expect(richTextDoc.safeParse(doc).success).toBe(true);
  });

  it('treats a lone empty paragraph as empty', () => {
    expect(toRichTextDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual({
      type: 'doc',
      content: [],
    });
  });
});
