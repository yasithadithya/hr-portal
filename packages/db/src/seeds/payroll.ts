import { eq } from 'drizzle-orm';

import {
  bankFileTemplates,
  payComponents,
  statutorySettings,
  taxTables,
  taxTableSlabs,
  type BankFileSpec,
} from '../schema/index';

import type { Seed } from './index';

/**
 * SAMPLE payroll configuration (user decision 2026-10-18: build with sample data, replace with the
 * pilot client's real figures later). Every row is flagged `needs_review` and the UI says so.
 * Rates follow PLAN.md §4 and MUST be checked against official EPF/ETF/IRD publications and the
 * client's accountant before any real payroll. Never overwrites existing configuration.
 */
type ComponentSeed = typeof payComponents.$inferInsert;

const sys = (c: Omit<ComponentSeed, 'calc' | 'isSystem'>): ComponentSeed => ({
  ...c,
  calc: 'system',
  isSystem: true,
});

const COMPONENTS: ComponentSeed[] = [
  sys({
    code: 'BASIC',
    name: 'Basic salary',
    kind: 'earning',
    isEpfApplicable: true,
    isEtfApplicable: true,
    isApitApplicable: true,
    isProrated: true,
    sortOrder: 1,
  }),
  {
    code: 'BUDGETARY_RELIEF',
    name: 'Budgetary relief allowance',
    kind: 'earning',
    calc: 'fixed',
    isEpfApplicable: true,
    isEtfApplicable: true,
    isApitApplicable: true,
    isProrated: true,
    sortOrder: 2,
  },
  {
    code: 'TRAVEL',
    name: 'Travelling allowance',
    kind: 'earning',
    calc: 'fixed',
    isApitApplicable: true,
    isProrated: true,
    sortOrder: 3,
  },
  {
    code: 'BONUS',
    name: 'Bonus',
    kind: 'earning',
    calc: 'variable',
    isApitApplicable: true,
    sortOrder: 5,
  },
  {
    code: 'ARREARS',
    name: 'Salary arrears',
    kind: 'earning',
    calc: 'variable',
    isEpfApplicable: true,
    isEtfApplicable: true,
    isApitApplicable: true,
    sortOrder: 6,
  },
  sys({ code: 'OT', name: 'Overtime', kind: 'earning', isApitApplicable: true, sortOrder: 7 }),
  sys({
    code: 'OT_HOLIDAY',
    name: 'Overtime (holiday / rest day)',
    kind: 'earning',
    isApitApplicable: true,
    sortOrder: 8,
  }),
  sys({
    code: 'NOPAY',
    name: 'No-pay',
    kind: 'deduction',
    isEpfApplicable: true,
    isEtfApplicable: true,
    isApitApplicable: true,
    sortOrder: 10,
  }),
  sys({ code: 'EPF_EE', name: 'EPF (employee)', kind: 'deduction', sortOrder: 20 }),
  sys({ code: 'EPF_ER', name: 'EPF (employer)', kind: 'employer_contribution', sortOrder: 21 }),
  sys({ code: 'ETF', name: 'ETF (employer)', kind: 'employer_contribution', sortOrder: 22 }),
  sys({ code: 'APIT', name: 'APIT', kind: 'deduction', sortOrder: 23 }),
  sys({ code: 'LOAN_RECOVERY', name: 'Loan recovery', kind: 'deduction', sortOrder: 30 }),
  sys({ code: 'SALARY_ADVANCE', name: 'Salary advance', kind: 'deduction', sortOrder: 31 }),
  {
    code: 'WELFARE',
    name: 'Welfare society',
    kind: 'deduction',
    calc: 'fixed',
    sortOrder: 40,
  },
  {
    code: 'OTHER_DEDUCTION',
    name: 'Other deduction',
    kind: 'deduction',
    calc: 'variable',
    sortOrder: 41,
  },
];

const SAMPLE_FROM = '2025-04-01';

/** PLAN.md §4 sample APIT Table 01 (monthly "rate less fixed amount" form). */
const APIT_SLABS: [string, string | null, string, string][] = [
  ['0', '150000', '0', '0'],
  ['150000', '233333', '6', '9000'],
  ['233333', '275000', '18', '37000'],
  ['275000', '316667', '24', '53500'],
  ['316667', '358333', '30', '72500'],
  ['358333', null, '36', '94000'],
];

const GENERIC_CSV: BankFileSpec = {
  delimiter: ',',
  includeHeader: true,
  lineEnding: 'crlf',
  columns: [
    { header: 'Employee No', field: 'employeeNo' },
    { header: 'Account Name', field: 'accountName' },
    { header: 'Account No', field: 'accountNo' },
    { header: 'Bank Code', field: 'bankCode' },
    { header: 'Branch Code', field: 'branchCode' },
    { header: 'Amount', field: 'amount', format: 'amount_2dp' },
    { header: 'Reference', field: 'reference' },
  ],
};

/** A SLIPS-like fixed-width layout — illustrative only; real banks publish their own specs. */
const SAMPLE_FIXED: BankFileSpec = {
  lineEnding: 'crlf',
  columns: [
    { value: '0000', width: 4 },
    { field: 'bankCode', width: 4, align: 'right', pad: '0' },
    { field: 'branchCode', width: 3, align: 'right', pad: '0' },
    { field: 'accountNo', width: 12, align: 'right', pad: '0' },
    { field: 'accountName', width: 20, format: 'upper' },
    { value: '23', width: 2 },
    { field: 'amount', width: 12, align: 'right', pad: '0', format: 'amount_cents' },
    { field: 'payDate', width: 6, format: 'date:YYMMDD' },
    { field: 'reference', width: 15 },
  ],
};

export const payrollSeed: Seed = {
  key: 'payroll.sample',
  description: 'SAMPLE pay components, statutory rates, APIT table and bank layouts (needs review)',
  run: async (db) => {
    await db
      .insert(payComponents)
      .values(COMPONENTS.map((c) => ({ ...c, needsReview: true })))
      .onConflictDoNothing({ target: payComponents.code });

    const [stat] = await db.select({ id: statutorySettings.id }).from(statutorySettings).limit(1);
    if (!stat) {
      await db.insert(statutorySettings).values({
        effectiveFrom: SAMPLE_FROM,
        epfEmployeeRate: '8',
        epfEmployerRate: '12',
        etfRate: '3',
        nopayDivisorMode: 'working_days',
        nopayBase: 'basic',
        otRateBase: 'basic',
        otDivisor: '240',
        otMultiplierNormal: '1.5',
        otMultiplierHoliday: '2',
        restDayOtAsHoliday: true,
        roundingMode: 'half_up',
        roundingScale: 2,
        needsReview: true,
        notes: 'Sample values — confirm with the client and current EPF/ETF rules before use.',
      });
    }

    const [table] = await db.select().from(taxTables).where(eq(taxTables.code, 'APIT_T1'));
    if (!table) {
      const [t] = await db
        .insert(taxTables)
        .values({
          code: 'APIT_T1',
          name: 'APIT Table 01 (sample)',
          method: 'slab_monthly',
          effectiveFrom: SAMPLE_FROM,
          needsReview: true,
          source:
            'Sample from a published payroll-compliance summary (PLAN.md §4). Check against the IRD official APIT tables.',
        })
        .returning();
      await db.insert(taxTableSlabs).values(
        APIT_SLABS.map(([from, to, rate, deduct]) => ({
          tableId: t!.id,
          fromAmount: from,
          toAmount: to,
          rate,
          deductAmount: deduct,
        })),
      );
    }

    await db
      .insert(bankFileTemplates)
      .values([
        {
          name: 'Generic CSV (sample)',
          bank: 'Any',
          format: 'csv' as const,
          spec: GENERIC_CSV,
          needsReview: true,
        },
        {
          name: 'SLIPS-style fixed width (sample)',
          bank: 'Sample',
          format: 'fixed_width' as const,
          spec: SAMPLE_FIXED,
          needsReview: true,
        },
      ])
      .onConflictDoNothing({ target: bankFileTemplates.name });
  },
};
