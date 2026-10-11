import type { Locale } from '@managemind/shared/i18n';
import type { StoreContext } from './lib/store';

declare global {
  namespace Cloudflare {
    interface Env {
      API: Fetcher;
      ENVIRONMENT: string;
      STORE_DOMAIN: string;
      /** Git commit of the deployed build, set by CI. */
      COMMIT_SHA?: string;
      /** Sentry project DSN, set by CI; Sentry is off without it. */
      SENTRY_DSN?: string;
    }
  }
  namespace App {
    interface Locals {
      /** The store this request is for, or null if the host has none. */
      store: StoreContext | null;
      /** The host forwarded to the API. */
      host: string;
      /** Set when the dev store selector chose the store. */
      devStore: string | null;
      locale: Locale;
      requestId: string;
    }
  }
}
