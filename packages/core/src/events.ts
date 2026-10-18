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
      ]),
    ),
  }),
  'tenant.status_changed': z.object({
    from: tenantStatus,
    to: tenantStatus,
    reason: z.string().optional(),
  }),
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
  // Orders, payments, shipments, customers and promotions (phase-4-plan §4).
  // No consumer acts on them yet; Phase 5A's notifications will.
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
  }),
  'order.edited': z.object({ number: z.number().int(), total: z.number().int() }),
  'payment.recorded': z.object({
    orderId: z.uuid(),
    provider: z.string(),
    amount: z.number().int(),
  }),
  'payment.settled': z.object({ orderId: z.uuid(), amount: z.number().int() }),
  'payment.voided': z.object({ orderId: z.uuid() }),
  'shipment.created': z.object({ orderId: z.uuid() }),
  'shipment.shipped': z.object({ orderId: z.uuid() }),
  'shipment.delivered': z.object({ orderId: z.uuid() }),
  'shipment.failed': z.object({ orderId: z.uuid() }),
  'shipment.returned': z.object({ orderId: z.uuid() }),
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
