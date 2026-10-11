// Phase 0 placeholder: proves the build, the hosting at /admin and the shared
// i18n. The real shell (TanStack Router, shadcn/ui, PWA) arrives in Phase 1.
import { type Locale, t } from '@managemind/shared/i18n';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initSentry, rootErrorHandlers } from './sentry';

initSentry();

const PLATFORM = 'managemind';

function App() {
  const [locale, setLocale] = useState<Locale>('bn');
  const [status, setStatus] = useState('…');

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json() as Promise<{ status: string; commit: string }>)
      .then((h) => setStatus(`${h.status} (${h.commit})`))
      .catch(() => setStatus('unreachable'));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <main
      style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: 16 }}
    >
      <h1>{t(locale, 'admin.title', { platform: PLATFORM })}</h1>
      <p>{t(locale, 'admin.placeholder')}</p>
      <p role="status">{t(locale, 'admin.api', { status })}</p>
      <button type="button" onClick={() => setLocale(locale === 'bn' ? 'en' : 'bn')}>
        {t(locale === 'bn' ? 'en' : 'bn', `common.language.${locale === 'bn' ? 'en' : 'bn'}`)}
      </button>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root, rootErrorHandlers).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
