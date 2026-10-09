// Every domain event and the zod schema of its payload. emit() refuses an
// event type that is not listed here or a payload that does not match it.
import { z } from 'zod';

export const EVENTS = {
  'tenant.seeded': z.object({ slug: z.string() }),
} as const;

export type EventType = keyof typeof EVENTS;
export type EventPayload<E extends EventType> = z.infer<(typeof EVENTS)[E]>;
