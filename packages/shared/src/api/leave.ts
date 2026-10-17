import { z } from 'zod';

import { businessDateSchema } from '../time/index';

export const LEAVE_UNITS = ['day', 'half_day', 'hour'] as const;
export const HALVES = ['full', 'first', 'second'] as const;
export const LEAVE_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'withdrawn',
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];
export const ACCRUALS = ['upfront_yearly', 'monthly', 'none'] as const;
export const PRORATIONS = ['none', 'monthly', 'daily'] as const;
export const LEAVE_ROUNDINGS = [
  'none',
  'nearest_half',
  'floor_half',
  'floor_day',
  'nearest_day',
] as const;

const optNum = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be zero or more');

// ── Types & policies ────────────────────────────────────────────────────────
export const leaveTypeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(60),
  isPaid: z.boolean(),
  unit: z.enum(LEAVE_UNITS),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  requiresAttachmentAfterDays: optNum,
  maxConsecutiveDays: optNum,
  minNoticeDays: z.number().int().min(0).max(365),
  allowNegative: z.boolean(),
  genderRestriction: z.enum(['male', 'female']).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type LeaveTypeInput = z.input<typeof leaveTypeInputSchema>;
export const leaveTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isPaid: z.boolean(),
  unit: z.enum(LEAVE_UNITS),
  color: z.string(),
  requiresAttachmentAfterDays: z.number().nullable(),
  maxConsecutiveDays: z.number().nullable(),
  minNoticeDays: z.number().int(),
  allowNegative: z.boolean(),
  genderRestriction: z.enum(['male', 'female']).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type LeaveType = z.infer<typeof leaveTypeSchema>;

export const appliesToSchema = z.object({
  employmentTypes: z.array(z.string()).optional(),
  gradeIds: z.array(z.uuid()).optional(),
  branchIds: z.array(z.uuid()).optional(),
});

export const leavePolicyInputSchema = z.object({
  leaveTypeId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  appliesTo: appliesToSchema.default({}),
  entitlement: z.number().min(0).max(366),
  accrual: z.enum(ACCRUALS),
  prorationOnJoin: z.enum(PRORATIONS),
  rounding: z.enum(LEAVE_ROUNDINGS),
  eligibleAfterMonths: z.number().int().min(0).max(120),
  carryForwardMax: z.number().min(0).max(366),
  carryForwardExpiryMonths: z.number().int().min(1).max(12).nullable(),
  encashable: z.boolean(),
  effectiveFrom: businessDateSchema,
  priority: z.number().int().min(0).max(1000).default(100),
  isActive: z.boolean().default(true),
});
export type LeavePolicyInput = z.input<typeof leavePolicyInputSchema>;
export const leavePolicySchema = z.object({
  id: z.uuid(),
  leaveTypeId: z.uuid(),
  name: z.string(),
  appliesTo: appliesToSchema,
  entitlement: z.number(),
  accrual: z.enum(ACCRUALS),
  prorationOnJoin: z.enum(PRORATIONS),
  rounding: z.enum(LEAVE_ROUNDINGS),
  eligibleAfterMonths: z.number().int(),
  carryForwardMax: z.number(),
  carryForwardExpiryMonths: z.number().int().nullable(),
  encashable: z.boolean(),
  effectiveFrom: z.string(),
  priority: z.number().int(),
  isActive: z.boolean(),
  needsReview: z.boolean(),
});
export type LeavePolicy = z.infer<typeof leavePolicySchema>;

// ── Requests ────────────────────────────────────────────────────────────────
export const applyLeaveSchema = z.object({
  leaveTypeId: z.uuid(),
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  startHalf: z.enum(HALVES).default('full'),
  endHalf: z.enum(HALVES).default('full'),
  hours: z.number().positive().max(24).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  /** HR applying for someone else (needs leave.manage); defaults to the signed-in employee. */
  employeeId: z.uuid().optional(),
});
export type ApplyLeaveInput = z.input<typeof applyLeaveSchema>;

export const leaveQuoteSchema = z.object({
  amount: z.number(),
  unit: z.enum(LEAVE_UNITS),
  days: z.array(z.object({ date: z.string(), portion: z.number(), half: z.enum(HALVES) })),
  balanceAfter: z.number().nullable(),
  attachmentRequired: z.boolean(),
  warnings: z.array(z.string()),
});
export type LeaveQuote = z.infer<typeof leaveQuoteSchema>;

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeNo: z.string(),
  leaveType: z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    color: z.string(),
    unit: z.enum(LEAVE_UNITS),
  }),
  startDate: z.string(),
  endDate: z.string(),
  startHalf: z.enum(HALVES),
  endHalf: z.enum(HALVES),
  hours: z.number().nullable(),
  amount: z.number(),
  reason: z.string().nullable(),
  hasAttachment: z.boolean(),
  attachmentRequired: z.boolean(),
  status: z.enum(LEAVE_REQUEST_STATUSES),
  currentStep: z.number().int(),
  waitingFor: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const decisionSchema = z.object({ note: z.string().trim().max(500).nullable().optional() });
export const bulkDecisionSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).nullable().optional(),
});
export const bulkDecisionResultSchema = z.object({
  done: z.array(z.uuid()),
  failed: z.array(z.object({ id: z.uuid(), message: z.string() })),
});

// ── Balances, calendar, admin ───────────────────────────────────────────────
export const balanceSchema = z.object({
  leaveType: z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    color: z.string(),
    unit: z.enum(LEAVE_UNITS),
    isPaid: z.boolean(),
  }),
  year: z.number().int(),
  entitled: z.number(),
  taken: z.number(),
  pending: z.number(),
  balance: z.number(),
  available: z.number(),
  allowNegative: z.boolean(),
  hasPolicy: z.boolean(),
  policyNeedsReview: z.boolean(),
});
export type LeaveBalance = z.infer<typeof balanceSchema>;

export const balanceReportRowSchema = z.object({
  employeeId: z.uuid(),
  employeeNo: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  balances: z.record(
    z.string(),
    z.object({ balance: z.number(), taken: z.number(), pending: z.number() }),
  ),
});

export const calendarEntrySchema = z.object({
  requestId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  leaveTypeCode: z.string(),
  color: z.string(),
  date: z.string(),
  portion: z.number(),
  half: z.enum(HALVES),
  status: z.enum(['pending', 'approved']),
});
export const leaveCalendarSchema = z.object({
  month: z.string(),
  entries: z.array(calendarEntrySchema),
  holidays: z.array(z.object({ date: z.string(), name: z.string() })),
});

export const adjustmentSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
  amount: z.number().refine((v) => v !== 0, 'Cannot be zero'),
  note: z.string().trim().min(1).max(300),
});

export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  entryType: z.string(),
  amount: z.number(),
  effectiveDate: z.string(),
  note: z.string().nullable(),
  at: z.string(),
});

export const yearEndPreviewSchema = z.object({
  fromYear: z.number().int(),
  alreadyRun: z.boolean(),
  rows: z.array(
    z.object({
      employeeNo: z.string(),
      name: z.string(),
      leaveTypeCode: z.string(),
      closingBalance: z.number(),
      carryForward: z.number(),
      lapsed: z.number(),
    }),
  ),
});
export type YearEndPreview = z.infer<typeof yearEndPreviewSchema>;
export const yearEndRunSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  dryRun: z.boolean().default(true),
});
