// The admin app (phase-1-plan §7.3): TanStack Router with file-based routes
// in src/routes, TanStack Query for server state, and the admin's own
// translations. Bangla uses a self-hosted Noto Sans Bengali.
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/600.css';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from './i18n';
import { queryClient } from './lib/api';
import { routeTree } from './routeTree.gen';
import { initSentry, rootErrorHandlers } from './sentry';

initSentry();

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root, rootErrorHandlers).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
