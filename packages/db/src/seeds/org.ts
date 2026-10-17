import { companyProfile, numberSequences, workCalendars } from '../schema/index';

import type { Seed } from './index';

/**
 * Company defaults (PLAN.md §4): profile row, a default Mon–Fri work calendar with Saturday and
 * Sunday off, and employee numbering EMP-0001. All editable in Settings; never overwritten.
 */
export const orgSeed: Seed = {
  key: 'org.defaults',
  description: 'Company profile, default work calendar, employee number sequence',
  run: async (db, ctx) => {
    await db
      .insert(companyProfile)
      .values({ name: ctx.tenantName, timezone: ctx.timezone })
      .onConflictDoNothing({ target: companyProfile.singleton });

    const existing = await db.select({ id: workCalendars.id }).from(workCalendars).limit(1);
    if (existing.length === 0) {
      await db.insert(workCalendars).values({
        name: 'Standard (Mon–Fri)',
        isDefault: true,
        workWeek: {
          mon: 'full',
          tue: 'full',
          wed: 'full',
          thu: 'full',
          fri: 'full',
          sat: 'off',
          sun: 'off',
        },
      });
    }

    await db
      .insert(numberSequences)
      .values({ key: 'employee', prefix: 'EMP-', nextValue: 1, padding: 4 })
      .onConflictDoNothing({ target: numberSequences.key });
  },
};
