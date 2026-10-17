import { defineConfig } from 'drizzle-kit';

// Tenant schema. Migrations are forward-only SQL, reviewed by hand (CLAUDE.md Hard Rule 12).
// `generate` needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['public'],
});
