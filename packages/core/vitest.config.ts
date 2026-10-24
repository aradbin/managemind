import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    // CI runs every package's database tests at once on two cores, where
    // vitest's 5 s default is too tight for the heavier ones.
    testTimeout: 30_000,
  },
});
