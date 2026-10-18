import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';
import {
  calculatePayslip,
  PayrollConfigError,
  type ComponentDef,
  type PayrollConfig,
  type PayslipInput,
  type PayslipResult,
  type TaxTable,
} from '@hr/payroll';
import { money, sum } from '@hr/shared/money';
import { countWorkingDays } from '@hr/shared/time';

import { AppError } from '../../lib/errors';
import { loadDayContext } from '../attendance/process';

/**
 * Turns database rows into engine inputs (bulk-loaded: one query per kind, not per employee) and
 * runs the pure engine. Nothing here computes pay itself.
 */

const {
  attendanceDays,
  attendancePeriods,
  companyProfile,
  employeePayComponents,
  employeeSalary,
  employeeTaxProfiles,
  employees,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  loans,
  payComponents,
  payrollInputs,
  payrollPeriods,
  payrollRuns,
  payslips,
  statutorySettings,
  taxTables,
  taxTableSlabs,
} = schema;

type Db = TenantDb | Tx;
export type PeriodRow = typeof payrollPeriods.$inferSelect;
export type RunRow = typeof payrollRuns.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;
export type ComponentRow = typeof payComponents.$inferSelect;

export function componentDef(c: ComponentRow): ComponentDef {
  return {
    code: c.code,
    name: c.name,
    kind: c.kind,
    calc: c.calc,
    formula: c.formula,
    isEpfApplicable: c.isEpfApplicable,
    isEtfApplicable: c.isEtfApplicable,
    isApitApplicable: c.isApitApplicable,
    isProrated: c.isProrated,
    showOnPayslip: c.showOnPayslip,
    sortOrder: c.sortOrder,
  };
}

/** Statutory settings in force at a date (latest effective_from ≤ date). */
export async function statutoryAt(db: Db, date: string) {
  const [row] = await db
    .select()
    .from(statutorySettings)
    .where(lte(statutorySettings.effectiveFrom, date))
    .orderBy(desc(statutorySettings.effectiveFrom))
    .limit(1);
  return row ?? null;
}

/** Each tax table code's version in force at a date. */
export async function taxTablesAt(db: Db, date: string) {
  const rows = await db
    .select()
    .from(taxTables)
    .where(
      and(
        lte(taxTables.effectiveFrom, date),
        or(isNull(taxTables.effectiveTo), gte(taxTables.effectiveTo, date)),
      ),
    )
    .orderBy(asc(taxTables.code), desc(taxTables.effectiveFrom));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const t of rows) if (!latest.has(t.code)) latest.set(t.code, t);
  const ids = [...latest.values()].map((t) => t.id);
  const slabs = ids.length
    ? await db
        .select()
        .from(taxTableSlabs)
        .where(inArray(taxTableSlabs.tableId, ids))
        .orderBy(asc(taxTableSlabs.fromAmount))
    : [];
  const out = new Map<string, TaxTable & { needsReview: boolean; id: string }>();
  for (const t of latest.values()) {
    out.set(t.code, {
      id: t.id,
      code: t.code,
      method: t.method,
      needsReview: t.needsReview,
      slabs: slabs
        .filter((s) => s.tableId === t.id)
        .map((s) => ({
          from: s.fromAmount,
          to: s.toAmount,
          rate: s.rate,
          deduct: s.deductAmount,
        })),
    });
  }
  return out;
}

/** Employees employed at any point in the period. */
export async function periodStaff(db: Db, p: PeriodRow, ids?: string[]) {
  return db
    .select()
    .from(employees)
    .where(
      and(
        isNull(employees.archivedAt),
        lte(employees.joinDate, p.endDate),
        or(isNull(employees.exitDate), gte(employees.exitDate, p.startDate)),
        ids ? inArray(employees.id, ids) : undefined,
      ),
    )
    .orderBy(asc(employees.employeeNo));
}

/** First month of the tax year containing `date` (company fiscal year start, default April). */
async function taxYearStart(db: Db, date: string): Promise<{ start: string; monthIndex: number }> {
  const [c] = await db
    .select({ m: companyProfile.fiscalYearStartMonth })
    .from(companyProfile)
    .limit(1);
  const startMonth = c?.m ?? 4;
  const [y, m] = date.split('-').map(Number) as [number, number];
  const startYear = m >= startMonth ? y : y - 1;
  const monthIndex = ((m - startMonth + 12) % 12) + 1;
  return { start: `${startYear}-${String(startMonth).padStart(2, '0')}-01`, monthIndex };
}

export interface Prepared {
  employee: EmployeeRow;
  input: PayslipInput;
  config: PayrollConfig;
  snapshot: Record<string, unknown>;
  loanRefs: Map<string, string>;
}

export interface PrepareResult {
  prepared: Prepared[];
  skipped: { employee: EmployeeRow; reason: string }[];
  configSnapshot: Record<string, unknown>;
}

/**
 * Everything the engine needs for a run. `attendanceLocked` decides whether OT and absence come
 * from attendance (payroll only reads locked months unless the setting is off).
 */
export async function prepareRun(
  db: Db,
  run: RunRow,
  period: PeriodRow,
  opts: { tz: string; useAttendance: boolean; otApprovalRequired: boolean },
): Promise<PrepareResult> {
  const stat = await statutoryAt(db, period.endDate);
  if (!stat)
    throw AppError.badRequest(
      `No statutory settings are in force on ${period.endDate}; add them in payroll settings`,
    );
  const comps = await db.select().from(payComponents).where(eq(payComponents.isActive, true));
  const compById = new Map(comps.map((c) => [c.id, c]));
  const tables = await taxTablesAt(db, period.endDate);
  const adjustment = run.type === 'adjustment';

  const inputs = await db
    .select({ i: payrollInputs, c: payComponents })
    .from(payrollInputs)
    .innerJoin(payComponents, eq(payComponents.id, payrollInputs.componentId))
    .where(eq(payrollInputs.runId, run.id));
  const inputEmployees = [...new Set(inputs.map((x) => x.i.employeeId))];
  // Adjustment/off-cycle runs pay only people with inputs; regular runs pay everyone employed.
  const staff =
    run.type === 'regular'
      ? await periodStaff(db, period)
      : inputEmployees.length
        ? await periodStaff(db, period, inputEmployees)
        : [];
  const ids = staff.map((e) => e.id);
  if (!ids.length) {
    return { prepared: [], skipped: [], configSnapshot: snapshotOf(stat, tables, comps) };
  }

  const salaries = await db
    .select()
    .from(employeeSalary)
    .where(
      and(
        inArray(employeeSalary.employeeId, ids),
        lte(employeeSalary.effectiveFrom, period.endDate),
        or(isNull(employeeSalary.effectiveTo), gte(employeeSalary.effectiveTo, period.startDate)),
      ),
    )
    .orderBy(desc(employeeSalary.effectiveFrom));
  const recurring = await db
    .select()
    .from(employeePayComponents)
    .where(
      and(
        inArray(employeePayComponents.employeeId, ids),
        lte(employeePayComponents.effectiveFrom, period.endDate),
        or(
          isNull(employeePayComponents.effectiveTo),
          gte(employeePayComponents.effectiveTo, period.endDate),
        ),
      ),
    );
  const profiles = await db
    .select()
    .from(employeeTaxProfiles)
    .where(
      and(
        inArray(employeeTaxProfiles.employeeId, ids),
        lte(employeeTaxProfiles.effectiveFrom, period.endDate),
      ),
    )
    .orderBy(desc(employeeTaxProfiles.effectiveFrom));

  // Unpaid leave days (no-pay leave types), from approved requests.
  const unpaid = await db
    .select({
      employeeId: leaveRequests.employeeId,
      days: sql<string>`sum(${leaveRequestDays.portion})`,
    })
    .from(leaveRequestDays)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveRequestDays.requestId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        inArray(leaveRequests.employeeId, ids),
        eq(leaveRequests.status, 'approved'),
        eq(leaveTypes.isPaid, false),
        sql`${leaveTypes.unit} <> 'hour'`,
        gte(leaveRequestDays.date, period.startDate),
        lte(leaveRequestDays.date, period.endDate),
      ),
    )
    .groupBy(leaveRequests.employeeId);
  const unpaidBy = new Map(unpaid.map((u) => [u.employeeId, Number(u.days)]));

  const att = opts.useAttendance
    ? await db
        .select({
          employeeId: attendanceDays.employeeId,
          absent: sql<string>`coalesce(sum(${attendanceDays.absentPortion}), 0)`,
          otWork: sql<number>`coalesce(sum(${
            opts.otApprovalRequired
              ? sql`coalesce(${attendanceDays.otApprovedMinutes}, 0)`
              : attendanceDays.otMinutes
          }) filter (where ${attendanceDays.dayType} = 'workday'), 0)::int`,
          otRest: sql<number>`coalesce(sum(${
            opts.otApprovalRequired
              ? sql`coalesce(${attendanceDays.otApprovedMinutes}, 0)`
              : attendanceDays.otMinutes
          }) filter (where ${attendanceDays.dayType} = 'weekend'), 0)::int`,
          otHoliday: sql<number>`coalesce(sum(${
            opts.otApprovalRequired
              ? sql`coalesce(${attendanceDays.otApprovedMinutes}, 0)`
              : attendanceDays.otMinutes
          }) filter (where ${attendanceDays.dayType} = 'holiday'), 0)::int`,
        })
        .from(attendanceDays)
        .where(
          and(
            inArray(attendanceDays.employeeId, ids),
            gte(attendanceDays.date, period.startDate),
            lte(attendanceDays.date, period.endDate),
          ),
        )
        .groupBy(attendanceDays.employeeId)
    : [];
  const attBy = new Map(att.map((a) => [a.employeeId, a]));

  // Loans: active, started, with something left to recover.
  // Loans are recovered only in the regular run.
  const loanRows =
    run.type !== 'regular'
      ? []
      : await db
          .select({
            l: loans,
            recovered: sql<string>`coalesce((select sum(li.amount) from loan_installments li where li.loan_id = "loans"."id" and li.status = 'deducted' and li.period <> ${period.startDate}), 0)`,
          })
          .from(loans)
          .where(
            and(
              inArray(loans.employeeId, ids),
              eq(loans.status, 'active'),
              lte(loans.startPeriod, period.startDate),
            ),
          );

  // Year-to-date APIT for cumulative tables (locked/paid runs earlier in the tax year).
  const ty = await taxYearStart(db, period.startDate);
  const needsYtd = [...tables.values()].some((t) => t.method === 'slab_annual_cumulative');
  const ytd = needsYtd
    ? await db
        .select({
          employeeId: payslips.employeeId,
          base: sql<string>`coalesce(sum(${payslips.apitBase}), 0)`,
          paid: sql<string>`coalesce(sum((select coalesce(sum(pl.amount), 0) from payslip_lines pl where pl.payslip_id = "payslips"."id" and pl.code = 'APIT')), 0)`,
        })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
        .where(
          and(
            inArray(payslips.employeeId, ids),
            inArray(payrollRuns.status, ['locked', 'paid']),
            gte(payrollPeriods.startDate, ty.start),
            sql`${payrollPeriods.startDate} < ${period.startDate}`,
          ),
        )
        .groupBy(payslips.employeeId)
    : [];
  const ytdBy = new Map(ytd.map((y) => [y.employeeId, y]));

  const dayCtx = await loadDayContext(db, opts.tz, ids, period.startDate, period.endDate);
  const statutory: PayrollConfig['statutory'] = {
    epfEmployeeRate: stat.epfEmployeeRate,
    epfEmployerRate: stat.epfEmployerRate,
    etfRate: stat.etfRate,
    nopayDivisorMode: stat.nopayDivisorMode,
    nopayFixedDivisor: stat.nopayFixedDivisor,
    otRateBase: stat.otRateBase,
    nopayBase: stat.nopayBase,
    otDivisor: stat.otDivisor,
    otMultiplierNormal: stat.otMultiplierNormal,
    otMultiplierHoliday: stat.otMultiplierHoliday,
    roundingMode: stat.roundingMode,
    roundingScale: stat.roundingScale,
  };
  const components = comps.map(componentDef);

  const prepared: Prepared[] = [];
  const skipped: PrepareResult['skipped'] = [];
  for (const e of staff) {
    const salary = salaries.find((s) => s.employeeId === e.id);
    if (!salary && !adjustment) {
      skipped.push({ employee: e, reason: 'No salary in force for this period' });
      continue;
    }
    const cal = dayCtx.calendarOf(e);
    const from = e.joinDate > period.startDate ? e.joinDate : period.startDate;
    const to = e.exitDate && e.exitDate < period.endDate ? e.exitDate : period.endDate;
    const workingDays = countWorkingDays(
      period.startDate,
      period.endDate,
      cal.workWeek,
      cal.holidays,
    );
    const employedWorkingDays = countWorkingDays(from, to, cal.workWeek, cal.holidays);

    const a = attBy.get(e.id);
    const otEligible = !!salary?.otEligible;
    const restAsHoliday = stat.restDayOtAsHoliday;
    const otNormalMinutes = otEligible && a ? a.otWork + (restAsHoliday ? 0 : a.otRest) : 0;
    const otHolidayMinutes = otEligible && a ? a.otHoliday + (restAsHoliday ? a.otRest : 0) : 0;
    const absence = salary?.nopayFromAbsence && a ? Number(a.absent) : 0;
    const nopayDays = (unpaidBy.get(e.id) ?? 0) + absence;

    const profile = profiles.find((p) => p.employeeId === e.id);
    const table = profile?.tableCode ? tables.get(profile.tableCode) : undefined;
    const loanRefs = new Map<string, string>();
    const loanItems = loanRows
      .filter((x) => x.l.employeeId === e.id)
      .map((x) => {
        const remaining = money(x.l.principal).minus(x.recovered);
        const due = remaining.lessThan(x.l.installmentAmount)
          ? remaining
          : money(x.l.installmentAmount);
        loanRefs.set(x.l.id, x.l.id);
        return {
          ref: x.l.id,
          code: x.l.type === 'loan' ? 'LOAN_RECOVERY' : 'SALARY_ADVANCE',
          amount: due.toFixed(2),
        };
      })
      .filter((l) => money(l.amount).greaterThan(0));

    const mine = inputs.filter((x) => x.i.employeeId === e.id);
    const y = ytdBy.get(e.id);
    const input: PayslipInput = {
      period: { start: period.startDate, end: period.endDate, workingDays, employedWorkingDays },
      salary: { basic: adjustment ? '0' : salary!.basic },
      recurring: adjustment
        ? []
        : recurring
            .filter((r) => r.employeeId === e.id && compById.has(r.componentId))
            .map((r) => ({ code: compById.get(r.componentId)!.code, amount: r.amount })),
      oneOff: mine.map((x) => ({
        code: x.c.code,
        amount: x.i.amount,
        ...(x.i.note ? { note: x.i.note } : {}),
      })),
      attendance: adjustment
        ? { otNormalMinutes: 0, otHolidayMinutes: 0, nopayDays: 0 }
        : { otNormalMinutes, otHolidayMinutes, nopayDays },
      loans: loanItems,
      ...(table?.method === 'slab_annual_cumulative'
        ? {
            ytd: {
              apitBase: y?.base ?? '0',
              apitPaid: y?.paid ?? '0',
              monthOfTaxYear: ty.monthIndex,
            },
          }
        : {}),
    };
    prepared.push({
      employee: e,
      input,
      config: { statutory, components, taxTable: table ?? null },
      loanRefs,
      snapshot: {
        employee: {
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          nic: e.nic,
          epfNo: e.epfNo,
          departmentId: e.departmentId,
          costCenterId: e.costCenterId,
          joinDate: e.joinDate,
          exitDate: e.exitDate,
        },
        salaryId: salary?.id ?? null,
        taxTable: table?.code ?? null,
        attendanceUsed: opts.useAttendance,
        input,
      },
    });
  }
  return { prepared, skipped, configSnapshot: snapshotOf(stat, tables, comps) };
}

function snapshotOf(
  stat: typeof statutorySettings.$inferSelect,
  tables: Map<string, { id: string; code: string; needsReview: boolean }>,
  comps: ComponentRow[],
) {
  return {
    statutoryId: stat.id,
    statutoryEffectiveFrom: stat.effectiveFrom,
    taxTables: [...tables.values()].map((t) => ({ id: t.id, code: t.code })),
    needsReview:
      stat.needsReview ||
      [...tables.values()].some((t) => t.needsReview) ||
      comps.some((c) => c.needsReview),
    components: comps.length,
  };
}

export function runEngine(p: Prepared): PayslipResult {
  try {
    return calculatePayslip(p.input, p.config);
  } catch (err) {
    if (err instanceof PayrollConfigError)
      throw AppError.badRequest(`${p.employee.employeeNo}: ${err.message}`);
    throw err;
  }
}

/** Is the attendance month for this period locked? */
export async function attendanceLocked(db: Db, period: PeriodRow): Promise<boolean> {
  const [row] = await db
    .select()
    .from(attendancePeriods)
    .where(and(eq(attendancePeriods.year, period.year), eq(attendancePeriods.month, period.month)));
  return row?.status === 'locked';
}

export const totalOf = (values: string[]) => sum(values).toFixed(2);
