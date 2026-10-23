// Every domain event and the zod schema of its payload. emit() refuses an
// event type that is not listed here or a payload that does not match it.
import { z } from 'zod';

const tenantStatus = z.enum(['active', 'suspended', 'closed', 'purged']);
const storeRole = z.enum(['owner', 'manager', 'staff', 'viewer']);
const catalogChange = z.enum(['created', 'updated', 'moved', 'deleted']);

export const EVENTS = {
  'tenant.seeded': z.object({ slug: z.string() }),
  'tenant.created': z.object({ slug: z.string(), name: z.string() }),
  /** Which of name, defaultLocale and profile changed. */
  'tenant.updated': z.object({
    fields: z.array(
      z.enum([
        'name',
        'defaultLocale',
        'profile',
        'tax',
        'storefront',
        'display',
        'checkout',
        'cod',
        'fraud',
        'returns',
        'notifications',
        'setup',
      ]),
    ),
  }),
  'tenant.status_changed': z.object({
    from: tenantStatus,
    to: tenantStatus,
    reason: z.string().optional(),
  }),
  // Phase 5B (phase-5b-plan §4): closing starts the export and removes the
  // store's custom domains; reopening restores neither by itself.
  'tenant.closed': z.object({ purgeAfter: z.iso.datetime() }),
  'tenant.reopened': z.object({}),
  'tenant.purged': z.object({ purgeId: z.uuid() }),
  /** A store export is ready (phase-5b-plan §3.10): its owners are emailed the link. */
  'tenant.exported': z.object({ jobId: z.uuid(), expiresAt: z.iso.datetime() }),
  'subscription.changed': z.object({ planCode: z.string(), status: z.string() }),
  'invoice.issued': z.object({ invoiceId: z.uuid(), number: z.string(), total: z.number().int() }),
  'invoice.paid': z.object({ invoiceId: z.uuid(), number: z.string() }),
  /** A dunning step reached (phase-5b-plan §3.8): the owners are emailed. */
  'invoice.reminder': z.object({
    invoiceId: z.uuid(),
    step: z.enum(['due_soon', 'due_today', 'past_due', 'final_notice', 'suspend']),
  }),
  'customer.anonymized': z.object({}),
  /** A store's gateway, SMS or email key was saved or removed: its health is checked again. */
  'credentials.changed': z.object({ kind: z.enum(['sslcommerz', 'sms', 'email']) }),
  // Custom domains (Phase 3); declared now so the KV host sync handles them.
  'tenant_domain.added': z.object({ hostname: z.string() }),
  'tenant_domain.updated': z.object({ hostname: z.string() }),
  'tenant_domain.removed': z.object({ hostname: z.string() }),
  // Membership changes. No consumer yet; they feed Phase 5A's notifications.
  'staff.invited': z.object({ invitationId: z.uuid(), role: storeRole }),
  'staff.joined': z.object({ userId: z.uuid(), role: storeRole }),
  'staff.role_changed': z.object({ userId: z.uuid(), from: storeRole, to: storeRole }),
  'staff.removed': z.object({ userId: z.uuid(), role: storeRole, left: z.boolean() }),
  // Catalog and inventory (phase-2-plan §5). Phase 3 purges cached pages on
  // them (ADR 0007); until then the consumer only acknowledges them.
  'catalog.product.created': z.object({}),
  /** Which parts changed: content, options, variants, prices, media, categories, … */
  'catalog.product.updated': z.object({ fields: z.array(z.string()).max(20) }),
  /** A sale window opens or closes later (phase-4-plan §3.14); the API queues each edge. */
  'catalog.sale_scheduled': z.object({
    productIds: z.array(z.uuid()).min(1).max(200),
    edges: z.array(z.iso.datetime()).min(1).max(400),
  }),
  'catalog.product.archived': z.object({}),
  'catalog.product.deleted': z.object({}),
  'catalog.category.changed': z.object({ change: catalogChange }),
  'catalog.collection.changed': z.object({ change: catalogChange }),
  'catalog.attribute.changed': z.object({ change: catalogChange }),
  'inventory.level.changed': z.object({
    variantIds: z.array(z.uuid()).min(1).max(500),
    reason: z.string(),
  }),
  /** Variants went in or out of stock (available crossed zero): purges their pages (phase-3-plan §3.2). */
  'inventory.availability.changed': z.object({
    productIds: z.array(z.uuid()).min(1).max(500),
  }),
  // Storefront content (phase-3-plan §4).
  /** `navigation`: the title, slug or publication changed, so every page's footer did. */
  'catalog.page.changed': z.object({ change: catalogChange, navigation: z.boolean() }),
  'theme.published': z.object({}),
  // Orders, payments, shipments, customers and promotions (phase-4-plan §4);
  // their messages go out from the outbox consumer (phase-5a-plan §3.6).
  'order.placed': z.object({
    number: z.number().int(),
    source: z.string(),
    total: z.number().int(),
  }),
  'order.confirmed': z.object({ number: z.number().int() }),
  'order.processing': z.object({ number: z.number().int() }),
  'order.completed': z.object({ number: z.number().int() }),
  'order.cancelled': z.object({
    number: z.number().int(),
    by: z.enum(['staff', 'platform', 'system', 'shopper']),
    /** An online payment that never came (phase-5a-plan §3.3): its own message. */
    reason: z.enum(['payment_expired']).optional(),
  }),
  'order.edited': z.object({ number: z.number().int(), total: z.number().int() }),
  'payment.recorded': z.object({
    orderId: z.uuid(),
    provider: z.string(),
    amount: z.number().int(),
  }),
  'payment.settled': z.object({
    orderId: z.uuid(),
    amount: z.number().int(),
    /** For staff (phase-5a-plan §3.5): a risky card, or money for an order already cancelled. */
    problem: z.enum(['risky', 'late']).optional(),
  }),
  'payment.voided': z.object({ orderId: z.uuid() }),
  'shipment.created': z.object({ orderId: z.uuid() }),
  'shipment.shipped': z.object({ orderId: z.uuid() }),
  'shipment.delivered': z.object({ orderId: z.uuid() }),
  'shipment.failed': z.object({ orderId: z.uuid() }),
  'shipment.returned': z.object({ orderId: z.uuid() }),
  // Returns and refunds (phase-5a-plan §3.12, §3.13): shopper messages and staff alerts.
  'return.requested': z.object({
    orderId: z.uuid(),
    number: z.number().int(),
    by: z.enum(['staff', 'shopper']),
    reason: z.string(),
  }),
  'return.approved': z.object({ orderId: z.uuid(), number: z.number().int() }),
  'return.rejected': z.object({ orderId: z.uuid(), number: z.number().int() }),
  'return.received': z.object({ orderId: z.uuid(), number: z.number().int() }),
  'refund.succeeded': z.object({
    orderId: z.uuid(),
    amount: z.number().int(),
    method: z.string(),
    /** For store credit: the code the shopper is told. */
    creditCode: z.string().optional(),
  }),
  /** What an order left of a store credit code, as a new code (§3.13). */
  'store_credit.issued': z.object({
    orderId: z.uuid(),
    amount: z.number().int(),
    creditCode: z.string(),
  }),
  'customer.created': z.object({}),
  'customer.updated': z.object({}),
  'promotion.changed': z.object({ change: catalogChange }),
} as const;

/** Events that change which hosts point at a store, or what they say (§4.3). */
export const HOST_EVENTS: readonly EventType[] = [
  'tenant.created',
  'tenant.updated',
  'tenant.status_changed',
  'tenant_domain.added',
  'tenant_domain.updated',
  'tenant_domain.removed',
];

export type EventType = keyof typeof EVENTS;
export type EventPayload<E extends EventType> = z.infer<(typeof EVENTS)[E]>;
