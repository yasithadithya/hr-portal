import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';

import { schema, scopeCondition, withAudit } from '@hr/db';
import {
  csvCell,
  CURRENT_STATUSES,
  ok,
  REPORT_KEYS,
  reportQuerySchema,
  scopeCovers,
  type PermissionKey,
  type ReportInfo,
  type ReportKey,
  type ReportResult,
  type Scope,
} from '@hr/shared';
import { money } from '@hr/shared/money';
import { countWorkingDays, monthRange } from '@hr/shared/time';

import { authedCtx, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { processRange } from '../attendance/process';
import { monthlySummary } from '../attendance/routes';
import { getSettings } from '../company/routes';
import { tenantToday } from '../employees/service';
import { balancesFor, employeeCalendar } from '../leave/engine';
import { statutoryAt } from '../payroll/calc';

import { hrDashboard, payrollDashboard } from './dashboard';

const {
  branches,
  departments,
  designations,
  employeeSalary,
  employees,
  payrollPeriods,
  payrollRuns,
  payslipLines,
  payslips,
} = schema;
type Ctx = RequestContext & { user: AuthedUser };
type Query = z.output<typeof reportQuerySchema>;

interface ReportDef extends ReportInfo {
  /** Every permission listed must be held at `scope` or wider. */
  needs: { key: PermissionKey; scope: Scope }[];
  run(ctx: Ctx, q: Query): Promise<Omit<ReportResult, 'key' | 'title'>>;
}

const scopeOfKey = (ctx: Ctx, key: PermissionKey) => ctx.permissions[key]!;
const prevMonth = (today: string) => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const i = y * 12 + m - 2;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

async function visibleStaff(ctx: Ctx, scope: Scope, q: Query, currentOnly = true) {
  const dept = aliasedTable(departments, 'dept');
  return ctx.db
    .select({ e: employees, department: dept.name })
    .from(employees)
    .leftJoin(dept, eq(dept.id, employees.departmentId))
    .where(
      and(
        isNull(employees.archivedAt),
        currentOnly && !q.status ? inArray(employees.status, CURRENT_STATUSES) : undefined,
        q.status ? eq(employees.status, q.status as (typeof CURRENT_STATUSES)[number]) : undefined,
        q.departmentId ? eq(employees.departmentId, q.departmentId) : undefined,
        scopeCondition(scope, ctx.user.employeeId, employees.id),
      ),
    )
    .orderBy(asc(employees.employeeNo));
}

const REPORTS: Record<ReportKey, ReportDef> = {
  'employee-master': {
    key: 'employee-master',
    title: 'Employee master',
    description: 'Everyone with their job details. Personal identifiers only for HR.',
    filters: ['departmentId', 'status'],
    needs: [{ key: 'employees.read', scope: 'team' }],
    async run(ctx, q) {
      const scope = scopeOfKey(ctx, 'employees.read');
      const full = scopeCovers(scope, 'all');
      const dept = aliasedTable(departments, 'dept');
      const rows = await ctx.db
        .select({
          e: employees,
          department: dept.name,
          designation: designations.title,
          branch: branches.name,
        })
        .from(employees)
        .leftJoin(dept, eq(dept.id, employees.departmentId))
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .leftJoin(branches, eq(branches.id, employees.branchId))
        .where(
          and(
            isNull(employees.archivedAt),
            q.status
              ? eq(employees.status, q.status as (typeof CURRENT_STATUSES)[number])
              : undefined,
            q.departmentId ? eq(employees.departmentId, q.departmentId) : undefined,
            scopeCondition(scope, ctx.user.employeeId, employees.id),
          ),
        )
        .orderBy(asc(employees.employeeNo));
      const columns: ReportResult['columns'] = [
        { key: 'employeeNo', label: 'Employee no', type: 'text' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'designation', label: 'Designation', type: 'text' },
        { key: 'branch', label: 'Branch', type: 'text' },
        { key: 'employmentType', label: 'Employment type', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'joinDate', label: 'Joined', type: 'date' },
        { key: 'exitDate', label: 'Exit', type: 'date' },
        { key: 'workEmail', label: 'Work email', type: 'text' },
        ...(full
          ? ([
              { key: 'nic', label: 'NIC', type: 'text' },
              { key: 'epfNo', label: 'EPF no', type: 'text' },
              { key: 'mobile', label: 'Mobile', type: 'text' },
            ] as const)
          : []),
      ];
      return {
        note: full ? null : 'Personal identifiers are hidden at team scope.',
        columns,
        rows: rows.map(({ e, department, designation, branch }) => ({
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          department,
          designation,
          branch,
          employmentType: e.employmentType,
          status: e.status,
          joinDate: e.joinDate,
          exitDate: e.exitDate,
          workEmail: e.workEmail,
          ...(full ? { nic: e.nic, epfNo: e.epfNo, mobile: e.mobile } : {}),
        })),
      };
    },
  },

  'leave-balances': {
    key: 'leave-balances',
    title: 'Leave balances',
    description: 'Available balance per leave type (pending requests already reserved).',
    filters: ['year', 'departmentId'],
    needs: [{ key: 'leave.read', scope: 'team' }],
    async run(ctx, q) {
      const today = tenantToday(ctx);
      const year = q.year ?? Number(today.slice(0, 4));
      const asOf = year < Number(today.slice(0, 4)) ? `${year}-12-31` : today;
      const staff = await visibleStaff(ctx, scopeOfKey(ctx, 'leave.read'), q);
      const codes = new Map<string, string>();
      const rows = [];
      for (const { e, department } of staff) {
        const b = await balancesFor(ctx.db, e, year, asOf);
        const row: Record<string, string | number | null> = {
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          department,
        };
        for (const x of b.filter((x) => x.policy)) {
          codes.set(x.type.code, x.type.name);
          row[x.type.code] = x.available;
        }
        rows.push(row);
      }
      return {
        note: `As of ${asOf}`,
        columns: [
          { key: 'employeeNo', label: 'Employee no', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' },
          ...[...codes.entries()].map(([key, label]) => ({ key, label, type: 'number' as const })),
        ],
        rows,
      };
    },
  },

  'leave-liability': {
    key: 'leave-liability',
    title: 'Leave liability',
    description: 'Unused paid leave valued at each employee’s daily rate.',
    filters: ['year', 'departmentId'],
    needs: [
      { key: 'leave.read', scope: 'all' },
      { key: 'payroll.read', scope: 'all' },
    ],
    async run(ctx, q) {
      const today = tenantToday(ctx);
      const year = q.year ?? Number(today.slice(0, 4));
      const stat = await statutoryAt(ctx.db, today);
      if (!stat)
        throw AppError.badRequest(
          'Add statutory payroll settings first (they define the daily rate)',
        );
      const staff = await visibleStaff(ctx, 'all', q);
      const salaries = staff.length
        ? await ctx.db
            .select()
            .from(employeeSalary)
            .where(
              and(
                inArray(
                  employeeSalary.employeeId,
                  staff.map((s) => s.e.id),
                ),
                sql`${employeeSalary.effectiveFrom} <= ${today}`,
                sql`(${employeeSalary.effectiveTo} is null or ${employeeSalary.effectiveTo} >= ${today})`,
              ),
            )
        : [];
      const [ty, tm] = today.split('-').map(Number) as [number, number];
      const month = monthRange(ty, tm);
      const rows = [];
      for (const { e, department } of staff) {
        const sal = salaries.find((s) => s.employeeId === e.id);
        if (!sal) continue;
        let divisor =
          stat.nopayDivisorMode === 'fixed' ? money(stat.nopayFixedDivisor ?? '0') : null;
        if (!divisor) {
          const cal = await employeeCalendar(ctx.db, e, month.start, month.end);
          divisor = money(
            countWorkingDays(
              month.start,
              month.end,
              cal.workWeek,
              new Set(cal.holidays.map((h) => h.date)),
            ),
          );
        }
        if (divisor.lessThanOrEqualTo(0)) continue;
        const daily = money(sal.basic).dividedBy(divisor);
        const b = await balancesFor(ctx.db, e, year, today);
        for (const x of b.filter(
          (x) => x.policy && x.type.isPaid && x.type.unit !== 'hour' && x.balance > 0,
        )) {
          rows.push({
            employeeNo: e.employeeNo,
            name: `${e.firstName} ${e.lastName}`,
            department,
            leaveType: x.type.name,
            days: x.balance,
            dailyRate: daily.toFixed(2),
            liability: daily.times(x.balance).toFixed(2),
          });
        }
      }
      return {
        note: `Daily rate = basic ÷ ${stat.nopayDivisorMode === 'fixed' ? `${money(stat.nopayFixedDivisor!).toString()} (fixed)` : 'working days this month'} (the payroll no-pay divisor). Confirm the valuation basis with the accountant.`,
        columns: [
          { key: 'employeeNo', label: 'Employee no', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'leaveType', label: 'Leave type', type: 'text' },
          { key: 'days', label: 'Unused days', type: 'number' },
          { key: 'dailyRate', label: 'Daily rate', type: 'money' },
          { key: 'liability', label: 'Liability', type: 'money' },
        ],
        rows,
      };
    },
  },

  'attendance-summary': {
    key: 'attendance-summary',
    title: 'Attendance summary',
    description: 'Monthly days present, absent, on leave, late and overtime per employee.',
    filters: ['month', 'departmentId'],
    needs: [{ key: 'attendance.read', scope: 'team' }],
    async run(ctx, q) {
      const today = tenantToday(ctx);
      const monthKey = q.month ?? prevMonth(today);
      const [y, m] = monthKey.split('-').map(Number) as [number, number];
      const range = monthRange(y, m);
      const staff = await visibleStaff(ctx, scopeOfKey(ctx, 'attendance.read'), q);
      const ids = staff.map((s) => s.e.id);
      await processRange(ctx.db, {
        onlyMissing: true,
        tz: ctx.tenant.timezone,
        from: range.start,
        to: range.end,
        today,
        employeeIds: ids,
      });
      const settings = await getSettings(ctx.db);
      const rows = await monthlySummary(
        ctx,
        range.start,
        range.end,
        ids,
        settings['attendance.ot_requires_approval'],
      );
      return {
        note: `${monthKey}`,
        columns: [
          { key: 'employeeNo', label: 'Employee no', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'expectedDays', label: 'Expected days', type: 'number' },
          { key: 'presentDays', label: 'Present', type: 'number' },
          { key: 'leaveDays', label: 'Leave', type: 'number' },
          { key: 'absentDays', label: 'Absent', type: 'number' },
          { key: 'lateCount', label: 'Late (times)', type: 'number' },
          { key: 'otHours', label: 'Payable OT (h)', type: 'number' },
          { key: 'incompleteDays', label: 'Missing punch', type: 'number' },
        ],
        rows: rows.map((r) => ({
          employeeNo: r.employeeNo,
          name: r.name,
          department: r.department,
          expectedDays: r.expectedDays,
          presentDays: r.presentDays,
          leaveDays: r.leaveDays,
          absentDays: r.absentDays,
          lateCount: r.lateCount,
          otHours: Math.round((r.payableOtMinutes / 60) * 100) / 100,
          incompleteDays: r.incompleteDays,
        })),
      };
    },
  },

  'payroll-register': {
    key: 'payroll-register',
    title: 'Payroll register',
    description: 'Gross, deductions, statutory and net pay per employee for a payroll run.',
    filters: ['runId', 'departmentId'],
    needs: [{ key: 'payroll.read', scope: 'all' }],
    async run(ctx, q) {
      const [run] = q.runId
        ? await ctx.db
            .select({ r: payrollRuns, p: payrollPeriods })
            .from(payrollRuns)
            .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
            .where(eq(payrollRuns.id, q.runId))
        : await ctx.db
            .select({ r: payrollRuns, p: payrollPeriods })
            .from(payrollRuns)
            .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
            .where(inArray(payrollRuns.status, ['calculated', 'approved', 'locked', 'paid']))
            .orderBy(desc(payrollPeriods.startDate))
            .limit(1);
      if (!run) return { note: 'No calculated payroll yet.', columns: [], rows: [] };
      const dept = aliasedTable(departments, 'dept');
      const slips = await ctx.db
        .select({ s: payslips, e: employees, department: dept.name })
        .from(payslips)
        .innerJoin(employees, eq(employees.id, payslips.employeeId))
        .leftJoin(dept, eq(dept.id, employees.departmentId))
        .where(
          and(
            eq(payslips.runId, run.r.id),
            q.departmentId ? eq(employees.departmentId, q.departmentId) : undefined,
          ),
        )
        .orderBy(asc(employees.employeeNo));
      const lines = slips.length
        ? await ctx.db
            .select({
              id: payslipLines.payslipId,
              code: payslipLines.code,
              amount: payslipLines.amount,
            })
            .from(payslipLines)
            .where(
              and(
                inArray(
                  payslipLines.payslipId,
                  slips.map((s) => s.s.id),
                ),
                inArray(payslipLines.code, ['EPF_EE', 'EPF_ER', 'ETF', 'APIT']),
              ),
            )
        : [];
      const amt = (id: string, code: string) =>
        lines
          .filter((l) => l.id === id && l.code === code)
          .reduce((a, l) => a.plus(l.amount), money(0))
          .toFixed(2);
      const month = `${run.p.year}-${String(run.p.month).padStart(2, '0')}`;
      return {
        note: `${month} · ${run.r.type} run · ${run.r.status}`,
        columns: [
          { key: 'employeeNo', label: 'Employee no', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'gross', label: 'Gross', type: 'money' },
          { key: 'epfEmployee', label: 'EPF (employee)', type: 'money' },
          { key: 'apit', label: 'APIT', type: 'money' },
          { key: 'deductions', label: 'Total deductions', type: 'money' },
          { key: 'net', label: 'Net', type: 'money' },
          { key: 'epfEmployer', label: 'EPF (employer)', type: 'money' },
          { key: 'etf', label: 'ETF', type: 'money' },
          { key: 'employerCost', label: 'Employer cost', type: 'money' },
        ],
        rows: slips.map(({ s, e, department }) => ({
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          department,
          gross: s.gross,
          epfEmployee: amt(s.id, 'EPF_EE'),
          apit: amt(s.id, 'APIT'),
          deductions: s.totalDeductions,
          net: s.net,
          epfEmployer: amt(s.id, 'EPF_ER'),
          etf: amt(s.id, 'ETF'),
          employerCost: s.employerCost,
        })),
      };
    },
  },
};

const allowed = (ctx: Ctx, def: ReportDef) =>
  def.needs.every((n) => {
    const s = ctx.permissions[n.key];
    return !!s && scopeCovers(s, n.scope);
  });

const BOM = String.fromCharCode(0xfeff);

async function send(res: Response, r: ReportResult, format: 'json' | 'csv' | 'xlsx') {
  if (format === 'json') return void res.json(ok(r));
  const name = `${r.key}-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'csv') {
    const lines = [
      r.columns.map((c) => csvCell(c.label)).join(','),
      ...r.rows.map((row) => r.columns.map((c) => csvCell(row[c.key] ?? '')).join(',')),
    ];
    return void res
      .type('text/csv; charset=utf-8')
      .attachment(`${name}.csv`)
      .send(`${BOM}${lines.join('\r\n')}\r\n`);
  }
  // XLSX: money/number cells are numeric so totals work in Excel (display only; computed above with decimals).
  const header = r.columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const }));
  const body = r.rows.map((row) =>
    r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === '') return null;
      if (c.type === 'money') return { value: Number(v), type: Number, format: '#,##0.00' };
      if (c.type === 'number') return { value: Number(v), type: Number };
      return { value: String(v), type: String };
    }),
  );
  const buffer = await writeXlsxFile([header, ...body] as never, {
    buffer: true,
    sheet: r.title.slice(0, 31),
    columns: r.columns.map((c) => ({ width: c.type === 'text' ? 24 : 14 })),
  });
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .attachment(`${name}.xlsx`)
    .send(buffer);
}

export function reportRoutes(): Router {
  const router = Router();

  router.get('/dashboard/hr', requirePermission('employees.read', 'team'), async (req, res) => {
    const ctx = authedCtx(req);
    res.json(ok(await hrDashboard(ctx, ctx.permissions['employees.read']!)));
  });

  router.get('/dashboard/payroll', requirePermission('payroll.read', 'all'), async (req, res) => {
    res.json(ok(await payrollDashboard(authedCtx(req))));
  });

  router.get('/reports', async (req, res) => {
    const ctx = authedCtx(req);
    res.json(
      ok(
        Object.values(REPORTS)
          .filter((d) => allowed(ctx, d))
          .map(({ key, title, description, filters }) => ({ key, title, description, filters })),
      ),
    );
  });

  const runSchemas = { params: z.object({ key: z.enum(REPORT_KEYS) }), query: reportQuerySchema };
  router.get('/reports/:key', validate(runSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, query } = parsed(req, runSchemas);
    const def = REPORTS[params.key];
    if (!allowed(ctx, def)) throw AppError.forbidden('You do not have access to this report');
    const out = await def.run(ctx, query);
    const result: ReportResult = { key: def.key, title: def.title, ...out };
    if (query.format !== 'json')
      await withAudit(ctx.db, ctx.actor, 'reports', async () => ({
        action: `export_${def.key}`,
        entityId: null,
        after: { format: query.format, rows: result.rows.length, filters: query },
        result: null,
      }));
    await send(res, result, query.format);
  });

  return router;
}
