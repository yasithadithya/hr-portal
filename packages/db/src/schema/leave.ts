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
  primaryKey,
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
 * Leave (PLAN.md Phase 5). Balances are never stored: they are SUM(leave_ledger.amount) per
 * employee / type / year (CLAUDE.md Hard Rule 10). Amounts are in the type's unit: days for
 * `day`/`half_day` types, hours for `hour` types (short leave).
 */
export const LEAVE_UNITS = ['day', 'half_day', 'hour'] as const;

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    isPaid: boolean('is_paid').notNull().default(true),
    unit: text('unit', { enum: LEAVE_UNITS }).notNull().default('half_day'),
    color: text('color').notNull().default('#2563eb'),
    requiresAttachmentAfterDays: numeric('requires_attachment_after_days', {
      precision: 6,
      scale: 2,
    }),
    maxConsecutiveDays: numeric('max_consecutive_days', { precision: 6, scale: 2 }),
    minNoticeDays: integer('min_notice_days').notNull().default(0),
    allowNegative: boolean('allow_negative').notNull().default(false),
    genderRestriction: text('gender_restriction', { enum: ['male', 'female'] }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    ...auditColumns(),
  },
  (t) => [check('leave_types_unit_check', sql`${t.unit} in ('day','half_day','hour')`)],
).enableRLS();

export const ACCRUALS = ['upfront_yearly', 'monthly', 'none'] as const;
export const PRORATIONS = ['none', 'monthly', 'daily'] as const;
export const LEAVE_ROUNDINGS = [
  'none',
  'nearest_half',
  'floor_half',
  'floor_day',
  'nearest_day',
] as const;

export interface PolicyAppliesTo {
  employmentTypes?: string[];
  gradeIds?: string[];
  branchIds?: string[];
}

/** Who gets how much of a leave type. Lower `priority` wins when several policies match. */
export const leavePolicies = pgTable(
  'leave_policies',
  {
    id: id(),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    appliesTo: jsonb('applies_to').$type<PolicyAppliesTo>().notNull().default({}),
    entitlement: numeric('entitlement', { precision: 6, scale: 2 }).notNull().default('0'),
    accrual: text('accrual', { enum: ACCRUALS }).notNull().default('upfront_yearly'),
    prorationOnJoin: text('proration_on_join', { enum: PRORATIONS }).notNull().default('monthly'),
    rounding: text('rounding', { enum: LEAVE_ROUNDINGS }).notNull().default('floor_half'),
    eligibleAfterMonths: integer('eligible_after_months').notNull().default(0),
    carryForwardMax: numeric('carry_forward_max', { precision: 6, scale: 2 })
      .notNull()
      .default('0'),
    /** Carried-forward balance expires this many months into the new year; null = never. */
    carryForwardExpiryMonths: integer('carry_forward_expiry_months'),
    encashable: boolean('encashable').notNull().default(false),
    effectiveFrom: date('effective_from').notNull(),
    priority: integer('priority').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    /** Seeded defaults must be confirmed by HR against law and the client's own policy. */
    needsReview: boolean('needs_review').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    index('leave_policies_type_idx').on(t.leaveTypeId),
    check('leave_policies_entitlement_nonneg', sql`${t.entitlement} >= 0`),
    check('leave_policies_carry_nonneg', sql`${t.carryForwardMax} >= 0`),
  ],
).enableRLS();

export const LEDGER_ENTRY_TYPES = [
  'opening',
  'accrual',
  'carry_forward',
  'taken',
  'reversal',
  'adjustment',
  'expiry',
  'encashment',
] as const;

/** Append-only (trigger) — corrections are new `adjustment`/`reversal` rows. */
export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    periodYear: smallint('period_year').notNull(),
    entryType: text('entry_type', { enum: LEDGER_ENTRY_TYPES }).notNull(),
    amount: numeric('amount', { precision: 8, scale: 2 }).notNull(),
    /** Makes system-generated entries (accruals, carry-forward, expiry) idempotent. */
    idempotencyKey: text('idempotency_key').unique(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    effectiveDate: date('effective_date').notNull(),
    createdBy: uuid('created_by'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('leave_ledger_balance_idx').on(t.employeeId, t.leaveTypeId, t.periodYear),
    check(
      'leave_ledger_entry_type_check',
      sql`${t.entryType} in ('opening','accrual','carry_forward','taken','reversal','adjustment','expiry','encashment')`,
    ),
  ],
).enableRLS();

export const LEAVE_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'withdrawn',
] as const;
export const HALVES = ['full', 'first', 'second'] as const;

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    periodYear: smallint('period_year').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    startHalf: text('start_half', { enum: HALVES }).notNull().default('full'),
    endHalf: text('end_half', { enum: HALVES }).notNull().default('full'),
    /** For hour-unit types. */
    hours: numeric('hours', { precision: 5, scale: 2 }),
    /** Amount in the type's unit (days or hours). */
    amount: numeric('amount', { precision: 8, scale: 2 }).notNull(),
    reason: text('reason'),
    attachmentPath: text('attachment_path'),
    status: text('status', { enum: LEAVE_REQUEST_STATUSES }).notNull().default('pending'),
    /** Index into the approval flow's steps. */
    currentStep: smallint('current_step').notNull().default(0),
    /** Employee who must act on a `manager` step; null on `hr` steps. */
    currentApproverEmployeeId: uuid('current_approver_employee_id').references(
      (): AnyPgColumn => employees.id,
    ),
    approvalTrail: jsonb('approval_trail')
      .$type<{ step: number; by: string; action: string; at: string; note?: string }[]>()
      .notNull()
      .default([]),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...auditColumns(),
  },
  (t) => [
    index('leave_requests_employee_idx').on(t.employeeId, t.startDate),
    index('leave_requests_pending_idx').on(t.status, t.currentApproverEmployeeId),
    check('leave_requests_range', sql`${t.endDate} >= ${t.startDate}`),
    check(
      'leave_requests_status_check',
      sql`${t.status} in ('pending','approved','rejected','cancelled','withdrawn')`,
    ),
  ],
).enableRLS();

/** The working days a request covers (calendar + holidays + half days already applied). */
export const leaveRequestDays = pgTable(
  'leave_request_days',
  {
    requestId: uuid('request_id')
      .notNull()
      .references(() => leaveRequests.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    /** 1, 0.5 (or hours for hour-unit types). */
    portion: numeric('portion', { precision: 5, scale: 2 }).notNull(),
    /** Which half for 0.5 days, so first-half and second-half leave can share a date. */
    half: text('half', { enum: HALVES }).notNull().default('full'),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.date] }),
    index('leave_request_days_date_idx').on(t.date),
  ],
).enableRLS();

export const APPROVAL_STEPS = ['manager', 'hr'] as const;

/** v1 flows: direct manager → (optional) HR. Shared with attendance regularisation. */
export const approvalFlows = pgTable('approval_flows', {
  id: id(),
  module: text('module').notNull().unique(),
  steps: jsonb('steps').$type<(typeof APPROVAL_STEPS)[number][]>().notNull(),
  ...auditColumns(),
}).enableRLS();

export const leaveYearRuns = pgTable(
  'leave_year_runs',
  {
    id: id(),
    fromYear: smallint('from_year').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    ranBy: uuid('ran_by'),
    summary: jsonb('summary').notNull(),
  },
  (t) => [uniqueIndex('leave_year_runs_from_year').on(t.fromYear)],
).enableRLS();
