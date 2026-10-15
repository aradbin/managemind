import { describe, expect, it } from 'vitest';
import { richTextDoc } from './catalog/rich-text-schema';
import {
  type RichTextDoc,
  renderRichText,
  richTextFromMarkdown,
  richTextToMarkdown,
  richTextToPlainText,
} from './rich-text';

const doc = (...content: unknown[]) => ({ type: 'doc', content }) as RichTextDoc;
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, ...marks: unknown[]) =>
  marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };

const sample = doc(
  { type: 'heading', attrs: { level: 2 }, content: [text('বিবরণ')] },
  p(text('খাঁটি '), text('সুতি', { type: 'bold' }), text(' কাপড়, '), text('soft', { type: 'italic' })),
  {
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [p(text('Size M'))] },
      {
        type: 'listItem',
        content: [
          p(
            text('See '),
            text('the guide', { type: 'link', attrs: { href: 'https://example.test/g' } }),
          ),
        ],
      },
    ],
  },
  {
    type: 'orderedList',
    attrs: { start: 3 },
    content: [{ type: 'listItem', content: [p(text('Wash cold'))] }],
  },
);

describe('richTextDoc (whitelist)', () => {
  it('accepts the whitelist, including an empty document', () => {
    expect(richTextDoc.parse(sample)).toEqual(sample);
    expect(richTextDoc.parse({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [] });
    expect(
      richTextDoc.parse({ type: 'doc', content: [{ type: 'paragraph' }] }).content,
    ).toHaveLength(1);
  });

  it.each([
    ['an unknown node', doc({ type: 'image', attrs: { src: 'x' } })],
    ['a code block', doc({ type: 'codeBlock', content: [text('x')] })],
    ['a level 1 heading', doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] })],
    ['an unknown mark', doc(p(text('x', { type: 'underline' })))],
    [
      'a javascript: link',
      doc(p(text('x', { type: 'link', attrs: { href: 'javascript:alert(1)' } }))),
    ],
    ['a data: link', doc(p(text('x', { type: 'link', attrs: { href: 'data:text/html,<b>' } })))],
    ['a relative link', doc(p(text('x', { type: 'link', attrs: { href: '/admin' } })))],
    ['an empty text node', doc(p(text('')))],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
    [
      'a heading inside a list',
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 } }] }],
      }),
    ],
    ['too much text', doc(p(text('x'.repeat(20_001))))],
  ])('refuses %s', (_name, input) => {
    expect(richTextDoc.safeParse(input).success).toBe(false);
  });

  it('refuses lists nested too deep', () => {
    let list: unknown = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p(text('x'))] }],
    };
    for (let i = 0; i < 4; i++) {
      list = { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('x')), list] }] };
    }
    expect(richTextDoc.safeParse(doc(list)).success).toBe(false);
  });

  it('drops unknown attributes instead of storing them', () => {
    const parsed = richTextDoc.parse(
      doc({
        type: 'paragraph',
        attrs: { onclick: 'alert(1)', style: 'x' },
        content: [
          text('x', {
            type: 'link',
            attrs: { href: 'https://example.test', target: '_blank', onmouseover: 'alert(1)' },
          }),
        ],
      }),
    );
    expect(JSON.stringify(parsed)).not.toMatch(/onclick|onmouseover|style|target/);
  });
});

describe('renderRichText', () => {
  it('renders the whitelist as escaped HTML', () => {
    expect(renderRichText(sample)).toBe(
      '<h2>বিবরণ</h2>' +
        '<p>খাঁটি <strong>সুতি</strong> কাপড়, <em>soft</em></p>' +
        '<ul><li><p>Size M</p></li><li><p>See <a href="https://example.test/g" rel="nofollow noopener noreferrer">the guide</a></p></li></ul>' +
        '<ol start="3"><li><p>Wash cold</p></li></ol>',
    );
  });

  it('escapes text and attributes', () => {
    const html = renderRichText(
      doc(
        p(
          text('<script>alert("x")</script>', {
            type: 'link',
            attrs: { href: 'https://e.test/?a="><b>' },
          }),
        ),
      ),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe links and unknown nodes even without validation', () => {
    const html = renderRichText(
      doc(
        p(text('x', { type: 'link', attrs: { href: 'javascript:alert(1)' } })),
        { type: 'image', attrs: { src: 'https://e.test/a.png' } },
        { type: 'html', content: '<iframe>' },
      ),
    );
    expect(html).toBe('<p>x</p>');
  });
});

describe('plain text and Markdown', () => {
  it('extracts plain text, one line per block', () => {
    expect(richTextToPlainText(sample)).toBe(
      'বিবরণ\nখাঁটি সুতি কাপড়, soft\nSize M\nSee the guide\nWash cold',
    );
  });

  it('writes the Markdown subset', () => {
    expect(richTextToMarkdown(sample)).toBe(
      '## বিবরণ\n\nখাঁটি **সুতি** কাপড়, *soft*\n\n- Size M\n- See [the guide](https://example.test/g)\n\n3. Wash cold',
    );
  });

  it('round-trips through Markdown', () => {
    const md = richTextToMarkdown(sample);
    expect(richTextFromMarkdown(md)).toEqual(richTextDoc.parse(sample));
  });

  it('reads plain text from a spreadsheet cell, a paragraph per line', () => {
    expect(richTextFromMarkdown('Fabric: cotton\r\nSize: M\n\n')).toEqual(
      doc(p(text('Fabric: cotton')), p(text('Size: M'))),
    );
  });

  it('keeps literal characters that look like Markdown', () => {
    const tricky = doc(
      p(text('- not a list')),
      p(text('1. not numbered')),
      p(text('a *star* and snake_case_name [x]')),
      p(text('# not a heading')),
    );
    expect(richTextFromMarkdown(richTextToMarkdown(tricky))).toEqual(tricky);
    expect(richTextFromMarkdown('snake_case_name')).toEqual(doc(p(text('snake_case_name'))));
  });

  it('ignores unsafe Markdown links', () => {
    expect(richTextFromMarkdown('[x](javascript:alert(1))')).toEqual(
      doc(p(text('[x](javascript:alert(1))'))),
    );
  });

  it('output always passes the whitelist', () => {
    const parsed = richTextFromMarkdown('## T\n**b** _i_ [l](mailto:a@b.test)\n- a\n- b\n1. c');
    expect(richTextDoc.safeParse(parsed).success).toBe(true);
  });
});
