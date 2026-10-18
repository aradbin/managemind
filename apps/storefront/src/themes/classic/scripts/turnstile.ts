// Turnstile (phase-4-plan §3.15), loaded only by the pages that need it and
// only when the store's host has a site key. Checkout and sign-in share it.
import { add } from './shop';

type Api = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
};

export interface Check {
  /**
   * The token, waiting a little for the check to finish (a quick submit can
   * beat it); undefined if it doesn't.
   */
  token(): Promise<string | undefined>;
  /** Tokens are single-use: a fresh one for the next try. */
  reset(): void;
}

export function mountTurnstile(box: HTMLElement, siteKey: string, locale: string): Check {
  let token: string | undefined;
  let widget: string | undefined;
  const w = window as unknown as { turnstile?: Api; mmTurnstile?: () => void };
  w.mmTurnstile = () => {
    widget = w.turnstile?.render(box, {
      sitekey: siteKey,
      language: locale,
      appearance: 'interaction-only',
      callback: (t: string) => {
        token = t;
      },
      'expired-callback': () => {
        token = undefined;
      },
    });
  };
  const s = document.createElement('script');
  s.src =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=mmTurnstile';
  s.async = true;
  s.defer = true;
  add(document.head, s);
  return {
    token: async () => {
      const start = Date.now();
      while (!token && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 100));
      return token;
    },
    reset: () => {
      if (widget) w.turnstile?.reset(widget);
      token = undefined;
    },
  };
}
