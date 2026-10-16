// Fits the editor's ProseMirror JSON to the stored whitelist (phase-2-plan
// §3.5) before it is sent, so the API never refuses what the editor made.
// The editor's schema already has only the allowed nodes and marks; this
// handles what ProseMirror still allows and the API doesn't: a heading
// inside a list item, lists deeper than four levels, extra attributes
// (a link's target and rel), empty lists and text.
import {
  type Block,
  isSafeHref,
  type List,
  type ListItem,
  type Mark,
  type Paragraph,
  type RichTextDoc,
  type TextNode,
} from '@managemind/shared/rich-text';

const MAX_LIST_DEPTH = 4;

interface PmNode {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown> | null | undefined;
  marks?:
    | { type?: unknown; attrs?: Record<string, unknown> | null | undefined }[]
    | null
    | undefined;
  content?: PmNode[] | null | undefined;
}

function marksOf(node: PmNode): Mark[] {
  const out: Mark[] = [];
  for (const m of node.marks ?? []) {
    if (out.some((x) => x.type === m.type)) continue;
    if (m.type === 'bold' || m.type === 'italic') out.push({ type: m.type });
    else if (m.type === 'link' && typeof m.attrs?.href === 'string' && isSafeHref(m.attrs.href)) {
      out.push({ type: 'link', attrs: { href: m.attrs.href } });
    }
  }
  return out;
}

/** Text runs; anything inline that isn't text (a line break) becomes a space. */
function inline(nodes: readonly PmNode[] | null | undefined): TextNode[] {
  const out: TextNode[] = [];
  for (const node of nodes ?? []) {
    const text =
      node.type === 'text' && typeof node.text === 'string' ? node.text : node.type ? ' ' : '';
    if (!text) continue;
    const marks = node.type === 'text' ? marksOf(node) : [];
    out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
  }
  return out;
}

function paragraph(node: PmNode): Paragraph {
  const content = inline(node.content);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** Every text block inside `node`, as paragraphs: what a too-deep list flattens to. */
function flatten(node: PmNode): Paragraph[] {
  if (node.type === 'paragraph' || node.type === 'heading') return [paragraph(node)];
  return (node.content ?? []).flatMap(flatten);
}

function list(node: PmNode, depth: number): List | null {
  const items: ListItem[] = [];
  for (const item of node.content ?? []) {
    const content: ListItem['content'] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (depth < MAX_LIST_DEPTH) {
          const nested = list(child, depth + 1);
          if (nested) content.push(nested);
        } else content.push(...flatten(child));
      } else content.push(...flatten(child));
    }
    items.push({ type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] });
  }
  if (!items.length) return null;
  if (node.type === 'bulletList') return { type: 'bulletList', content: items };
  const start = node.attrs?.start;
  return typeof start === 'number' &&
    Number.isInteger(start) &&
    start !== 1 &&
    start >= 0 &&
    start <= 10_000
    ? { type: 'orderedList', attrs: { start }, content: items }
    : { type: 'orderedList', content: items };
}

export function toRichTextDoc(json: PmNode): RichTextDoc {
  const content: Block[] = [];
  for (const node of json.content ?? []) {
    if (node.type === 'heading') {
      const inner = inline(node.content);
      const level = node.attrs?.level === 3 ? 3 : 2;
      content.push(
        inner.length
          ? { type: 'heading', attrs: { level }, content: inner }
          : { type: 'heading', attrs: { level } },
      );
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const l = list(node, 1);
      if (l) content.push(l);
    } else content.push(...flatten(node));
  }
  // A document that is only an empty paragraph is empty.
  if (content.length === 1 && content[0]?.type === 'paragraph' && !content[0].content)
    return { type: 'doc', content: [] };
  return { type: 'doc', content };
}
