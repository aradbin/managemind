// Offers a reload when a new version has been deployed (phase-1-plan §7.3).
// The service worker caches the app shell only, so data is never stale.
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLocale } from '../i18n';
import { Button } from './ui/button';

export function UpdatePrompt() {
  const { t } = useLocale();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-20 z-50 flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 shadow-lg md:bottom-4 md:left-auto md:w-96"
    >
      <span className="text-sm">{t('update.available')}</span>
      <Button onClick={() => updateServiceWorker(true)}>{t('update.reload')}</Button>
    </div>
  );
}
