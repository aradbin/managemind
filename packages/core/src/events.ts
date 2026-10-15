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
    fields: z.array(z.enum(['name', 'defaultLocale', 'profile', 'tax'])),
  }),
  'tenant.status_changed': z.object({
    from: tenantStatus,
    to: tenantStatus,
    reason: z.string().optional(),
  }),
  // Custom domains (Phase 3); declared now so the KV host sync handles them.
  'tenant_domain.added': z.object({ hostname: z.string() }),
  'tenant_domain.updated': z.object({ hostname: z.string() }),
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
  'catalog.product.archived': z.object({}),
  'catalog.product.deleted': z.object({}),
  'catalog.category.changed': z.object({ change: catalogChange }),
  'catalog.collection.changed': z.object({ change: catalogChange }),
  'catalog.attribute.changed': z.object({ change: catalogChange }),
  'inventory.level.changed': z.object({
    variantIds: z.array(z.uuid()).min(1).max(500),
    reason: z.string(),
  }),
} as const;

/** Events that change which hosts point at a store, or what they say (§4.3). */
export const HOST_EVENTS: readonly EventType[] = [
  'tenant.created',
  'tenant.updated',
  'tenant.status_changed',
  'tenant_domain.added',
  'tenant_domain.updated',
];

export type EventType = keyof typeof EVENTS;
export type EventPayload<E extends EventType> = z.infer<(typeof EVENTS)[E]>;
