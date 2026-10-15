// Smoke tests against deployed (or local) Workers. Set STOREFRONT_URL and
// API_URL; EXPECT_ENVIRONMENT defaults to "preview" ("development" locally).
// The flows (flows.spec.ts) also need E2E_RUN and DEV_TOKEN from the
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
  ],
});
