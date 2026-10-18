import { eq } from 'drizzle-orm';

import { approvalFlows, shifts } from '../schema/index';

import type { Seed } from './index';

/**
 * A single example day shift, flagged `needs_review`: start/end, grace, break and OT thresholds are
 * the client's own rules (and their contracts), so HR must confirm or change them before
 * assigning it. Nobody is assigned automatically. Never overwrites edits.
 */
export const attendanceSeed: Seed = {
  key: 'attendance.defaults',
  description: 'Example day shift (needs review), manager approval flow for regularisation',
  run: async (db) => {
    await db
      .insert(shifts)
      .values({
        code: 'GENERAL',
        name: 'General (example — review)',
        startTime: '08:30',
        endTime: '17:00',
        breakMinutes: 60,
        breakAfterMinutes: 300,
        graceLateMinutes: 10,
        earlyLeaveGraceMinutes: 5,
        halfDayThresholdMinutes: 240,
        otAfterMinutes: 30,
        windowBeforeMinutes: 240,
        windowAfterMinutes: 360,
        needsReview: true,
      })
      .onConflictDoNothing({ target: shifts.code });
    const [flow] = await db
      .select()
      .from(approvalFlows)
      .where(eq(approvalFlows.module, 'attendance'));
    if (!flow) await db.insert(approvalFlows).values({ module: 'attendance', steps: ['manager'] });
  },
};
