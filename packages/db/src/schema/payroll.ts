import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';
import { employees } from './employees';

/**
 * Payroll (PLAN.md Phase 7). Every statutory number is effective-dated configuration, seeded with
 * SAMPLE values flagged `needs_review` (the pilot client's accountant confirms them). The engine is
 * the pure `@hr/payroll` package; these tables feed it and store its results.
 */
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 7, scale: 4 });

export const COMPONENT_KINDS = ['earning', 'deduction', 'employer_contribution', 'info'] as const;
export const COMPONENT_CALCS = ['fixed', 'variable', 'formula', 'system'] as const;

export const payComponents = pgTable(
  'pay_components',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    kind: text('kind', { enum: COMPONENT_KINDS }).notNull(),
    calc: text('calc', { enum: COMPONENT_CALCS }).notNull(),
    formula: text('formula'),
    isEpfApplicable: boolean('is_epf_applicable').notNull().default(false),
    isEtfApplicable: boolean('is_etf_applicable').notNull().default(false),
    isApitApplicable: boolean('is_apit_applicable').notNull().default(false),
    isProrated: boolean('is_prorated').notNull().default(false),
    showOnPayslip: boolean('show_on_payslip').notNull().default(true),
    glCode: text('gl_code'),
    sortOrder: integer('sort_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    /** Engine-computed (BASIC, OT, EPF…): code, kind and calc are fixed. */
    isSystem: boolean('is_system').notNull().default(false),
    needsReview: boolean('needs_review').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    check(
      'pay_components_kind_check',
      sql`${t.kind} in ('earning','deduction','employer_contribution','info')`,
    ),
    check('pay_components_calc_check', sql`${t.calc} in ('fixed','variable','formula','system')`),
    check('pay_components_formula', sql`${t.calc} <> 'formula' or ${t.formula} is not null`),
  ],
).enableRLS();

/** One row per change; the row in force for a period is the latest effective_from ≤ period end. */
export const statutorySettings = pgTable(
  'statutory_settings',
  {
    id: id(),
    effectiveFrom: date('effective_from').notNull().unique(),
    epfEmployeeRate: rate('epf_employee_rate').notNull(),
    epfEmployerRate: rate('epf_employer_rate').notNull(),
    etfRate: rate('etf_rate').notNull(),
    nopayDivisorMode: text('nopay_divisor_mode', { enum: ['working_days', 'fixed'] }).notNull(),
    nopayFixedDivisor: numeric('nopay_fixed_divisor', { precision: 6, scale: 2 }),
    nopayBase: text('nopay_base', { enum: ['basic', 'basic_plus_epf_components'] }).notNull(),
    otRateBase: text('ot_rate_base', { enum: ['basic', 'basic_plus_epf_components'] }).notNull(),
    otDivisor: numeric('ot_divisor', { precision: 8, scale: 2 }).notNull(),
    otMultiplierNormal: numeric('ot_multiplier_normal', { precision: 5, scale: 2 }).notNull(),
    otMultiplierHoliday: numeric('ot_multiplier_holiday', { precision: 5, scale: 2 }).notNull(),
    /** OT worked on a rest day (not a holiday) is paid at the holiday multiplier. */
    restDayOtAsHoliday: boolean('rest_day_ot_as_holiday').notNull().default(true),
    roundingMode: text('rounding_mode', {
      enum: ['half_up', 'half_down', 'half_even', 'up', 'down'],
    }).notNull(),
    roundingScale: smallint('rounding_scale').notNull().default(2),
    needsReview: boolean('needs_review').notNull().default(false),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    check('statutory_divisor', sql`${t.nopayDivisorMode} <> 'fixed' or ${t.nopayFixedDivisor} > 0`),
    check('statutory_ot_divisor', sql`${t.otDivisor} > 0`),
    check('statutory_scale', sql`${t.roundingScale} between 0 and 2`),
  ],
).enableRLS();

export const taxTables = pgTable(
  'tax_tables',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    method: text('method', { enum: ['slab_monthly', 'slab_annual_cumulative'] }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    needsReview: boolean('needs_review').notNull().default(false),
    source: text('source'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('tax_tables_code_from').on(t.code, t.effectiveFrom),
    check(
      'tax_tables_range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

export const taxTableSlabs = pgTable(
  'tax_table_slabs',
  {
    id: id(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => taxTables.id, { onDelete: 'cascade' }),
    fromAmount: money('from_amount').notNull(),
    toAmount: money('to_amount'),
    rate: rate('rate').notNull(),
    deductAmount: money('deduct_amount').notNull().default('0'),
    ...auditColumns(),
  },
  (t) => [
    index('tax_table_slabs_table').on(t.tableId),
    check('tax_slab_range', sql`${t.toAmount} is null or ${t.toAmount} > ${t.fromAmount}`),
  ],
).enableRLS();

export const employeeTaxProfiles = pgTable(
  'employee_tax_profiles',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    /** Tax table code; null = not liable to APIT through this employer. */
    tableCode: text('table_code'),
    isResident: boolean('is_resident').notNull().default(true),
    hasSecondaryEmployment: boolean('has_secondary_employment').notNull().default(false),
    effectiveFrom: date('effective_from').notNull(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('employee_tax_profiles_from').on(t.employeeId, t.effectiveFrom)],
).enableRLS();

export const employeeSalary = pgTable(
  'employee_salary',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    basic: money('basic').notNull(),
    currency: text('currency').notNull().default('LKR'),
    /**
     * Salaried staff (default) lose pay only for explicit no-pay leave. With this on, unexcused
     * absences in the locked attendance month are no-pay too. (UQMS paid 0 when logs were missing.)
     */
    nopayFromAbsence: boolean('nopay_from_absence').notNull().default(false),
    /** OT is paid from attendance only when on. */
    otEligible: boolean('ot_eligible').notNull().default(false),
    reason: text('reason'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('employee_salary_from').on(t.employeeId, t.effectiveFrom),
    check('employee_salary_basic', sql`${t.basic} >= 0`),
    check(
      'employee_salary_range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

export const employeePayComponents = pgTable(
  'employee_pay_components',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id')
      .notNull()
      .references(() => payComponents.id),
    amount: money('amount').notNull().default('0'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns(),
  },
  (t) => [
    index('employee_pay_components_employee').on(t.employeeId),
    check(
      'employee_pay_components_range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

/** Bank and branch codes needed by transfer files (SLIPS/CEFTS-style layouts). */
export const employeeBankCodes = pgTable('employee_bank_codes', {
  id: id(),
  employeeId: uuid('employee_id')
    .notNull()
    .unique()
    .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
  bankCode: text('bank_code'),
  branchCode: text('branch_code'),
  ...auditColumns(),
}).enableRLS();

export const loans = pgTable(
  'loans',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['loan', 'advance'] }).notNull(),
    principal: money('principal').notNull(),
    interestRate: rate('interest_rate').notNull().default('0'),
    installmentAmount: money('installment_amount').notNull(),
    /** First day of the first deduction month. */
    startPeriod: date('start_period').notNull(),
    status: text('status', { enum: ['active', 'closed', 'cancelled'] })
      .notNull()
      .default('active'),
    note: text('note'),
    ...auditColumns(),
  },
  (t) => [
    index('loans_employee').on(t.employeeId),
    check('loans_positive', sql`${t.principal} > 0 and ${t.installmentAmount} > 0`),
  ],
).enableRLS();

export const loanInstallments = pgTable(
  'loan_installments',
  {
    id: id(),
    loanId: uuid('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    period: date('period').notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: ['due', 'deducted', 'skipped'] })
      .notNull()
      .default('due'),
    payslipId: uuid('payslip_id'),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('loan_installments_loan_period').on(t.loanId, t.period)],
).enableRLS();

export interface BankFileColumn {
  /** Header in CSV; ignored for fixed width. */
  header?: string;
  /** Field from the payment row (see bank export) or a literal via `value`. */
  field?: string;
  value?: string;
  width?: number;
  align?: 'left' | 'right';
  pad?: string;
  /** amount_cents, amount_2dp, date:YYYYMMDD, upper… */
  format?: string;
}

export interface BankFileSpec {
  delimiter?: string;
  includeHeader?: boolean;
  lineEnding?: 'crlf' | 'lf';
  columns: BankFileColumn[];
}

export const bankFileTemplates = pgTable('bank_file_templates', {
  id: id(),
  name: text('name').notNull().unique(),
  bank: text('bank').notNull(),
  format: text('format', { enum: ['csv', 'fixed_width'] }).notNull(),
  spec: jsonb('spec').$type<BankFileSpec>().notNull(),
  needsReview: boolean('needs_review').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns(),
}).enableRLS();

export const PERIOD_STATUSES = ['open', 'calculated', 'approved', 'locked', 'paid'] as const;

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: id(),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    payDate: date('pay_date').notNull(),
    status: text('status', { enum: PERIOD_STATUSES }).notNull().default('open'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('payroll_periods_year_month').on(t.year, t.month),
    check('payroll_periods_month', sql`${t.month} between 1 and 12`),
    check('payroll_periods_range', sql`${t.endDate} >= ${t.startDate}`),
  ],
).enableRLS();

export const RUN_STATUSES = ['draft', 'calculated', 'approved', 'locked', 'paid'] as const;
export const RUN_TYPES = ['regular', 'off_cycle', 'adjustment'] as const;

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    type: text('type', { enum: RUN_TYPES }).notNull().default('regular'),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('draft'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }),
    calculatedBy: uuid('calculated_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidBy: uuid('paid_by'),
    /** Config used by the last calculation (statutory row, tax tables, components). */
    configSnapshot: jsonb('config_snapshot'),
    totals: jsonb('totals'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    // One regular run per period (UQMS had no duplicate-run guard).
    uniqueIndex('payroll_runs_one_regular')
      .on(t.periodId)
      .where(sql`${t.type} = 'regular'`),
    check(
      'payroll_runs_status_check',
      sql`${t.status} in ('draft','calculated','approved','locked','paid')`,
    ),
  ],
).enableRLS();

export const payrollInputs = pgTable(
  'payroll_inputs',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => payComponents.id),
    amount: money('amount').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    note: text('note'),
    source: text('source', { enum: ['manual', 'import', 'attendance', 'loan'] })
      .notNull()
      .default('manual'),
    ...auditColumns(),
  },
  (t) => [index('payroll_inputs_run_employee').on(t.runId, t.employeeId)],
).enableRLS();

export const payslips = pgTable(
  'payslips',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id),
    gross: money('gross').notNull(),
    totalDeductions: money('total_deductions').notNull(),
    net: money('net').notNull(),
    employerCost: money('employer_cost').notNull(),
    epfBase: money('epf_base').notNull(),
    etfBase: money('etf_base').notNull(),
    apitBase: money('apit_base').notNull(),
    /** Employee, salary, attendance and inputs as calculated (payslips never change later). */
    snapshot: jsonb('snapshot').notNull(),
    trace: jsonb('trace').notNull(),
    warnings: jsonb('warnings').$type<{ code: string; message: string }[]>().notNull().default([]),
    pdfPath: text('pdf_path'),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('payslips_run_employee').on(t.runId, t.employeeId),
    index('payslips_employee').on(t.employeeId),
  ],
).enableRLS();

export const payslipLines = pgTable(
  'payslip_lines',
  {
    id: id(),
    payslipId: uuid('payslip_id')
      .notNull()
      .references(() => payslips.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id').references(() => payComponents.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: COMPONENT_KINDS }).notNull(),
    amount: money('amount').notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    rate: numeric('rate', { precision: 14, scale: 4 }),
    ref: text('ref'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [index('payslip_lines_payslip').on(t.payslipId)],
).enableRLS();
