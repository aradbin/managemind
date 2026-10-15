// The description whitelist as a zod schema (phase-2-plan §3.5). Unknown
// node and mark types are refused; unknown attributes are dropped, so only
// what the renderer knows ever gets stored.
import { z } from 'zod';
import {
  type Block,
  isSafeHref,
  type ListItem,
  type RichTextDoc,
  richTextToPlainText,
} from '../rich-text';
import { CATALOG_LIMITS } from './limits';

const MAX_LIST_DEPTH = 4;

const mark = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({
    type: z.literal('link'),
    attrs: z.object({
      href: z.string().trim().refine(isSafeHref, 'links must be http(s) or mailto'),
    }),
  }),
]);

const textNode = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z
    .array(mark)
    .max(3)
    .refine((marks) => new Set(marks.map((m) => m.type)).size === marks.length, 'repeated mark')
    .optional(),
});

const inline = z.array(textNode).max(1_000).optional();

const paragraph = z.object({ type: z.literal('paragraph'), content: inline });
const heading = z.object({
  type: z.literal('heading'),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: inline,
});

const listItem: z.ZodType<ListItem> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z
      .array(z.union([paragraph, bulletList, orderedList]))
      .min(1)
      .max(50),
  }),
);
const bulletList = z.object({
  type: z.literal('bulletList'),
  content: z.array(listItem).min(1).max(200),
});
const orderedList = z.object({
  type: z.literal('orderedList'),
  attrs: z.object({ start: z.int().min(0).max(10_000).optional() }).optional(),
  content: z.array(listItem).min(1).max(200),
});

const block = z.discriminatedUnion('type', [paragraph, heading, bulletList, orderedList]);

function listDepth(node: Block | ListItem, depth = 0): number {
  if (node.type === 'paragraph' || node.type === 'heading') return depth;
  const next = node.type === 'listItem' ? depth : depth + 1;
  return Math.max(next, ...node.content.map((child) => listDepth(child, next)));
}

export const richTextDoc = z
  .object({ type: z.literal('doc'), content: z.array(block).max(500).optional() })
  .superRefine((doc, ctx) => {
    if ((doc.content ?? []).some((b) => listDepth(b) > MAX_LIST_DEPTH)) {
      ctx.addIssue({ code: 'custom', message: `lists nest at most ${MAX_LIST_DEPTH} deep` });
    }
    if (richTextToPlainText(doc).length > CATALOG_LIMITS.descriptionText) {
      ctx.addIssue({
        code: 'custom',
        message: `at most ${CATALOG_LIMITS.descriptionText} characters`,
      });
    }
  }) satisfies z.ZodType<RichTextDoc>;
