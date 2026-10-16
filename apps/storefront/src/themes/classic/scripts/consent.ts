// The consent banner and the tag loader (phase-3-plan §3.10). No Meta or
// Google script loads before the shopper agrees; "Accept" and "Reject" are
// equally easy. The choice is a first-party cookie read only here, kept six
// months. After consent, the tags load once the page has loaded, so they
// never compete with the page's own content.
import { createTracker } from './events';

const COOKIE = 'mm_consent';
const SIX_MONTHS = 180 * 86_400;

const banner = document.getElementById('mm-consent');
const config = document.getElementById('mm-tracking');

const choice = (): string | null =>
  /(?:^|;\s*)mm_consent=(granted|denied)/.exec(document.cookie)?.[1] ?? null;

function remember(value: 'granted' | 'denied') {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in Safari and Firefox
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=${SIX_MONTHS}; SameSite=Lax${secure}`;
}

function start() {
  if (!config) return;
  const tracker = createTracker({
    pixelId: config.dataset.pixel || null,
    ga4Id: config.dataset.ga4 || null,
  });
  const load = () => {
    tracker.load();
    tracker.pageView();
    const product = config.dataset.product ? JSON.parse(config.dataset.product) : null;
    if (product) tracker.viewItem(product);
  };
  if (document.readyState === 'complete') load();
  else addEventListener('load', load, { once: true });
}

if (banner && config) {
  const current = choice();
  if (current === 'granted') start();
  if (current === null) banner.hidden = false;
  banner.addEventListener('click', (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>('[data-consent]')?.dataset.consent;
    if (value !== 'granted' && value !== 'denied') return;
    remember(value);
    banner.hidden = true;
    if (value === 'granted') start();
  });
  for (const opener of document.querySelectorAll<HTMLElement>('[data-consent-open]')) {
    opener.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }
}
