// The cart in Meta Shops' checkout URL (phase-9-plan §3.1.5):
// products=<content id>:<quantity>,… where the content ID is the feed's
// item ID, our variant's. Pure, so it is unit-tested.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cart Meta sent, at most 50 lines; anything malformed is skipped. */
export function metaCart(query: URLSearchParams): { variantId: string; quantity: number }[] {
  return (query.get('products') ?? '')
    .split(',')
    .map((part) => {
      const [id, qty] = decodeURIComponent(part).split(':');
      const quantity = Math.min(999, Math.max(1, Math.round(Number(qty ?? 1)) || 1));
      return { variantId: (id ?? '').trim().toLowerCase(), quantity };
    })
    .filter((l) => UUID.test(l.variantId))
    .slice(0, 50);
}
