// The browser events helper (phase-3-plan §3.10, phase-4-plan §3.16): page
// view, product view, add to cart, checkout started and purchase. Every
// event has an ID, which Phase 9's server-side Conversions API will reuse so
// Meta can de-duplicate; a purchase's ID is the order's.

export interface TrackerConfig {
  pixelId: string | null;
  ga4Id: string | null;
  /**
   * False when the store reports purchases to Meta from the server once
   * confirmed (phase-9-plan §3.1.6): the pixel then sends no Purchase, so
   * Meta counts each order once, and only real ones.
   */
  pixelPurchase?: boolean;
}

export interface ProductEvent {
  id: string;
  name: string;
  /** Poisha. */
  price: number;
}

type Fbq = ((...args: unknown[]) => void) & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const inject = (src: string) => {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
};

export const eventId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface CartItem {
  id: string;
  name: string;
  /** Poisha, per unit. */
  price: number;
  quantity: number;
}

const ga4Items = (items: readonly CartItem[]) =>
  items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    price: i.price / 100,
    quantity: i.quantity,
  }));

export type Tracker = ReturnType<typeof createTracker>;

export function createTracker(config: TrackerConfig) {
  return {
    load() {
      if (config.pixelId && !window.fbq) {
        const fbq: Fbq = (...args: unknown[]) => {
          fbq.queue?.push(args);
        };
        fbq.queue = [];
        fbq.loaded = true;
        fbq.version = '2.0';
        window.fbq = window._fbq = fbq;
        inject('https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', config.pixelId);
      }
      if (config.ga4Id && !window.gtag) {
        window.dataLayer = window.dataLayer ?? [];
        window.gtag = (...args: unknown[]) => {
          window.dataLayer?.push(args);
        };
        window.gtag('js', new Date());
        window.gtag('config', config.ga4Id, { send_page_view: false });
        inject(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4Id)}`);
      }
    },
    pageView() {
      const id = eventId();
      window.fbq?.('track', 'PageView', {}, { eventID: id });
      window.gtag?.('event', 'page_view', { event_id: id });
    },
    viewItem(product: ProductEvent) {
      const id = eventId();
      const value = product.price / 100;
      // The product's ID is the feed's item_group_id; its variants are the
      // feed's items, so the view is a product group (phase-9-plan §3.1.4).
      window.fbq?.(
        'track',
        'ViewContent',
        {
          content_ids: [product.id],
          content_type: 'product_group',
          content_name: product.name,
          value,
          currency: 'BDT',
        },
        { eventID: id },
      );
      window.gtag?.('event', 'view_item', {
        event_id: id,
        currency: 'BDT',
        value,
        items: [{ item_id: product.id, item_name: product.name, price: value }],
      });
    },
    addToCart(item: CartItem) {
      const id = eventId();
      const value = (item.price * item.quantity) / 100;
      window.fbq?.(
        'track',
        'AddToCart',
        {
          content_ids: [item.id],
          content_type: 'product',
          content_name: item.name,
          value,
          currency: 'BDT',
        },
        { eventID: id },
      );
      window.gtag?.('event', 'add_to_cart', {
        event_id: id,
        currency: 'BDT',
        value,
        items: ga4Items([item]),
      });
    },
    beginCheckout(items: readonly CartItem[], total: number) {
      const id = eventId();
      const value = total / 100;
      window.fbq?.(
        'track',
        'InitiateCheckout',
        { content_ids: items.map((i) => i.id), num_items: items.length, value, currency: 'BDT' },
        { eventID: id },
      );
      window.gtag?.('event', 'begin_checkout', {
        event_id: id,
        currency: 'BDT',
        value,
        items: ga4Items(items),
      });
    },
    /** The event ID is the order ID, for Phase 9's server-side de-duplication. */
    purchase(orderId: string, items: readonly CartItem[], total: number) {
      const value = total / 100;
      if (config.pixelPurchase !== false)
        window.fbq?.(
          'track',
          'Purchase',
          { content_ids: items.map((i) => i.id), content_type: 'product', value, currency: 'BDT' },
          { eventID: orderId },
        );
      window.gtag?.('event', 'purchase', {
        event_id: orderId,
        transaction_id: orderId,
        currency: 'BDT',
        value,
        items: ga4Items(items),
      });
    },
  };
}
