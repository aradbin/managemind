// Smoke tests against deployed (or local) Workers. Set STOREFRONT_URL and
// API_URL; EXPECT_ENVIRONMENT defaults to "preview" ("development" locally).
// The flows (flows.spec.ts, catalog.spec.ts) also need E2E_RUN and DEV_TOKEN from the
// preview's seed step, and run at a phone and a desktop viewport.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a preinstalled Chromium when its
// version differs from this Playwright's (the cloud session's /opt/pw-browsers).
import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/wait-for-deploy.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    browserName: 'chromium',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.ts/ },
    // No retries: a second attempt would meet the first one's invitation,
    // authenticator and store, and fail for the wrong reason.
    {
      name: 'flows-phone',
      testMatch: /flows\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: 'flows-desktop',
      testMatch: /flows\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 1280, height: 800 } },
    },
    // Launch readiness (phase-5b-plan §10): onboarding, billing and closing,
    // with the launch super admin the seed made. Serial, so no retries.
    {
      name: 'launch-phone',
      testMatch: /launch\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: 'launch-desktop',
      testMatch: /launch\.spec\.ts/,
      retries: 0,
      use: { viewport: { width: 1280, height: 800 } },
    },
    // A shopper's flows on the demo stores (phase-3-plan §9); no seed needed.
    {
      name: 'storefront-phone',
      testMatch: /storefront\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
    {
      name: 'storefront-desktop',
      testMatch: /storefront\.spec\.ts/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    // The catalog flows (phase-2-plan §8) run on the same stores after the
    // Phase 1 flows, which suspend and reactivate them.
    {
      name: 'catalog-phone',
      testMatch: /catalog\.spec\.ts/,
      dependencies: ['flows-phone'],
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 20_000 },
    },
    {
      name: 'catalog-desktop',
      testMatch: /catalog\.spec\.ts/,
      dependencies: ['flows-desktop'],
      retries: 0,
      use: { viewport: { width: 1280, height: 800 }, actionTimeout: 20_000 },
    },
    // The online-store flows (phase-3-plan §9) on the same stores, after the catalog flows.
    {
      name: 'online-store-phone',
      testMatch: /online-store\.spec\.ts/,
      dependencies: ['catalog-phone'],
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 20_000 },
    },
    {
      name: 'online-store-desktop',
      testMatch: /online-store\.spec\.ts/,
      dependencies: ['catalog-desktop'],
      retries: 0,
      use: { viewport: { width: 1280, height: 800 }, actionTimeout: 20_000 },
    },
    // The orders, promotions and accounts flows (phase-4-plan §10), after the online-store flows.
    {
      name: 'orders-phone',
      testMatch: /orders\.spec\.ts/,
      dependencies: ['online-store-phone'],
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 20_000 },
    },
    {
      name: 'orders-desktop',
      testMatch: /orders\.spec\.ts/,
      dependencies: ['online-store-desktop'],
      retries: 0,
      use: { viewport: { width: 1280, height: 800 }, actionTimeout: 20_000 },
    },
    // The returns and refunds flows (phase-5a-plan §10), after the orders flows.
    {
      name: 'returns-phone',
      testMatch: /returns\.spec\.ts/,
      dependencies: ['orders-phone'],
      retries: 0,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 20_000 },
    },
    {
      name: 'returns-desktop',
      testMatch: /returns\.spec\.ts/,
      dependencies: ['orders-desktop'],
      retries: 0,
      use: { viewport: { width: 1280, height: 800 }, actionTimeout: 20_000 },
    },
  ],
});
