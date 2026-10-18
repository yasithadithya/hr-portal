import { findTenantBySlug, upsertTenantSecrets } from '@hr/control-db';

import { log, main, masterKey, openControl, optionalEnv, requireEnv } from './lib';

/**
 * pnpm tenant:update-secrets --slug <slug>
 *
 * Stores rotated client credentials (Supabase DB URL / password, service-role key, anon key)
 * from env — TENANT_DB_URL, TENANT_DB_DIRECT_URL, TENANT_SUPABASE_URL, TENANT_ANON_KEY,
 * TENANT_SERVICE_ROLE_KEY — never from CLI arguments. Web-push keys are kept. Running API
 * instances pick the new values up within 60 s (registry cache).
 */
await main(async () => {
  const i = process.argv.indexOf('--slug');
  const slug = i > 0 ? process.argv[i + 1] : undefined;
  if (!slug) throw new Error('Usage: pnpm tenant:update-secrets --slug <slug>');
  const { sql, db } = openControl();
  try {
    const tenant = await findTenantBySlug(db, slug);
    if (!tenant) throw new Error(`No tenant "${slug}"`);
    await upsertTenantSecrets(
      db,
      tenant.id,
      {
        dbUrl: requireEnv('TENANT_DB_URL'),
        dbDirectUrl: optionalEnv('TENANT_DB_DIRECT_URL'),
        supabaseUrl: optionalEnv('TENANT_SUPABASE_URL'),
        anonKey: optionalEnv('TENANT_ANON_KEY'),
        serviceRoleKey: optionalEnv('TENANT_SERVICE_ROLE_KEY'),
      },
      masterKey(),
    );
    log(`✔ Secrets updated for ${slug}. Remove the TENANT_* values from your shell/.env now.`);
  } finally {
    await sql.end();
  }
});
