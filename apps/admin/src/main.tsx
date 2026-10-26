// The admin app (phase-1-plan §7.3): TanStack Router with file-based routes
// in src/routes, TanStack Query for server state, and the admin's own
// translations. Latin text uses a self-hosted Inter and Bangla a self-hosted
// Noto Sans Bengali (ADR 0029); each downloads only for the glyphs on screen.
// Light or dark is set before anything renders (lib/theme.ts).
import './zod-config';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/600.css';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppError } from './components/app-error';
import { ToastProvider } from './components/toast';
import { initialLocale, LocaleProvider, loadLocale } from './i18n';
import { ApiError, queryClient } from './lib/api';
import { AuthError } from './lib/auth';
import { initTheme } from './lib/theme';
import { routeTree } from './routeTree.gen';
import { initSentry, rootErrorHandlers } from './sentry';

initTheme();
initSentry();

// The error screen is part of the entry chunk, so it shows even when a
// route's own chunk can't load.
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultErrorComponent: AppError,
});

// A session that ends mid-visit (expired, or signed out from another device)
// goes back to sign-in. First loads are handled by the routes' own guards.
function signedOut(error: unknown) {
  if (!((error instanceof ApiError || error instanceof AuthError) && error.status === 401)) return;
  const { pathname, href } = router.state.location;
  if (pathname === '/sign-in' || pathname === '/two-factor') return;
  queryClient.clear();
  void router.navigate({ to: '/sign-in', search: { redirect: href } });
}
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'error' && event.query.state.data) {
    signedOut(event.action.error);
  }
});
queryClient.getMutationCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'error') signedOut(event.action.error);
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
// The language's messages first (its own small chunk), then the app.
if (root)
  void loadLocale(initialLocale()).then(() => {
    createRoot(root, rootErrorHandlers).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </LocaleProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
