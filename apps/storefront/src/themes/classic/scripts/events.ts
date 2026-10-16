// The browser events helper (phase-3-plan §3.10): page view and product view
// now; add to cart, checkout started and purchase in Phase 4. Every event has
// an ID, which Phase 9's server-side Conversions API will reuse so Meta can
// de-duplicate.

export interface TrackerConfig {
  pixelId: string | null;
  ga4Id: string | null;
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
      window.fbq?.(
        'track',
        'ViewContent',
        {
          content_ids: [product.id],
          content_type: 'product',
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
  };
}
