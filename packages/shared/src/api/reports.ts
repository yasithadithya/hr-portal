import { z } from 'zod';

import { approvalsSummarySchema } from './notifications';

const countRow = z.object({ key: z.string(), label: z.string(), count: z.number().int() });

export const hrDashboardSchema = z.object({
  asOf: z.string(),
  scope: z.enum(['self', 'team', 'all']),
  headcount: z.object({
    total: z.number().int(),
    byStatus: z.array(countRow),
    byDepartment: z.array(countRow),
    byBranch: z.array(countRow),
  }),
  joinersThisMonth: z.number().int(),
  leaversThisMonth: z.number().int(),
  turnover12m: z.object({
    leavers: z.number().int(),
    averageHeadcount: z.number(),
    /** null when there is no headcount to divide by. */
    percent: z.number().nullable(),
  }),
  attendanceToday: z
    .object({
      present: z.number().int(),
      late: z.number().int(),
      onLeave: z.number().int(),
      absent: z.number().int(),
      incomplete: z.number().int(),
      restDay: z.number().int(),
    })
    .nullable(),
  approvals: approvalsSummarySchema,
  expiringDocuments: z.number().int().nullable(),
  upcoming: z.array(
    z.object({
      employeeId: z.uuid(),
      name: z.string(),
      kind: z.enum(['probation_end', 'contract_end']),
      date: z.string(),
    }),
  ),
});
export type HrDashboard = z.infer<typeof hrDashboardSchema>;

export const payrollDashboardSchema = z.object({
  trend: z.array(
    z.object({
      month: z.string(),
      employees: z.number().int(),
      gross: z.string(),
      net: z.string(),
      employerCost: z.string(),
    }),
  ),
  latest: z
    .object({
      month: z.string(),
      runId: z.uuid(),
      status: z.string(),
      byDepartment: z.array(
        z.object({ department: z.string(), employees: z.number().int(), employerCost: z.string() }),
      ),
      statutory: z.object({
        epfEmployee: z.string(),
        epfEmployer: z.string(),
        etf: z.string(),
        apit: z.string(),
      }),
    })
    .nullable(),
  configNeedsReview: z.boolean(),
});
export type PayrollDashboard = z.infer<typeof payrollDashboardSchema>;

// ── Report builder-lite ─────────────────────────────────────────────────────
export const REPORT_KEYS = [
  'employee-master',
  'leave-balances',
  'leave-liability',
  'attendance-summary',
  'payroll-register',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const REPORT_FILTERS = ['departmentId', 'status', 'year', 'month', 'runId'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export const reportInfoSchema = z.object({
  key: z.enum(REPORT_KEYS),
  title: z.string(),
  description: z.string(),
  filters: z.array(z.enum(REPORT_FILTERS)),
});
export type ReportInfo = z.infer<typeof reportInfoSchema>;

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'money', 'date']),
});
export const reportResultSchema = z.object({
  key: z.enum(REPORT_KEYS),
  title: z.string(),
  note: z.string().nullable(),
  columns: z.array(reportColumnSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

export const reportQuerySchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
  departmentId: z.uuid().optional(),
  status: z.string().max(30).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  runId: z.uuid().optional(),
});
