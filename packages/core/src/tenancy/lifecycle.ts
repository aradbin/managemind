// The store lifecycle (phase-1-plan §4.4, phase-5b-plan §3.1): suspend and
// reactivate since Phase 1; close, reopen before the purge, and purge, which
// only the purge job takes (§3.11).
import { schema } from '@managemind/db';
import { defineMachine } from '@managemind/shared';

export interface TransitionContext {
  reason?: string;
}

const needsReason = (c: TransitionContext) =>
  (c.reason?.trim().length ?? 0) >= 3 ? true : 'a reason is required';

export const tenantLifecycle = defineMachine<
  (typeof schema.TENANT_STATUSES)[number],
  'suspend' | 'reactivate' | 'close' | 'reopen' | 'purge',
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
    closed: {
      reopen: { to: 'active', guard: needsReason },
      purge: { to: 'purged' },
    },
  },
});
