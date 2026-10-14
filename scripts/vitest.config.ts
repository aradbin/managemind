import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['./platform/test-setup.ts'], fileParallelism: false },
});
