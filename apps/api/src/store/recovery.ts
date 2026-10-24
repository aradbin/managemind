// Sales recovery on the store host (phase-6-plan §6.1): the page behind the
// SMS link to confirm or cancel a COD order. The code travels in the body,
// never the URL, so no log records it. 20 requests an hour per IP, and 5
// wrong codes lock the IP out for an hour; a wrong code, a used one and an
// expired one get the same answer.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { answerLink, linkView } from '@managemind/core';
import { AppError } from '@managemind/shared';
import { LINK_ANSWERS } from '@managemind/shared/orders';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { limiterFor, shopperIp, withShopStore } from './commerce';

const Host = z.object({ 'x-forwarded-host': z.string().min(1).max(253) });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const r = <const C extends Omit<Parameters<typeof createRoute>[0], 'tags'>>(config: C) =>
  createRoute({ ...config, tags: ['store'] } as C & { tags: string[] });

const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Code = z.object({ code: z.string().max(20) });

const LinkOrder = z
  .object({
    displayNumber: z.string(),
    locale: z.enum(['bn', 'en']),
    storeName: z.string(),
    items: z.array(
      z.object({
        title: Localized,
        optionLabels: z.array(Localized),
        quantity: z.number().int(),
      }),
    ),
    total: z.number().int(),
    codDue: z.number().int(),
    area: Localized.nullable(),
  })
  .openapi('ConfirmLinkOrder');

export const RECOVERY_STORE_ROUTES = {
  confirmView: r({
    method: 'post',
    path: '/v1/store/confirm/view',
    summary: 'The order behind an SMS confirmation link: no street, no phone (rate-limited)',
    request: { headers: Host, ...body(Code) },
    responses: {
      200: { content: { 'application/json': { schema: LinkOrder } }, description: 'Order' },
    },
  }),
  confirmAnswer: r({
    method: 'post',
    path: '/v1/store/confirm',
    summary:
      "Confirm or cancel from the SMS link. A risky phone's confirmation is noted, and the store calls first",
    request: {
      headers: Host,
      ...body(Code.extend({ action: z.enum(LINK_ANSWERS) })),
    },
    responses: {
      200: {
        content: {
          'application/json': {
            schema: z.object({ result: z.enum(['confirmed', 'noted', 'cancelled']) }),
          },
        },
        description: 'Answered',
      },
    },
  }),
} as const;

/** Runs `fn` under the IP's limit; a code that finds nothing counts toward the lockout. */
async function withCode<T>(
  c: Context<AppEnv>,
  fn: (run: Parameters<Parameters<typeof withShopStore>[1]>[0]) => Promise<T | null>,
): Promise<T> {
  const limiter = limiterFor(c);
  const ip = shopperIp(c);
  await limiter.check('confirm-link:ip', ip);
  const out = await withShopStore(c, (run) => fn(run));
  if (out === null) {
    await limiter.fail('confirm-link:ip', ip);
    throw new AppError('not_found', { detail: 'This link no longer works' });
  }
  return out;
}

export function registerRecovery(app: OpenAPIHono<AppEnv>): void {
  const R = RECOVERY_STORE_ROUTES;

  app.openapi(R.confirmView, (async (c: Context<AppEnv>) => {
    const { code } = Code.parse(await c.req.json());
    const view = await withCode(c, (run) => run((tx) => linkView(tx, code)));
    c.header('Cache-Control', 'no-store');
    return c.json(view, 200);
  }) as never);

  app.openapi(R.confirmAnswer, (async (c: Context<AppEnv>) => {
    const input = Code.extend({ action: z.enum(LINK_ANSWERS) }).parse(await c.req.json());
    const result = await withCode(c, (run) =>
      run(async (tx) => {
        try {
          return await answerLink(tx, input.code, input.action);
        } catch (e) {
          if (e instanceof AppError && e.code === 'not_found') return null;
          throw e;
        }
      }),
    );
    c.header('Cache-Control', 'no-store');
    return c.json({ result }, 200);
  }) as never);
}
