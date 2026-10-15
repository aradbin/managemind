// The description whitelist as a zod schema (phase-2-plan §3.5). Unknown
// node and mark types are refused; unknown attributes are dropped, so only
// what the renderer knows ever gets stored.
import { z } from 'zod';
import {
  type BulletList,
  isSafeHref,
  type OrderedList,
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

/**
 * Lists nest at most MAX_LIST_DEPTH deep. The levels are built one by one
 * from the deepest up rather than with z.lazy, so the schema isn't recursive:
 * the depth limit is structural, and the OpenAPI generator can describe it.
 */
function listLevel(depth: number): {
  bulletList: z.ZodType<BulletList>;
  orderedList: z.ZodType<OrderedList>;
} {
  const nested: ReturnType<typeof listLevel> | null =
    depth < MAX_LIST_DEPTH ? listLevel(depth + 1) : null;
  const item = z.object({
    type: z.literal('listItem'),
    content: z
      .array(nested ? z.union([paragraph, nested.bulletList, nested.orderedList]) : paragraph)
      .min(1)
      .max(50),
  });
  return {
    bulletList: z.object({
      type: z.literal('bulletList'),
      content: z.array(item).min(1).max(200),
    }),
    orderedList: z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.int().min(0).max(10_000).optional() }).optional(),
      content: z.array(item).min(1).max(200),
    }),
  };
}
const { bulletList, orderedList } = listLevel(1);

const block = z.union([paragraph, heading, bulletList, orderedList]);

export const richTextDoc = z
  .object({ type: z.literal('doc'), content: z.array(block).max(500).optional() })
  .superRefine((doc, ctx) => {
    if (richTextToPlainText(doc).length > CATALOG_LIMITS.descriptionText) {
      ctx.addIssue({
        code: 'custom',
        message: `at most ${CATALOG_LIMITS.descriptionText} characters`,
      });
    }
  })
  // One named schema in the OpenAPI document, referenced wherever a description appears.
  .meta({ id: 'RichTextDoc' }) satisfies z.ZodType<RichTextDoc>;
