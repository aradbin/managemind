// Variants as option combinations (phase-2-plan §3.1). A variant is found by
// its options key, the sorted IDs of its option values, so regenerating the
// combinations after an edit keeps every variant whose combination survives.
import { CATALOG_LIMITS } from './limits';

/** The options key of a combination: value IDs sorted and joined. '' for a product without options. */
export const optionsKey = (valueIds: readonly string[]): string => [...valueIds].sort().join('.');

/**
 * Every combination of the options' values, in option order: for size [S, M]
 * and colour [Red], [[S, Red], [M, Red]]. One empty combination when there
 * are no options. Throws past the variant limit, so callers check
 * `combinationCount` first to report it.
 */
export function combinations<T>(options: readonly (readonly T[])[]): T[][] {
  if (combinationCount(options) > CATALOG_LIMITS.variantsPerProduct) {
    throw new RangeError(`More than ${CATALOG_LIMITS.variantsPerProduct} variants`);
  }
  return options.reduce<T[][]>(
    (acc, values) => acc.flatMap((combo) => values.map((value) => [...combo, value])),
    [[]],
  );
}

export const combinationCount = (options: readonly (readonly unknown[])[]): number =>
  options.reduce((n, values) => n * values.length, 1);
