// The back office's limits (phase-8-plan §3), shared by the API, the admin
// and the imports. No imports from settings, which read them.
import { CATALOG_LIMITS } from '../catalog/limits';

export const BACK_OFFICE_LIMITS = {
  linesPerPurchaseOrder: 200,
  linesPerReceipt: 200,
  otherCosts: 10,
  phonesPerSupplier: 3,
  /** Lines of a stock count (§3.5). */
  linesPerCount: 2_000,
  /** Count lines applied per transaction; a larger count is applied through the queue. */
  countApplyBatch: 500,
  /** 1 crore taka: far above a real purchase line or expense. */
  maxAmount: CATALOG_LIMITS.maxPrice,
  maxQuantity: 1_000_000,
} as const;
