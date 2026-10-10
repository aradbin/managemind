// Smoke tests against deployed (or local) Workers. Set STOREFRONT_URL and
// API_URL; EXPECT_ENVIRONMENT defaults to "preview" ("development" locally).
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
});
