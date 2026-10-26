// What a route shows when it fails, instead of the router's bare default
// (a few words on an empty dark page). A deploy replaces every hashed chunk,
// so a tab opened before it fails to load the next screen's code: that case
// reloads once onto the new version, without the service worker, which may
// still be serving the old one. It registers again on the next load.
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useLocale } from '../i18n';
import { Button } from './ui/button';

const KEY = 'mm.staleReload';

/** Chrome, Firefox and Safari's messages for a missing chunk, and Vite's for its CSS. */
export function isStaleBuild(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/.test(
      error.message,
    )
  );
}

async function reloadFresh(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // Reload anyway.
  }
  window.location.reload();
}

/** Whether this tab already reloaded for a new version in the last half minute. */
function reloadedJustNow(): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    sessionStorage.setItem(KEY, String(Date.now()));
    return Date.now() - at < 30_000;
  } catch {
    return true;
  }
}

// Decided once per error: StrictMode renders twice.
const decided = new WeakMap<object, boolean>();
function shouldRecover(error: unknown): boolean {
  if (!isStaleBuild(error)) return false;
  const key = error as Error;
  let recover = decided.get(key);
  if (recover === undefined) {
    recover = !reloadedJustNow();
    decided.set(key, recover);
  }
  return recover;
}

export function AppError({ error }: ErrorComponentProps) {
  const { t } = useLocale();
  // Once: if the new version fails too, the screen below stays.
  const recovering = shouldRecover(error);

  useEffect(() => {
    if (recovering) void reloadFresh();
  }, [recovering]);

  if (recovering) {
    return (
      <p role="status" className="p-6 text-center text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-lg font-semibold">{t('error.screen')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('error.generic')}</p>
      <Button onClick={() => void reloadFresh()}>{t('update.reload')}</Button>
    </div>
  );
}
