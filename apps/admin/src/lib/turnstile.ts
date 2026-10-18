// Turnstile on staff sign-in (phase-4-plan §3.15). Cloudflare's script loads
// only when the build has a site key (VITE_TURNSTILE_SITE_KEY), so the
// sign-in bundle carries a few lines and nothing more.
import { useCallback, useEffect, useRef } from 'react';

const SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;

type Api = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
type TurnstileWindow = Window & { turnstile?: Api; mmTurnstile?: () => void };

let loading: Promise<Api> | undefined;
function load(): Promise<Api> {
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  loading ??= new Promise((resolve, reject) => {
    w.mmTurnstile = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile')));
    const s = document.createElement('script');
    s.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=mmTurnstile';
    s.async = true;
    s.onerror = () => {
      loading = undefined;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** How long a send waits for the check to finish before going without a token. */
const WAIT_MS = 5000;

/**
 * A ref for the widget's box, the token (waiting a little for the check to
 * finish, as a quick submit can beat it) and a reset for the next try.
 */
export function useTurnstile(locale: string) {
  const box = useRef<HTMLDivElement>(null);
  const token = useRef<string | undefined>(undefined);
  const widget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    const el = box.current;
    let gone = false;
    load()
      .then((api) => {
        if (gone) return;
        widget.current = api.render(el, {
          sitekey: SITE_KEY,
          language: locale,
          appearance: 'interaction-only',
          callback: (t: string) => {
            token.current = t;
          },
          'expired-callback': () => {
            token.current = undefined;
          },
        });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (widget.current) (window as TurnstileWindow).turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [locale]);

  const reset = useCallback(() => {
    if (widget.current) (window as TurnstileWindow).turnstile?.reset(widget.current);
    token.current = undefined;
  }, []);

  const read = useCallback(async () => {
    const start = Date.now();
    while (SITE_KEY && !token.current && Date.now() - start < WAIT_MS) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return token.current;
  }, []);

  return { box, token: read, reset };
}
