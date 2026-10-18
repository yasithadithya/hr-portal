import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { schema, scopeCondition } from '@hr/db';
import {
  CURRENT_STATUSES,
  scopeCovers,
  type HrDashboard,
  type PayrollDashboard,
  type Scope,
} from '@hr/shared';
import { money, sum } from '@hr/shared/money';
import { addDays, monthRange } from '@hr/shared/time';

import type { AuthedUser, RequestContext } from '../../context';
import { processRange } from '../attendance/process';
import { tenantToday } from '../employees/service';
import { approvalsSummary } from '../selfservice/routes';

const {
  attendanceDays,
  branches,
  departments,
  employeeDocuments,
  employees,
  payrollPeriods,
  payrollRuns,
  payslipLines,
  payslips,
} = schema;
type Ctx = RequestContext & { user: AuthedUser };

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_probation: 'On probation',
  notice: 'Serving notice',
};

/** Headcount on a date = joined on or before it and not yet exited. */
const employedOn = (date: string) =>
  and(lte(employees.joinDate, date), or(isNull(employees.exitDate), gte(employees.exitDate, date)));

export async function hrDashboard(ctx: Ctx, scope: Scope): Promise<HrDashboard> {
  const today = tenantToday(ctx);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const month = monthRange(y, m);
  const visible = and(
    isNull(employees.archivedAt),
    scopeCondition(scope, ctx.user.employeeId, employees.id),
  );

  const current = await ctx.db
    .select({ e: employees, dept: departments.name, branch: branches.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(visible, inArray(employees.status, CURRENT_STATUSES)));
  const group = (key: (r: (typeof current)[number]) => string) => {
    const counts = new Map<string, number>();
    for (const r of current) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
    return [...counts.entries()]
      .map(([k, count]) => ({ key: k, label: STATUS_LABEL[k] ?? k, count }))
      .sort((a, b) => b.count - a.count);
  };

  const count = async (cond: ReturnType<typeof and>) => {
    const [r] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(visible, cond));
    return r?.n ?? 0;
  };
  const joiners = await count(
    and(gte(employees.joinDate, month.start), lte(employees.joinDate, month.end)),
  );
  const leavers = await count(
    and(gte(employees.exitDate, month.start), lte(employees.exitDate, month.end)),
  );

  // Rolling 12 months: leavers ÷ average of headcount 12 months ago and today.
  const yearAgo = addDays(today, -365);
  const leavers12 = await count(
    and(gt0(), gte(employees.exitDate, yearAgo), lte(employees.exitDate, today)),
  );
  const startHead = await count(employedOn(yearAgo));
  const endHead = await count(employedOn(today));
  const avg = (startHead + endHead) / 2;

  let attendanceToday: HrDashboard['attendanceToday'] = null;
  const attScope = ctx.permissions['attendance.read'];
  if (attScope && scopeCovers(attScope, 'team')) {
    const ids = current.map((r) => r.e.id);
    if (ids.length)
      await processRange(ctx.db, {
        onlyMissing: true,
        tz: ctx.tenant.timezone,
        from: today,
        to: today,
        today,
        employeeIds: ids,
      });
    const rows = ids.length
      ? await ctx.db
          .select({
            status: attendanceDays.status,
            late: sql<number>`count(*) filter (where ${attendanceDays.lateMinutes} > 0)::int`,
            n: sql<number>`count(*)::int`,
          })
          .from(attendanceDays)
          .where(
            and(
              eq(attendanceDays.date, today),
              inArray(attendanceDays.employeeId, ids),
              scopeCondition(attScope, ctx.user.employeeId, attendanceDays.employeeId),
            ),
          )
          .groupBy(attendanceDays.status)
      : [];
    const by = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    attendanceToday = {
      present: by('present') + by('half_day'),
      late: rows.reduce((a, r) => a + r.late, 0),
      onLeave: by('on_leave'),
      absent: by('absent'),
      incomplete: by('incomplete'),
      restDay: by('weekend') + by('holiday'),
    };
  }

  const docScope = ctx.permissions['documents.read'];
  let expiringDocuments: number | null = null;
  if (docScope && scopeCovers(docScope, 'team')) {
    const [r] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(employeeDocuments)
      .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
      .where(
        and(
          visible,
          gte(employeeDocuments.expiryDate, today),
          lte(employeeDocuments.expiryDate, addDays(today, 30)),
        ),
      );
    expiringDocuments = r?.n ?? 0;
  }

  const horizon = addDays(today, 30);
  const upcoming = current
    .flatMap(({ e }) => [
      e.status === 'on_probation' &&
      e.probationEndDate &&
      e.probationEndDate >= today &&
      e.probationEndDate <= horizon
        ? {
            employeeId: e.id,
            name: `${e.firstName} ${e.lastName}`,
            kind: 'probation_end' as const,
            date: e.probationEndDate,
          }
        : null,
      e.contractEndDate && e.contractEndDate >= today && e.contractEndDate <= horizon
        ? {
            employeeId: e.id,
            name: `${e.firstName} ${e.lastName}`,
            kind: 'contract_end' as const,
            date: e.contractEndDate,
          }
        : null,
    ])
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  return {
    asOf: today,
    scope,
    headcount: {
      total: current.length,
      byStatus: group((r) => r.e.status),
      byDepartment: group((r) => r.dept ?? 'No department'),
      byBranch: group((r) => r.branch ?? 'No branch'),
    },
    joinersThisMonth: joiners,
    leaversThisMonth: leavers,
    turnover12m: {
      leavers: leavers12,
      averageHeadcount: avg,
      percent: avg > 0 ? Math.round((leavers12 / avg) * 1000) / 10 : null,
    },
    attendanceToday,
    approvals: await approvalsSummary(ctx),
    expiringDocuments,
    upcoming,
  };
}

/** Exit date present (helper keeps the leaver filter readable). */
function gt0() {
  return sql`${employees.exitDate} is not null`;
}

const monthKey = (p: { year: number; month: number }) =>
  `${p.year}-${String(p.month).padStart(2, '0')}`;

/** Payroll staff only (payroll.read all): cost trend and the latest run's breakdown. */
export async function payrollDashboard(ctx: Ctx): Promise<PayrollDashboard> {
  const runs = await ctx.db
    .select({ r: payrollRuns, p: payrollPeriods })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(
      and(
        eq(payrollRuns.type, 'regular'),
        inArray(payrollRuns.status, ['approved', 'locked', 'paid']),
      ),
    )
    .orderBy(desc(payrollPeriods.startDate))
    .limit(12);
  const trend = [...runs].reverse().map(({ r, p }) => {
    const t = (r.totals ?? {}) as {
      employees?: number;
      gross?: string;
      net?: string;
      employerCost?: string;
    };
    return {
      month: monthKey(p),
      employees: t.employees ?? 0,
      gross: t.gross ?? '0.00',
      net: t.net ?? '0.00',
      employerCost: t.employerCost ?? '0.00',
    };
  });
  const latestRun = runs[0];
  let latest: PayrollDashboard['latest'] = null;
  if (latestRun) {
    const rows = await ctx.db
      .select({ s: payslips, dept: departments.name })
      .from(payslips)
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(payslips.runId, latestRun.r.id));
    const byDept = new Map<string, { employees: number; cost: string[] }>();
    for (const r of rows) {
      const k = r.dept ?? 'No department';
      const cur = byDept.get(k) ?? { employees: 0, cost: [] };
      cur.employees++;
      cur.cost.push(r.s.employerCost);
      byDept.set(k, cur);
    }
    const lines = rows.length
      ? await ctx.db
          .select({ code: payslipLines.code, total: sql<string>`sum(${payslipLines.amount})` })
          .from(payslipLines)
          .where(
            inArray(
              payslipLines.payslipId,
              rows.map((r) => r.s.id),
            ),
          )
          .groupBy(payslipLines.code)
      : [];
    const t = (code: string) => money(lines.find((l) => l.code === code)?.total ?? '0').toFixed(2);
    latest = {
      month: monthKey(latestRun.p),
      runId: latestRun.r.id,
      status: latestRun.r.status,
      byDepartment: [...byDept.entries()]
        .map(([department, v]) => ({
          department,
          employees: v.employees,
          employerCost: sum(v.cost).toFixed(2),
        }))
        .sort((a, b) => money(b.employerCost).comparedTo(a.employerCost)),
      statutory: {
        epfEmployee: t('EPF_EE'),
        epfEmployer: t('EPF_ER'),
        etf: t('ETF'),
        apit: t('APIT'),
      },
    };
  }
  const snap = (latestRun?.r.configSnapshot ?? null) as { needsReview?: boolean } | null;
  return { trend, latest, configNeedsReview: snap?.needsReview ?? false };
}
