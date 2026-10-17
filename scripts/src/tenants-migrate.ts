import { parseArgs } from 'node:util';

import { findTenantBySlug, getTenantConnection, migrateTenants } from '@hr/control-db';
import { connect, loadMigrations, runSeeds, TENANT_MIGRATIONS_DIR, tenantDb } from '@hr/db';

import { log, main, masterKey, openControl } from './lib';

/**
 * pnpm tenants:migrate [--tenant=<slug>] [--dry-run] [--concurrency=N] [--continue-on-error] [--skip-seeds]
 * Applies packages/db migrations to every active tenant (CLAUDE.md Hard Rule 12).
 */
await main(async () => {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '1' },
      'continue-on-error': { type: 'boolean', default: false },
      'skip-seeds': { type: 'boolean', default: false },
    },
  });
  const { sql, db } = openControl();
  try {
    const results = await migrateTenants({
      db,
      masterKey: masterKey(),
      files: await loadMigrations(TENANT_MIGRATIONS_DIR),
      slug: values.tenant,
      dryRun: values['dry-run'],
      concurrency: Number(values.concurrency),
      continueOnError: values['continue-on-error'],
      log,
    });

    if (results.length === 0) log('No tenants to migrate.');
    for (const r of results) {
      const detail = values['dry-run']
        ? r.pending.length
          ? `pending: ${r.pending.join(', ')}`
          : 'up to date'
        : r.status === 'ok'
          ? r.applied.length
            ? `applied: ${r.applied.join(', ')}`
            : 'up to date'
          : (r.error ?? r.status);
      log(
        `${r.status === 'failed' ? '✖' : r.status === 'skipped' ? '…' : '✔'} ${r.slug}: ${detail}`,
      );
    }
    // Seeds are idempotent and keep system data (e.g. system roles) in line with code.
    if (!values['dry-run'] && !values['skip-seeds']) {
      for (const r of results.filter((x) => x.status === 'ok')) {
        const tenant = (await findTenantBySlug(db, r.slug))!;
        const conn = await getTenantConnection(db, tenant, masterKey());
        const tsql = connect(conn.dbDirectUrl, { max: 1 });
        try {
          await runSeeds(tenantDb(tsql));
          log(`✔ ${r.slug}: seeds up to date`);
        } finally {
          await tsql.end();
        }
      }
    }
    return results.some((r) => r.status !== 'ok') ? 1 : 0;
  } finally {
    await sql.end();
  }
});
