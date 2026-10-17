import { parseArgs } from 'node:util';

import { migrateTenants } from '@hr/control-db';
import { loadMigrations, TENANT_MIGRATIONS_DIR } from '@hr/db';

import { log, main, masterKey, openControl } from './lib';

/**
 * pnpm tenants:migrate [--tenant=<slug>] [--dry-run] [--concurrency=N] [--continue-on-error]
 * Applies packages/db migrations to every active tenant (CLAUDE.md Hard Rule 12).
 */
await main(async () => {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '1' },
      'continue-on-error': { type: 'boolean', default: false },
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
    return results.some((r) => r.status !== 'ok') ? 1 : 0;
  } finally {
    await sql.end();
  }
});
