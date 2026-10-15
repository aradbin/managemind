// Product, category and collection descriptions: ProseMirror JSON limited to
// paragraphs, headings (2–3), bold, italic, lists and links (phase-2-plan §3.5).
// The API validates documents with `richTextDoc` (catalog/rich-text-schema.ts);
// this file has no zod, so the storefront can render without it.
//
// Also a small Markdown subset, both ways: the import and export columns use
// it, and so does the plain-text fallback editor if Bangla typing in the rich
// editor proves unreliable on Android.

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string } };
export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[] | undefined;
}
export interface Paragraph {
  type: 'paragraph';
  content?: TextNode[] | undefined;
}
export interface Heading {
  type: 'heading';
  attrs: { level: 2 | 3 };
  content?: TextNode[] | undefined;
}
export interface ListItem {
  type: 'listItem';
  content: (Paragraph | List)[];
}
export interface BulletList {
  type: 'bulletList';
  content: ListItem[];
}
export interface OrderedList {
  type: 'orderedList';
  attrs?: { start?: number | undefined } | undefined;
  content: ListItem[];
}
export type List = BulletList | OrderedList;
export type Block = Paragraph | Heading | List;
export interface RichTextDoc {
  type: 'doc';
  content?: Block[] | undefined;
}

export const emptyDoc = (): RichTextDoc => ({ type: 'doc', content: [] });

/** Only these schemes survive, in the schema and again in the renderer. */
export function isSafeHref(href: string): boolean {
  if (href.length > 2048) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

function renderText(node: TextNode): string {
  let html = escapeHtml(node.text);
  // Marks wrap from the inside out, so the first mark is the outermost tag.
  for (const mark of [...(node.marks ?? [])].reverse()) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
    else if (mark.type === 'link' && isSafeHref(mark.attrs.href)) {
      html = `<a href="${escapeHtml(mark.attrs.href)}" rel="nofollow noopener noreferrer">${html}</a>`;
    }
  }
  return html;
}

const renderInline = (content: TextNode[] = []): string =>
  content.map((n) => (n.type === 'text' ? renderText(n) : '')).join('');

function renderBlock(block: Block | ListItem): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${renderInline(block.content)}</p>`;
    case 'heading':
      return block.attrs.level === 3
        ? `<h3>${renderInline(block.content)}</h3>`
        : `<h2>${renderInline(block.content)}</h2>`;
    case 'bulletList':
      return `<ul>${block.content.map(renderBlock).join('')}</ul>`;
    case 'orderedList': {
      const start = block.attrs?.start;
      const attr = Number.isSafeInteger(start) && start !== 1 ? ` start="${start}"` : '';
      return `<ol${attr}>${block.content.map(renderBlock).join('')}</ol>`;
    }
    case 'listItem':
      return `<li>${block.content.map(renderBlock).join('')}</li>`;
    default:
      // A validated document never gets here; an unvalidated one renders nothing.
      return '';
  }
}

/**
 * Escaped HTML for a description. Every text is escaped, only whitelisted
 * tags are written, and links are checked again, so even a document that
 * skipped validation can't inject markup.
 */
export const renderRichText = (doc: RichTextDoc): string =>
  (doc.content ?? []).map(renderBlock).join('');

/** The text alone, blocks on separate lines: for search, SEO fallbacks and length limits. */
export function richTextToPlainText(doc: RichTextDoc): string {
  const lines: string[] = [];
  const walk = (block: Block | ListItem): void => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      lines.push((block.content ?? []).map((n) => n.text).join(''));
    } else {
      for (const child of block.content) walk(child);
    }
  };
  for (const block of doc.content ?? []) walk(block);
  return lines.join('\n').trim();
}

// ---- Markdown subset ------------------------------------------------------
// Lines: "## " and "### " headings, "- " or "* " bullets, "1. " numbered items,
// anything else a paragraph (a single newline starts a new one, as people
// expect in spreadsheet cells). Inline: **bold**, *italic*, [text](url) and
// backslash escapes. Lists are one level deep; nested items are flattened.

const INLINE_SPECIAL = /[\\*_[\]]/g;

function textToMarkdown(node: TextNode): string {
  let text = node.text.replace(INLINE_SPECIAL, (c) => `\\${c}`);
  for (const mark of [...(node.marks ?? [])].reverse()) {
    if (mark.type === 'bold') text = `**${text}**`;
    else if (mark.type === 'italic') text = `*${text}*`;
    else if (mark.type === 'link') text = `[${text}](${mark.attrs.href})`;
  }
  return text;
}

function inlineToMarkdown(content: TextNode[] = [], { blockStart = true } = {}): string {
  const text = content.map(textToMarkdown).join('');
  // A paragraph that starts like another block is escaped so it reads back the same.
  if (!blockStart) return text;
  return text.replace(/^(#{1,6} |[-+] )/, '\\$1').replace(/^(\d+)([.)] )/, '$1\\$2');
}

function listToMarkdown(list: List): string[] {
  const lines: string[] = [];
  let n = list.type === 'orderedList' ? (list.attrs?.start ?? 1) : 0;
  const walk = (item: ListItem) => {
    for (const child of item.content) {
      if (child.type === 'paragraph') {
        const marker = list.type === 'orderedList' ? `${n++}. ` : '- ';
        lines.push(`${marker}${inlineToMarkdown(child.content, { blockStart: false })}`);
      } else {
        for (const nested of child.content) walk(nested);
      }
    }
  };
  for (const item of list.content) walk(item);
  return lines;
}

export function richTextToMarkdown(doc: RichTextDoc): string {
  return (doc.content ?? [])
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
          return inlineToMarkdown(block.content);
        case 'heading':
          return `${'#'.repeat(block.attrs.level)} ${(block.content ?? []).map(textToMarkdown).join('')}`;
        default:
          return listToMarkdown(block).join('\n');
      }
    })
    .join('\n\n');
}

function sameMarks(a: Mark[] = [], b: Mark[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Parses inline Markdown into text nodes, merging neighbours with the same marks. */
export function parseInlineMarkdown(input: string, outer: Mark[] = []): TextNode[] {
  const nodes: TextNode[] = [];
  const push = (text: string, marks: Mark[]) => {
    if (!text) return;
    const last = nodes[nodes.length - 1];
    if (last && sameMarks(last.marks, marks)) last.text += text;
    else nodes.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
  };
  let buffer = '';
  let i = 0;
  // Finds the closing delimiter, skipping escaped characters.
  const findClose = (delim: string, from: number): number => {
    for (let j = from; j < input.length; j++) {
      if (input[j] === '\\') j++;
      else if (input.startsWith(delim, j)) return j;
    }
    return -1;
  };
  while (i < input.length) {
    const c = input[i] as string;
    if (c === '\\' && i + 1 < input.length && /[\\*_[\]()#+.\-!`>]/.test(input[i + 1] as string)) {
      buffer += input[i + 1];
      i += 2;
      continue;
    }
    if (input.startsWith('**', i)) {
      const close = findClose('**', i + 2);
      if (close > i + 2) {
        push(buffer, outer);
        buffer = '';
        for (const n of parseInlineMarkdown(input.slice(i + 2, close), [
          ...outer,
          { type: 'bold' },
        ])) {
          push(n.text, n.marks ?? []);
        }
        i = close + 2;
        continue;
      }
    }
    if (c === '*' || (c === '_' && !/[\p{L}\p{N}]/u.test(input[i - 1] ?? ''))) {
      const close = findClose(c, i + 1);
      if (close > i + 1 && (c === '*' || !/[\p{L}\p{N}]/u.test(input[close + 1] ?? ''))) {
        push(buffer, outer);
        buffer = '';
        for (const n of parseInlineMarkdown(input.slice(i + 1, close), [
          ...outer,
          { type: 'italic' },
        ])) {
          push(n.text, n.marks ?? []);
        }
        i = close + 1;
        continue;
      }
    }
    if (c === '[') {
      const close = findClose(']', i + 1);
      const link = close > i + 1 ? /^\(([^()\s]+)\)/.exec(input.slice(close + 1)) : null;
      if (link?.[1] && isSafeHref(link[1])) {
        push(buffer, outer);
        buffer = '';
        const href = link[1];
        const marks: Mark[] = [...outer, { type: 'link', attrs: { href } }];
        for (const n of parseInlineMarkdown(input.slice(i + 1, close), marks)) {
          push(n.text, n.marks ?? []);
        }
        i = close + 1 + link[0].length;
        continue;
      }
    }
    buffer += c;
    i++;
  }
  push(buffer, outer);
  return nodes;
}

const paragraph = (text: string): Paragraph => {
  const content = parseInlineMarkdown(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

/** The Markdown subset (or plain text) as a document. */
export function richTextFromMarkdown(input: string): RichTextDoc {
  const blocks: Block[] = [];
  let list: List | null = null;
  for (const raw of input.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    const heading = /^(#{2,3}) +(.*)$/.exec(line);
    const bullet = /^[-*+] +(.*)$/.exec(line);
    const ordered = /^(\d{1,4})[.)] +(.*)$/.exec(line);
    if (heading) {
      list = null;
      const content = parseInlineMarkdown(heading[2] ?? '');
      const level = heading[1] === '###' ? 3 : 2;
      blocks.push(
        content.length
          ? { type: 'heading', attrs: { level }, content }
          : { type: 'heading', attrs: { level } },
      );
    } else if (bullet || ordered) {
      const kind = bullet ? 'bulletList' : 'orderedList';
      if (!list || list.type !== kind) {
        list =
          kind === 'bulletList'
            ? { type: 'bulletList', content: [] }
            : { type: 'orderedList', attrs: { start: Number(ordered?.[1] ?? 1) }, content: [] };
        blocks.push(list);
      }
      list.content.push({
        type: 'listItem',
        content: [paragraph((bullet?.[1] ?? ordered?.[2]) as string)],
      });
    } else {
      list = null;
      blocks.push(paragraph(line));
    }
  }
  return { type: 'doc', content: blocks };
}
