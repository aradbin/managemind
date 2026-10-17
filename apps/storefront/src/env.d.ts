import type { Locale } from '@managemind/shared/i18n';
import type { StoreContext } from './lib/store';

declare global {
  namespace Cloudflare {
    interface Env {
      API: Fetcher;
      /** The host-to-store map (ADR 0015); production only. */
      EDGE?: KVNamespace;
      /** Store files in R2 (product and theme images, ADR 0016), read for /media/*. */
      FILES: R2Bucket;
      ENVIRONMENT: string;
      STORE_DOMAIN: string;
      /** The bare store domain redirects to the platform's site. */
      PLATFORM_DOMAIN?: string;
      /** The admin's host: only it may frame the theme preview. */
      ADMIN_HOST?: string;
      /** "on" when pages can be purged (production with CF_STORE_TOKEN); the page cache needs it. */
      PAGE_CACHE?: string;
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
      /** The page's language: the path prefix's, or the store's default. */
      locale: Locale;
      /** Whether the path had a language prefix. */
      prefixed: boolean;
      requestId: string;
      /** The theme preview token, when this browser is in preview mode. */
      previewToken: string | null;
      /** The shopper's IP, forwarded to the API for search rate limits. */
      shopperIp: string;
    }
  }
}
