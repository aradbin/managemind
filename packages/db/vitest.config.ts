import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // All files share one database; run them one at a time.
    fileParallelism: false,
  },
});
