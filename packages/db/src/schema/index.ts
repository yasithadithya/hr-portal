// Tenant database schema (Postgres `public` schema of each client's Supabase project).
// Every table must call `.enableRLS()` with no policies (CLAUDE.md Hard Rule 5); a test enforces it.
export * from './columns';
export * from './settings';
