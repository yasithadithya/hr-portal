import { findTenantBySlug, getTenantConnection } from '@hr/control-db';
import { connect } from '@hr/db';
import { seedDemo } from '@hr/db/demo';
import { today } from '@hr/shared/time';

import { log, main, masterKey, openControl } from './lib';

/**
 * pnpm seed:demo --tenant=<slug> [--employees=120] [--months=3] [--force]
 *
 * Fills a DEMO tenant with a realistic company (org, staff, shifts, 3 months of fingerprint
 * punches, approved leave, salaries, tax profiles, bank details). Refuses any tenant whose slug
 * does not contain "demo", "dev" or "staging", so it can never pollute a client's data.
 * Payroll runs are not generated: open a month in Payroll and click Calculate during the demo.
 */
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : process.argv.includes(`--${name}`) ? 'true' : undefined;
}

await main(async () => {
  const slug = arg('tenant');
  if (!slug)
    throw new Error(
      'Usage: pnpm seed:demo --tenant=<slug> [--employees=120] [--months=3] [--force]',
    );
  if (!/demo|dev|staging/.test(slug))
    throw new Error(
      `Refusing: "${slug}" doesn't look like a demo tenant (slug must contain demo, dev or staging)`,
    );
  const employees = Number(arg('employees') ?? 120);
  const months = Number(arg('months') ?? 3);
  if (!Number.isInteger(employees) || employees < 8 || employees > 5000)
    throw new Error('--employees must be 8–5000');
  if (!Number.isInteger(months) || months < 1 || months > 24)
    throw new Error('--months must be 1–24');

  const { sql: csql, db } = openControl();
  try {
    const tenant = await findTenantBySlug(db, slug);
    if (!tenant) throw new Error(`No tenant "${slug}"`);
    const conn = await getTenantConnection(db, tenant, masterKey());
    const sql = connect(conn.dbDirectUrl ?? conn.dbUrl, { max: 2 });
    try {
      const started = Date.now();
      const r = await seedDemo(sql, {
        employees,
        months,
        today: today(tenant.timezone),
        tz: tenant.timezone,
        force: arg('force') === 'true',
        log,
      });
      log(
        `✔ ${slug}: ${r.employees} employees, ${r.punches} punches, ${r.leaveRequests} leave requests, ${r.salaries} salaries in ${Math.round((Date.now() - started) / 1000)} s`,
      );
      log(
        '  Holidays are not generated (import the gazetted list). Payroll: open a month → Calculate.',
      );
    } finally {
      await sql.end();
    }
  } finally {
    await csql.end();
  }
});
