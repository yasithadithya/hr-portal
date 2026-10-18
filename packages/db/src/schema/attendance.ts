import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';
import { employees } from './employees';

/**
 * Attendance (PLAN.md Phase 6). Punches are raw and append-only; `attendance_days` is computed
 * from punches + shift + calendar + approved leave by the processing service and is never edited
 * by hand. Locked periods are never recomputed.
 */

/** Every threshold is data (CLAUDE.md Hard Rule 1); the engine is @hr/shared/attendance. */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    isNightShift: boolean('is_night_shift').notNull().default(false),
    breakMinutes: integer('break_minutes').notNull().default(0),
    breakAfterMinutes: integer('break_after_minutes').notNull().default(0),
    graceLateMinutes: integer('grace_late_minutes').notNull().default(0),
    earlyLeaveGraceMinutes: integer('early_leave_grace_minutes').notNull().default(0),
    halfDayThresholdMinutes: integer('half_day_threshold_minutes').notNull().default(0),
    otAfterMinutes: integer('ot_after_minutes').notNull().default(0),
    windowBeforeMinutes: integer('window_before_minutes').notNull().default(240),
    windowAfterMinutes: integer('window_after_minutes').notNull().default(360),
    color: text('color').notNull().default('#0ea5e9'),
    /** Seeded defaults must be confirmed by HR. */
    needsReview: boolean('needs_review').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    check(
      'shifts_minutes_nonneg',
      sql`${t.breakMinutes} >= 0 and ${t.breakAfterMinutes} >= 0 and ${t.graceLateMinutes} >= 0 and ${t.earlyLeaveGraceMinutes} >= 0 and ${t.halfDayThresholdMinutes} >= 0 and ${t.otAfterMinutes} >= 0 and ${t.windowBeforeMinutes} >= 0 and ${t.windowAfterMinutes} >= 0`,
    ),
  ],
).enableRLS();

/** Default shift per employee over a date range (gap-free per employee, maintained by the API). */
export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('shift_assignments_employee_from').on(t.employeeId, t.effectiveFrom),
    check(
      'shift_assignments_range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

/** Rotating rosters: overrides the assignment for one date. `shift_id` null = rest day. */
export const rosterEntries = pgTable(
  'roster_entries',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    shiftId: uuid('shift_id').references(() => shifts.id),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('roster_entries_employee_date').on(t.employeeId, t.date),
    index('roster_entries_date').on(t.date),
  ],
).enableRLS();

export const PUNCH_SOURCES = ['pwa', 'web', 'device', 'manual', 'import'] as const;

/** Raw clock events, including rejected ones (kept for disputes). Append-only by trigger. */
export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull(),
    source: text('source', { enum: PUNCH_SOURCES }).notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracyM: doublePrecision('accuracy_m'),
    ip: text('ip'),
    deviceId: text('device_id'),
    accepted: boolean('accepted').notNull().default(true),
    rejectReason: text('reject_reason'),
    note: text('note'),
    /** e.g. `regularization:<id>` — set on punches created by an approval. */
    ref: text('ref'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attendance_punches_employee_at').on(t.employeeId, t.at),
    // Re-importing the same device file is a no-op.
    uniqueIndex('attendance_punches_device_dedupe')
      .on(t.employeeId, t.at, t.source)
      .where(sql`${t.source} in ('device','import')`),
    check(
      'attendance_punches_source_check',
      sql`${t.source} in ('pwa','web','device','manual','import')`,
    ),
  ],
).enableRLS();

/** Fingerprint-device user id → employee (for device imports). */
export const attendanceDeviceUsers = pgTable('attendance_device_users', {
  id: id(),
  deviceUserId: text('device_user_id').notNull().unique(),
  employeeId: uuid('employee_id')
    .notNull()
    .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
  ...auditColumns(),
}).enableRLS();

export const DAY_TYPES = ['workday', 'weekend', 'holiday'] as const;
export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'half_day',
  'on_leave',
  'holiday',
  'weekend',
  'incomplete',
] as const;

/** Computed per employee-day. Rows of a locked period are frozen by trigger. */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    shiftId: uuid('shift_id').references(() => shifts.id),
    dayType: text('day_type', { enum: DAY_TYPES }).notNull(),
    expected: numeric('expected', { precision: 3, scale: 2 }).notNull(),
    leavePortion: numeric('leave_portion', { precision: 3, scale: 2 }).notNull().default('0'),
    firstIn: timestamp('first_in', { withTimezone: true }),
    lastOut: timestamp('last_out', { withTimezone: true }),
    workedMinutes: integer('worked_minutes').notNull().default(0),
    lateMinutes: integer('late_minutes').notNull().default(0),
    earlyMinutes: integer('early_minutes').notNull().default(0),
    otMinutes: integer('ot_minutes').notNull().default(0),
    /** Set when OT approval is on (`attendance.ot_requires_approval`); null = not decided. */
    otApprovedMinutes: integer('ot_approved_minutes'),
    otDecidedBy: uuid('ot_decided_by'),
    absentPortion: numeric('absent_portion', { precision: 3, scale: 2 }).notNull().default('0'),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
    isLocked: boolean('is_locked').notNull().default(false),
    sourceSummary: jsonb('source_summary').$type<Record<string, number>>().notNull().default({}),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('attendance_days_employee_date').on(t.employeeId, t.date),
    index('attendance_days_date_status').on(t.date, t.status),
    check(
      'attendance_days_status_check',
      sql`${t.status} in ('present','absent','half_day','on_leave','holiday','weekend','incomplete')`,
    ),
  ],
).enableRLS();

export const REGULARIZATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;

export const regularizationRequests = pgTable(
  'regularization_requests',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    requestedIn: timestamp('requested_in', { withTimezone: true }),
    requestedOut: timestamp('requested_out', { withTimezone: true }),
    reason: text('reason').notNull(),
    status: text('status', { enum: REGULARIZATION_STATUSES }).notNull().default('pending'),
    currentStep: smallint('current_step').notNull().default(0),
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
    index('regularization_employee_date').on(t.employeeId, t.date),
    index('regularization_pending').on(t.status, t.currentApproverEmployeeId),
    check(
      'regularization_has_time',
      sql`${t.requestedIn} is not null or ${t.requestedOut} is not null`,
    ),
    check(
      'regularization_order',
      sql`${t.requestedIn} is null or ${t.requestedOut} is null or ${t.requestedOut} > ${t.requestedIn}`,
    ),
    check(
      'regularization_status_check',
      sql`${t.status} in ('pending','approved','rejected','withdrawn','cancelled')`,
    ),
  ],
).enableRLS();

export const attendancePeriods = pgTable(
  'attendance_periods',
  {
    id: id(),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    status: text('status', { enum: ['open', 'locked'] })
      .notNull()
      .default('open'),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    summary: jsonb('summary'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('attendance_periods_year_month').on(t.year, t.month),
    check('attendance_periods_month', sql`${t.month} between 1 and 12`),
    check('attendance_periods_status', sql`${t.status} in ('open','locked')`),
  ],
).enableRLS();
