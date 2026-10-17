import { parseArgs } from 'node:util';

import { CONTROL_MIGRATIONS_DIR } from '@hr/control-db';
import { loadMigrations, migrate } from '@hr/db';

import { log, main, openControl } from './lib';

/** pnpm control:migrate [--dry-run] — applies control-plane migrations (schema `platform`). */
await main(async () => {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const { sql } = openControl({ direct: true });
  try {
    const res = await migrate(sql, await loadMigrations(CONTROL_MIGRATIONS_DIR), {
      table: 'control',
      dryRun: values['dry-run'],
      log,
    });
    if (values['dry-run']) {
      log(
        res.pending.length
          ? `Pending:\n  ${res.pending.join('\n  ')}`
          : 'Control plane is up to date.',
      );
    } else {
      log(
        res.applied.length
          ? `✔ Applied ${res.applied.length} migration(s).`
          : 'Control plane is up to date.',
      );
    }
  } finally {
    await sql.end();
  }
});
