import { eq } from 'drizzle-orm';

import { approvalFlows, leavePolicies, leaveTypes } from '../schema/index';

import type { Seed } from './index';

/**
 * Leave types every Sri Lankan employer needs, with a catch-all policy each.
 * Entitlements are deliberately **0 and flagged `needs_review`**: the statutory minimums (Shop &
 * Office Employees Act, Maternity Benefits Ordinance, etc.) and each client's contract terms must
 * be entered by HR — we do not guess law in code or seeds (CLAUDE.md). Never overwrites edits.
 */
const TYPES = [
  {
    code: 'ANNUAL',
    name: 'Annual leave',
    isPaid: true,
    unit: 'half_day',
    color: '#2563eb',
    sortOrder: 1,
  },
  {
    code: 'CASUAL',
    name: 'Casual leave',
    isPaid: true,
    unit: 'half_day',
    color: '#16a34a',
    sortOrder: 2,
  },
  {
    code: 'SICK',
    name: 'Sick / medical leave',
    isPaid: true,
    unit: 'half_day',
    color: '#dc2626',
    sortOrder: 3,
  },
  {
    code: 'MATERNITY',
    name: 'Maternity leave',
    isPaid: true,
    unit: 'day',
    color: '#db2777',
    sortOrder: 4,
    genderRestriction: 'female',
  },
  {
    code: 'NOPAY',
    name: 'No-pay leave',
    isPaid: false,
    unit: 'half_day',
    color: '#6b7280',
    sortOrder: 5,
    allowNegative: true,
  },
  {
    code: 'SHORT',
    name: 'Short leave',
    isPaid: true,
    unit: 'hour',
    color: '#ca8a04',
    sortOrder: 6,
  },
  {
    code: 'LIEU',
    name: 'Lieu leave',
    isPaid: true,
    unit: 'half_day',
    color: '#7c3aed',
    sortOrder: 7,
  },
] as const;

export const leaveSeed: Seed = {
  key: 'leave.defaults',
  description: 'Leave types, review-needed default policies, manager approval flow',
  run: async (db) => {
    for (const t of TYPES) {
      const [inserted] = await db
        .insert(leaveTypes)
        .values(t)
        .onConflictDoNothing({ target: leaveTypes.code })
        .returning();
      if (!inserted) continue; // existing type: leave HR's configuration alone
      await db.insert(leavePolicies).values({
        leaveTypeId: inserted.id,
        name: `${t.name} — everyone`,
        appliesTo: {},
        entitlement: '0',
        // No-pay and lieu leave are not pre-allocated: no-pay needs no balance, lieu is granted by adjustment.
        accrual: t.code === 'NOPAY' || t.code === 'LIEU' ? 'none' : 'upfront_yearly',
        prorationOnJoin: 'monthly',
        rounding: 'floor_half',
        eligibleAfterMonths: 0,
        carryForwardMax: '0',
        effectiveFrom: '2000-01-01',
        needsReview: t.code !== 'NOPAY',
      });
    }
    const [flow] = await db.select().from(approvalFlows).where(eq(approvalFlows.module, 'leave'));
    if (!flow) await db.insert(approvalFlows).values({ module: 'leave', steps: ['manager'] });
  },
};
