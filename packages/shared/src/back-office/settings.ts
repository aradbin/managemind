// The back office's settings (phase-8-plan §4), stored as `backOffice` in
// the store's settings JSON.
import { z } from 'zod';
import { BACK_OFFICE_LIMITS } from './limits';

export const backOfficeSettings = z
  .object({
    /**
     * A count whose differences are worth more than this (poisha) needs
     * catalog.cost to apply: an owner or manager (Q7).
     */
    countApprovalThreshold: z.int().min(0).max(BACK_OFFICE_LIMITS.maxAmount).default(5_000_00),
    /** Reorder brings a low variant back to this many times its threshold (§3.2). */
    reorderMultiple: z.int().min(1).max(10).default(2),
  })
  .strict();
export type BackOfficeSettings = z.infer<typeof backOfficeSettings>;
