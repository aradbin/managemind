// Stock counts (phase-8-plan §3.5): what's counted, the count's machine and
// its inputs. A count is applied as one adjustment per line with a
// difference, measured against what the ledger held when the line was
// counted, so sales during the count are neither undone nor counted twice.
import { z } from 'zod';
import { normalizeTag } from '../catalog/text';
import { defineMachine } from '../state-machine';
import { BACK_OFFICE_LIMITS } from './limits';
import { optionalNote } from './purchasing';

/**
 * `applying` holds a count over 500 lines while the queue applies it in
 * batches; a batch that keeps failing sends it back to `review`, marked.
 */
export const STOCK_COUNT_STATUSES = [
  'counting',
  'review',
  'applying',
  'applied',
  'cancelled',
] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

export type StockCountEvent = 'submit' | 'reopen' | 'apply' | 'finish' | 'fail' | 'cancel';

export const stockCountMachine = defineMachine<StockCountStatus, StockCountEvent>({
  name: 'stock_count',
  initial: 'counting',
  states: STOCK_COUNT_STATUSES,
  transitions: {
    counting: { submit: { to: 'review' }, cancel: { to: 'cancelled' } },
    review: {
      reopen: { to: 'counting' },
      apply: { to: 'applying', effects: ['apply_differences'] },
      cancel: { to: 'cancelled' },
    },
    applying: { finish: { to: 'applied' }, fail: { to: 'review' } },
  },
});

export const STOCK_COUNT_SCOPES = ['all', 'category', 'tag', 'variants'] as const;

/** What a count covers; its lines are created when it starts. */
export const stockCountScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('category'), categoryId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('tag'),
      tag: z.string().transform((s, ctx) => {
        const tag = normalizeTag(s);
        if (!tag) {
          ctx.addIssue({ code: 'custom', message: 'not a tag' });
          return z.NEVER;
        }
        return tag;
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('variants'),
      variantIds: z
        .array(z.uuid())
        .min(1)
        .max(BACK_OFFICE_LIMITS.linesPerCount)
        .transform((ids) => [...new Set(ids)]),
    })
    .strict(),
]);
export type StockCountScope = z.infer<typeof stockCountScope>;

export const stockCountInput = z
  .object({
    locationId: z.uuid().optional(),
    scope: stockCountScope,
    note: optionalNote(500),
  })
  .strict();
export type StockCountInput = z.infer<typeof stockCountInput>;

/** A counter's number for one line; null clears it (counted by mistake). */
export const countLineInput = z
  .object({ counted: z.int().min(0).max(BACK_OFFICE_LIMITS.maxQuantity).nullable() })
  .strict();
