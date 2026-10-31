// Meta Shops' checkout URL (phase-9-plan §3.1.5). Meta sends a shopper who
// taps "Checkout" in a Facebook or Instagram shop here, with the cart in the
// query: products=<variant id>:<quantity>,…, an optional coupon and
// cart_origin. The variants go into the cart through the same API as the
// product page, with prices and stock from the server; then checkout opens,
// or the cart when something couldn't be added, where its lines say why.
import { metaCart } from './meta-cart';
import { api, config, t } from './shop';

const status = document.querySelector<HTMLElement>('[data-meta-checkout]');
const { links } = config();

async function run() {
  const query = new URLSearchParams(location.search);
  const lines = metaCart(query);
  let complete = lines.length > 0;
  for (const line of lines) {
    try {
      await api('/cart/lines', { method: 'POST', body: line });
    } catch {
      complete = false;
    }
  }
  const coupon = query.get('coupon')?.trim().slice(0, 32);
  if (coupon) {
    try {
      await api('/cart/code', { method: 'PUT', body: { code: coupon } });
    } catch {
      // A code that doesn't apply is shown in the cart; the order can go on without it.
    }
  }
  location.replace(complete ? links.checkout : links.cart);
}

if (status) {
  run().catch(() => {
    status.textContent = t('cart.error');
  });
}
