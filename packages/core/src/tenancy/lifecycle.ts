// The store lifecycle (phase-1-plan §4.4). Phase 1 exposes suspend and
// reactivate; close and purge are declared for Phase 5B.
import { schema } from '@managemind/db';
import { defineMachine } from '@managemind/shared';

export interface TransitionContext {
  reason?: string;
}

const needsReason = (c: TransitionContext) =>
  (c.reason?.trim().length ?? 0) >= 3 ? true : 'a reason is required';

export const tenantLifecycle = defineMachine<
  (typeof schema.TENANT_STATUSES)[number],
  'suspend' | 'reactivate' | 'close' | 'purge',
  TransitionContext
>({
  name: 'tenant',
  initial: 'active',
  states: schema.TENANT_STATUSES,
  transitions: {
    active: {
      suspend: { to: 'suspended', guard: needsReason },
      close: { to: 'closed', guard: needsReason },
    },
    suspended: {
      reactivate: { to: 'active' },
      close: { to: 'closed', guard: needsReason },
    },
    closed: { purge: { to: 'purged' } },
  },
});
