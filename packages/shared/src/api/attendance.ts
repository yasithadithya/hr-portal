import { z } from 'zod';

import { businessDateSchema } from '../time/index';

export const PUNCH_SOURCES = ['pwa', 'web', 'device', 'manual', 'import'] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];
export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'half_day',
  'on_leave',
  'holiday',
  'weekend',
  'incomplete',
] as const;
export const DAY_TYPES = ['workday', 'weekend', 'holiday'] as const;
export const REGULARIZATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm')
  .describe('HH:mm local time');
const minutes = (max: number) => z.number().int().min(0).max(max);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

// ── Shifts ──────────────────────────────────────────────────────────────────
export const shiftInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1).max(60),
    startTime: hhmm,
    endTime: hhmm,
    isNightShift: z.boolean(),
    breakMinutes: minutes(480),
    breakAfterMinutes: minutes(1440),
    graceLateMinutes: minutes(240),
    earlyLeaveGraceMinutes: minutes(240),
    halfDayThresholdMinutes: minutes(1440),
    otAfterMinutes: minutes(720),
    windowBeforeMinutes: minutes(720),
    windowAfterMinutes: minutes(720),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    archived: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const start = toMin(s.startTime);
    let end = toMin(s.endTime);
    if (s.isNightShift || end <= start) end += 1440;
    if (!s.isNightShift && toMin(s.endTime) <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['isNightShift'],
        message: 'A shift that ends on the next day must be marked as a night shift',
      });
    }
    const length = end - start;
    // Consecutive days' punch windows must not overlap, or a punch could belong to two days.
    if (length + s.windowBeforeMinutes + s.windowAfterMinutes > 1440) {
      ctx.addIssue({
        code: 'custom',
        path: ['windowAfterMinutes'],
        message: 'Shift length plus the before/after punch windows must not exceed 24 hours',
      });
    }
    if (s.breakMinutes >= length) {
      ctx.addIssue({
        code: 'custom',
        path: ['breakMinutes'],
        message: 'Break must be shorter than the shift',
      });
    }
  });
export type ShiftInput = z.input<typeof shiftInputSchema>;

export const shiftSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  isNightShift: z.boolean(),
  breakMinutes: z.number().int(),
  breakAfterMinutes: z.number().int(),
  graceLateMinutes: z.number().int(),
  earlyLeaveGraceMinutes: z.number().int(),
  halfDayThresholdMinutes: z.number().int(),
  otAfterMinutes: z.number().int(),
  windowBeforeMinutes: z.number().int(),
  windowAfterMinutes: z.number().int(),
  color: z.string(),
  needsReview: z.boolean(),
  archived: z.boolean(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const assignShiftSchema = z.object({
  employeeIds: z.array(z.uuid()).min(1).max(1000),
  shiftId: z.uuid(),
  effectiveFrom: businessDateSchema,
});
export const shiftAssignmentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  shiftId: z.uuid(),
  shiftCode: z.string(),
  shiftName: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type ShiftAssignment = z.infer<typeof shiftAssignmentSchema>;

// ── Roster ──────────────────────────────────────────────────────────────────
export const rosterCellSchema = z.object({
  date: z.string(),
  shiftId: z.uuid().nullable(),
  /** roster = overridden for this date; assignment = default shift; none = no shift. */
  source: z.enum(['roster', 'assignment', 'none']),
});
export const rosterWeekSchema = z.object({
  weekStart: z.string(),
  dates: z.array(z.string()),
  rows: z.array(
    z.object({
      employeeId: z.uuid(),
      employeeNo: z.string(),
      name: z.string(),
      cells: z.array(rosterCellSchema),
    }),
  ),
});
export type RosterWeek = z.infer<typeof rosterWeekSchema>;

export const rosterUpdateSchema = z.object({
  entries: z
    .array(
      z.object({
        employeeId: z.uuid(),
        date: businessDateSchema,
        /** uuid = work this shift; null = rest day; 'clear' = remove the override. */
        shiftId: z.union([z.uuid(), z.null(), z.literal('clear')]),
      }),
    )
    .min(1)
    .max(5000),
});

// ── Punches & clock ─────────────────────────────────────────────────────────
export const clockSchema = z.object({
  source: z.enum(['pwa', 'web']).default('web'),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  /** Why the browser has no location (denied, unavailable, timeout) — shown to HR on rejection. */
  locationError: z.string().max(100).nullable().optional(),
});
export type ClockInput = z.input<typeof clockSchema>;

export const punchSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  at: z.string(),
  source: z.enum(PUNCH_SOURCES),
  accepted: z.boolean(),
  rejectReason: z.string().nullable(),
  note: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  ip: z.string().nullable(),
});
export type Punch = z.infer<typeof punchSchema>;

export const clockResultSchema = z.object({
  punch: punchSchema,
  accepted: z.boolean(),
  message: z.string(),
});
export type ClockResult = z.infer<typeof clockResultSchema>;

export const manualPunchSchema = z.object({
  employeeId: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(1).max(300),
});

// ── Days ────────────────────────────────────────────────────────────────────
export const attendanceDaySchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  department: z.string().nullable(),
  date: z.string(),
  shift: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
  dayType: z.enum(DAY_TYPES),
  expected: z.number(),
  leavePortion: z.number(),
  firstIn: z.string().nullable(),
  lastOut: z.string().nullable(),
  workedMinutes: z.number().int(),
  lateMinutes: z.number().int(),
  earlyMinutes: z.number().int(),
  otMinutes: z.number().int(),
  otApprovedMinutes: z.number().int().nullable(),
  absentPortion: z.number(),
  status: z.enum(ATTENDANCE_STATUSES),
  isLocked: z.boolean(),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const todaySchema = z.object({
  date: z.string(),
  timezone: z.string(),
  linked: z.boolean(),
  canClock: z.boolean(),
  shift: z
    .object({ code: z.string(), name: z.string(), startTime: z.string(), endTime: z.string() })
    .nullable(),
  punches: z.array(punchSchema),
  /** What the button should say: the next accepted punch is an in or an out. */
  nextAction: z.enum(['in', 'out']),
  day: attendanceDaySchema.nullable(),
  /** Which checks the employee's branch applies (so the PWA can ask for location only if needed). */
  checks: z.object({ geofence: z.boolean(), ip: z.boolean() }),
});
export type AttendanceToday = z.infer<typeof todaySchema>;

export const processSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  employeeId: z.uuid().optional(),
});

export const otDecisionSchema = z.object({
  approvedMinutes: z.number().int().min(0).max(1440),
});

// ── Regularisation ──────────────────────────────────────────────────────────
export const regularizationInputSchema = z
  .object({
    date: businessDateSchema,
    requestedIn: hhmm.nullable().optional(),
    requestedOut: hhmm.nullable().optional(),
    /** The out time is on the next calendar day (night shifts). */
    outNextDay: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
    /** HR filing for someone else (attendance.manage); defaults to the signed-in employee. */
    employeeId: z.uuid().optional(),
  })
  .refine((v) => v.requestedIn || v.requestedOut, {
    message: 'Give the missing in time, out time, or both',
    path: ['requestedIn'],
  });
export type RegularizationInput = z.input<typeof regularizationInputSchema>;

export const regularizationSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeNo: z.string(),
  date: z.string(),
  requestedIn: z.string().nullable(),
  requestedOut: z.string().nullable(),
  reason: z.string(),
  status: z.enum(REGULARIZATION_STATUSES),
  waitingFor: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type Regularization = z.infer<typeof regularizationSchema>;

// ── Device import mapping ───────────────────────────────────────────────────
export const deviceUserInputSchema = z.object({
  deviceUserId: z.string().trim().min(1).max(40),
  employeeId: z.uuid(),
});
export const deviceUserSchema = z.object({
  id: z.uuid(),
  deviceUserId: z.string(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
});
export type DeviceUser = z.infer<typeof deviceUserSchema>;

// ── Monthly summary & periods ───────────────────────────────────────────────
export const monthQuerySchema = z.object({ month: monthSchema });

export const summaryRowSchema = z.object({
  employeeId: z.uuid(),
  employeeNo: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  expectedDays: z.number(),
  presentDays: z.number(),
  leaveDays: z.number(),
  absentDays: z.number(),
  lateCount: z.number().int(),
  lateMinutes: z.number().int(),
  earlyMinutes: z.number().int(),
  workedMinutes: z.number().int(),
  otMinutes: z.number().int(),
  /** OT payroll should use: approved minutes when approval is on, else computed minutes. */
  payableOtMinutes: z.number().int(),
  incompleteDays: z.number().int(),
});
export type SummaryRow = z.infer<typeof summaryRowSchema>;

export const periodSchema = z.object({
  year: z.number().int(),
  month: z.number().int(),
  status: z.enum(['open', 'locked']),
  lockedAt: z.string().nullable(),
  lockedBy: z.uuid().nullable(),
});
export type AttendancePeriod = z.infer<typeof periodSchema>;

export const monthlySummarySchema = z.object({
  month: z.string(),
  period: periodSchema,
  otRequiresApproval: z.boolean(),
  pendingRegularizations: z.number().int(),
  rows: z.array(summaryRowSchema),
});
export type MonthlySummary = z.infer<typeof monthlySummarySchema>;

export const lockSchema = z.object({
  /** Lock even with incomplete days or pending regularisations (they stay as they are). */
  force: z.boolean().default(false),
});
export const unlockSchema = z.object({ reason: z.string().trim().min(3).max(300) });
