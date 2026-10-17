import { defineConfig } from 'drizzle-kit';

// Control-plane database schema. Migrations are forward-only SQL, reviewed by hand (CLAUDE.md Hard Rule 12).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.CONTROL_DATABASE_URL ?? '' },
});
