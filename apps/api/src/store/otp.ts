// A code by SMS before cash on delivery (phase-5a-plan §3.14, §6.1). Sending
// is behind Turnstile where it runs and 3 an hour per phone; checking allows
// 5 tries per code. A verified code gives a token checkout carries.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { orderSettings } from '@managemind/core';
import { AppError } from '@managemind/shared';
import { otpSendInput, otpVerifyInput } from '@managemind/shared/orders';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { sendOtp, smsGatewayFor, verifyOtp } from '../otp/index';
import { verifyTurnstile } from '../turnstile';
import { shopSiteKey } from '../turnstile-hosts';
import { limiterFor, shopperIp, withShopStore } from './commerce';

const Host = z.object({ 'x-forwarded-host': z.string().min(1).max(253) });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});
const r = <const C extends Omit<Parameters<typeof createRoute>[0], 'tags'>>(config: C) =>
  createRoute({ ...config, tags: ['store'] } as C & { tags: string[] });

export const OTP_ROUTES = {
  sendOtp: r({
    method: 'post',
    path: '/v1/store/checkout/otp',
    summary: 'Text a code to the phone (3 an hour; Turnstile where it runs)',
    request: { headers: Host, ...body(otpSendInput) },
    responses: { 204: { description: 'Sent' } },
  }),
  verifyOtp: r({
    method: 'post',
    path: '/v1/store/checkout/otp/verify',
    summary: 'Check the code; the token goes with the order (5 tries a code)',
    request: { headers: Host, ...body(otpVerifyInput) },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ otpToken: z.string() }) } },
        description: 'Verified',
      },
    },
  }),
} as const;

export function registerCheckoutOtp(app: OpenAPIHono<AppEnv>): void {
  app.openapi(OTP_ROUTES.sendOtp, (async (c: Context<AppEnv>) => {
    const input = otpSendInput.parse(await c.req.json());
    const locale = c.req.query('locale') === 'en' ? 'en' : 'bn';
    const host = c.req.header('x-forwarded-host') ?? '';
    const ip = shopperIp(c);
    await withShopStore(c, async (run, tenantId) => {
      const [gateway, siteKey, settings] = await run(
        async (tx) =>
          [
            await smsGatewayFor(tx, c.env),
            await shopSiteKey(c, tx),
            await orderSettings(tx),
          ] as const,
      );
      if (!gateway) throw new AppError('feature_unavailable', { detail: 'This store has no SMS' });
      const limiter = limiterFor(c);
      await limiter.check('otp-send:ip', ip);
      await limiter.check('otp-send:phone', `${tenantId}:${input.phone}`);
      if (siteKey)
        await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, input.turnstileToken, { host, ip });
      await sendOtp(c.env, gateway, tenantId, input.phone, settings.name, locale);
    });
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  }) as never);

  app.openapi(OTP_ROUTES.verifyOtp, (async (c: Context<AppEnv>) => {
    const input = otpVerifyInput.parse(await c.req.json());
    const result = await withShopStore(c, async (_run, tenantId) =>
      verifyOtp(c.env, tenantId, input.phone, input.code),
    );
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      throw new AppError('validation_failed', {
        fields: [{ path: 'code', code: result.reason, message: `the code is ${result.reason}` }],
      });
    }
    return c.json({ otpToken: result.token }, 200);
  }) as never);
}
