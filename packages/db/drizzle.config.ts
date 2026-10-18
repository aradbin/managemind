import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  // The `app` schema (helper functions) is created by the hand-written
  // bootstrap migration, so drizzle-kit only manages these.
  schemaFilter: ['platform', 'ref', 'store'],
  // Roles are created by the bootstrap migration, not by drizzle-kit.
  entities: { roles: false },
  casing: 'snake_case',
});
