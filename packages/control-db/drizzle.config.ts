import { defineConfig } from 'drizzle-kit';

// Control-plane schema (Postgres schema `platform`). Forward-only, reviewed by hand.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['platform'],
});
