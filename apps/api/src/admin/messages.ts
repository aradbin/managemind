// Messages in the admin (phase-5a-plan §3.6–§3.9, §6.3): the delivery log
// and resending, the store's templates with a preview, and each staff
// member's own alert choices.
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addPushDevice,
  alertChoicesInput,
  getAlertChoices,
  listMessages,
  listPushDevices,
  listTemplates,
  messageListQuery,
  type OutboxEvent,
  previewTemplate,
  pushSubscriptionInput,
  pushTargets,
  removePushDevice,
  requeueMessage,
  resetTemplate,
  saveTemplate,
  setAlertChoices,
  settlePushTargets,
  templateInput,
} from '@managemind/core';
import { schema } from '@managemind/db';
import { sendPush } from '@managemind/providers/push';
import { AppError } from '@managemind/shared';
import { eq } from 'drizzle-orm';
import { notify, vapidKeys } from '../notifications';
import { inStore, type StaffEnv } from './context';

const r = <
  const C extends Omit<Parameters<typeof createRoute>[0], 'path' | 'tags'> & { path: string },
>(
  config: C,
) =>
  createRoute({ ...config, path: `/v1/admin${config.path}`, tags: ['admin'] } as C & {
    tags: string[];
  });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  200: { content: { 'application/json': { schema } }, description },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

const Message = z
  .object({
    id: z.uuid(),
    event: z.string(),
    channel: z.enum(['email', 'sms', 'push', 'whatsapp']),
    recipientType: z.enum(['shopper', 'staff']),
    recipient: z.string().openapi({ description: 'Masked without customers.read' }),
    orderId: z.uuid().nullable(),
    status: z.enum(['queued', 'sent', 'failed', 'skipped', 'waiting']),
    /** WhatsApp: what Meta last reported (phase-9-plan §3.2.4). */
    deliveryStatus: z.enum(['sent', 'delivered', 'read', 'failed']).nullable(),
    reason: z.string().nullable(),
    attempts: z.number().int(),
    provider: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Message');
const Template = z
  .object({
    event: z.string(),
    channel: z.enum(['email', 'sms', 'push']),
    locale: z.enum(['bn', 'en']),
    subject: z.string().nullable(),
    body: z.string(),
    custom: z.boolean(),
    variables: z.array(z.string()),
  })
  .openapi('MessageTemplate');
const Preview = z
  .object({
    subject: z.string(),
    body: z.string(),
    sms: z
      .object({
        encoding: z.enum(['gsm', 'unicode']),
        length: z.number().int(),
        parts: z.number().int(),
      })
      .nullable(),
  })
  .openapi('TemplatePreview');
const PushDevice = z
  .object({
    id: z.uuid(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi('PushDevice');
const AlertChoice = z
  .object({ event: z.string(), push: z.boolean(), email: z.boolean() })
  .openapi('AlertChoice');

export const MESSAGE_ROUTES = {
  messages: r({
    method: 'get',
    path: '/messages',
    summary: 'The delivery log, newest first (orders.read)',
    request: { query: messageListQuery },
    responses: json(z.array(Message), 'Messages'),
  }),
  resendMessage: r({
    method: 'post',
    path: '/messages/{id}/resend',
    summary: 'Send a failed message again (orders.write)',
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 202: { description: 'Queued' } },
  }),
  templates: r({
    method: 'get',
    path: '/templates',
    summary: "The store's templates, its own or the default (settings.read)",
    responses: json(z.array(Template), 'Templates'),
  }),
  previewTemplate: r({
    method: 'post',
    path: '/templates/preview',
    summary: 'A template filled with sample values, and its SMS parts',
    request: body(templateInput),
    responses: json(Preview, 'Preview'),
  }),
  saveTemplate: r({
    method: 'put',
    path: '/templates',
    summary: "Save the store's own wording (settings.write)",
    request: body(templateInput),
    responses: json(Template, 'Saved'),
  }),
  resetTemplate: r({
    method: 'delete',
    path: '/templates/{event}/{channel}/{locale}',
    summary: 'Back to the default wording (settings.write)',
    request: {
      params: z.object({
        event: z.string().max(40),
        channel: z.enum(['email', 'sms', 'push']),
        locale: z.enum(['bn', 'en']),
      }),
    },
    responses: { 204: { description: 'Reset' } },
  }),
  alerts: r({
    method: 'get',
    path: '/me/alerts',
    summary: 'Your alert choices in this store',
    responses: json(z.array(AlertChoice), 'Alert choices'),
  }),
  setAlerts: r({
    method: 'put',
    path: '/me/alerts',
    summary: 'Change your alert choices in this store',
    request: body(alertChoicesInput),
    responses: json(z.array(AlertChoice), 'Alert choices'),
  }),
  push: r({
    method: 'get',
    path: '/me/push',
    summary: "The platform's push key (null while push is off) and your devices in this store",
    responses: json(
      z.object({ publicKey: z.string().nullable(), devices: z.array(PushDevice) }),
      'Push',
    ),
  }),
  addPushDevice: r({
    method: 'post',
    path: '/me/push-devices',
    summary: "Save this browser's push subscription",
    request: body(pushSubscriptionInput),
    responses: json(PushDevice, 'Saved'),
  }),
  removePushDevice: r({
    method: 'delete',
    path: '/me/push-devices/{id}',
    summary: 'Remove one of your devices',
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: 'Removed' } },
  }),
  testPush: r({
    method: 'post',
    path: '/me/push-devices/test',
    summary: 'Send a test alert to your devices in this store',
    responses: json(z.object({ sent: z.number().int(), gone: z.number().int() }), 'Sent'),
  }),
} as const;

export function registerMessages(admin: OpenAPIHono<StaffEnv>): void {
  const R = MESSAGE_ROUTES;
  const actor = (c: { var: StaffEnv['Variables'] }) => c.var.staff.actor;
  admin.openapi(R.messages, async (c) =>
    c.json(await inStore(c, (tx) => listMessages(tx, actor(c), c.req.valid('query'))), 200),
  );
  admin.openapi(R.resendMessage, async (c) => {
    const { id } = c.req.valid('param');
    const event = await inStore(
      c,
      async (tx) => {
        const { eventId } = await requeueMessage(tx, actor(c), id);
        const o = schema.outbox;
        const [row] = await tx.db.select().from(o).where(eq(o.id, eventId));
        // The outbox keeps dispatched events for 7 days.
        if (!row) {
          throw new AppError('conflict', { detail: 'the event is too old to send again' });
        }
        return {
          id: row.id,
          tenantId: row.tenantId,
          eventType: row.eventType,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          payload: row.payload,
          requestId: row.requestId,
          createdAt: row.createdAt.toISOString(),
        } as OutboxEvent;
      },
      { write: true },
    );
    // Planning again sends only what is queued: this message.
    c.executionCtx.waitUntil(notify(c.env, c.executionCtx, event).catch(() => {}));
    return c.body(null, 202);
  });
  admin.openapi(R.templates, async (c) =>
    c.json(await inStore(c, (tx) => listTemplates(tx, actor(c))), 200),
  );
  admin.openapi(R.previewTemplate, async (c) =>
    c.json(previewTemplate(actor(c), c.req.valid('json')), 200),
  );
  admin.openapi(R.saveTemplate, async (c) =>
    c.json(
      await inStore(c, (tx) => saveTemplate(tx, actor(c), c.req.valid('json')), { write: true }),
      200,
    ),
  );
  admin.openapi(R.resetTemplate, async (c) => {
    const key = c.req.valid('param');
    await inStore(c, (tx) => resetTemplate(tx, actor(c), key), { write: true });
    return c.body(null, 204);
  });
  admin.openapi(R.push, async (c) =>
    c.json(
      {
        publicKey: vapidKeys(c.env)?.publicKey ?? null,
        devices: await inStore(c, (tx) => listPushDevices(tx, actor(c))),
      },
      200,
    ),
  );
  admin.openapi(R.addPushDevice, async (c) =>
    c.json(await inStore(c, (tx) => addPushDevice(tx, actor(c), c.req.valid('json'))), 200),
  );
  admin.openapi(R.removePushDevice, async (c) => {
    const { id } = c.req.valid('param');
    await inStore(c, (tx) => removePushDevice(tx, actor(c), id));
    return c.body(null, 204);
  });
  admin.openapi(R.testPush, async (c) => {
    const keys = vapidKeys(c.env);
    if (!keys) throw new AppError('feature_unavailable', { detail: 'Push is not set up yet' });
    const userId = actor(c).userId as string;
    const targets = await inStore(c, async (tx) => {
      await listPushDevices(tx, actor(c));
      return pushTargets(tx, userId);
    });
    const used: string[] = [];
    const gone: string[] = [];
    const message = {
      title: c.var.staff.user.locale === 'bn' ? 'পরীক্ষা' : 'Test alert',
      body:
        c.var.staff.user.locale === 'bn'
          ? 'এই ডিভাইসে নতুন অর্ডারের খবর আসবে।'
          : 'New orders will show up on this device.',
      url: '/',
      tag: 'test',
    };
    for (const t of targets) {
      const result = await sendPush(t, message, keys);
      if (result === 'sent') used.push(t.id);
      else if (result === 'gone') gone.push(t.id);
    }
    await inStore(c, (tx) => settlePushTargets(tx, used, gone));
    return c.json({ sent: used.length, gone: gone.length }, 200);
  });
  admin.openapi(R.alerts, async (c) =>
    c.json(await inStore(c, (tx) => getAlertChoices(tx, actor(c))), 200),
  );
  admin.openapi(R.setAlerts, async (c) =>
    c.json(await inStore(c, (tx) => setAlertChoices(tx, actor(c), c.req.valid('json'))), 200),
  );
}
