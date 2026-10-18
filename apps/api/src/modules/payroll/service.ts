import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { schema, withAudit, type TenantDb, type Tx } from '@hr/db';
import type { PayrollRun, PayslipSummary, Readiness } from '@hr/shared';
import { money } from '@hr/shared/money';
import { monthRange } from '@hr/shared/time';

import type { AuthedUser, RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { getSettings } from '../company/routes';

import {
  attendanceLocked,
  periodStaff,
  prepareRun,
  runEngine,
  statutoryAt,
  taxTablesAt,
  type PeriodRow,
  type RunRow,
} from './calc';

const {
  departments,
  employeeSalary,
  employeeTaxProfiles,
  employees,
  loanInstallments,
  payComponents,
  payrollPeriods,
  payrollRuns,
  payslipLines,
  payslips,
} = schema;

type Ctx = RequestContext & { user: AuthedUser };
type Db = TenantDb | Tx;

export const monthKey = (p: Pick<PeriodRow, 'year' | 'month'>) =>
  `${p.year}-${String(p.month).padStart(2, '0')}`;

export async function loadRun(db: Db, id: string, forUpdate = false) {
  const q = db
    .select({ r: payrollRuns, p: payrollPeriods })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(eq(payrollRuns.id, id));
  const [row] = forUpdate ? await q.for('update', { of: payrollRuns }) : await q;
  if (!row) throw AppError.notFound('Payroll run not found');
  return row;
}

export function runDto(r: RunRow, p: PeriodRow): PayrollRun {
  const snap = (r.configSnapshot ?? null) as { needsReview?: boolean } | null;
  return {
    id: r.id,
    periodId: p.id,
    month: monthKey(p),
    type: r.type,
    status: r.status,
    payDate: p.payDate,
    calculatedAt: r.calculatedAt?.toISOString() ?? null,
    calculatedBy: r.calculatedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    approvedBy: r.approvedBy,
    lockedAt: r.lockedAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    totals: (r.totals as PayrollRun['totals']) ?? null,
    configNeedsReview: snap?.needsReview ?? false,
    notes: r.notes,
  };
}

export async function createPeriod(ctx: Ctx, month: string, payDate: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const range = monthRange(y, m);
  return withAudit(ctx.db, ctx.actor, 'payroll_periods', async (tx) => {
    const [existing] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.year, y), eq(payrollPeriods.month, m)));
    if (existing) throw new AppError(409, 'CONFLICT', `Payroll for ${month} already exists`);
    const [p] = await tx
      .insert(payrollPeriods)
      .values({
        year: y,
        month: m,
        startDate: range.start,
        endDate: range.end,
        payDate,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      })
      .returning();
    const [r] = await tx
      .insert(payrollRuns)
      .values({ periodId: p!.id, type: 'regular', createdBy: ctx.user.id, updatedBy: ctx.user.id })
      .returning();
    return { action: 'open_period', entityId: p!.id, after: p, result: { run: r!, period: p! } };
  });
}

/** Problems to fix before calculating (errors block; warnings inform). */
export async function readiness(ctx: Ctx, runId: string): Promise<Readiness> {
  const { r, p } = await loadRun(ctx.db, runId);
  const issues: Readiness['issues'] = [];
  const who = (e: typeof employees.$inferSelect) => ({
    id: e.id,
    employeeNo: e.employeeNo,
    name: `${e.firstName} ${e.lastName}`,
  });
  const settings = await getSettings(ctx.db);
  const stat = await statutoryAt(ctx.db, p.endDate);
  if (!stat)
    issues.push({
      level: 'error',
      code: 'NO_STATUTORY',
      message: `No statutory settings are in force on ${p.endDate}`,
      employees: [],
    });
  const tables = await taxTablesAt(ctx.db, p.endDate);
  const [reviewComp] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(payComponents)
    .where(and(eq(payComponents.needsReview, true), eq(payComponents.isActive, true)));
  if (stat?.needsReview || [...tables.values()].some((t) => t.needsReview) || reviewComp?.n)
    issues.push({
      level: 'warning',
      code: 'SAMPLE_CONFIG',
      message:
        'Payroll settings still contain SAMPLE values (statutory rates, tax table or components). Have them checked before paying real salaries.',
      employees: [],
    });
  if (settings['payroll.require_locked_attendance'] && r.type === 'regular') {
    if (!(await attendanceLocked(ctx.db, p)))
      issues.push({
        level: 'error',
        code: 'ATTENDANCE_NOT_LOCKED',
        message: `Attendance for ${monthKey(p)} is not locked. Lock it (Attendance → Monthly) so OT and absences are final.`,
        employees: [],
      });
  }
  if (r.type !== 'regular') return { ready: !issues.some((i) => i.level === 'error'), issues };

  const staff = await periodStaff(ctx.db, p);
  const ids = staff.map((e) => e.id);
  const withSalary = new Set(
    ids.length
      ? (
          await ctx.db
            .select({ id: employeeSalary.employeeId })
            .from(employeeSalary)
            .where(
              and(
                inArray(employeeSalary.employeeId, ids),
                sql`${employeeSalary.effectiveFrom} <= ${p.endDate}`,
                sql`(${employeeSalary.effectiveTo} is null or ${employeeSalary.effectiveTo} >= ${p.startDate})`,
              ),
            )
        ).map((x) => x.id)
      : [],
  );
  const noSalary = staff.filter((e) => !withSalary.has(e.id));
  if (noSalary.length)
    issues.push({
      level: 'warning',
      code: 'NO_SALARY',
      message: `${noSalary.length} employee(s) have no salary and will be left out`,
      employees: noSalary.map(who),
    });
  const noBank = staff.filter((e) => withSalary.has(e.id) && !e.bankAccountNo);
  if (noBank.length)
    issues.push({
      level: 'warning',
      code: 'NO_BANK',
      message: `${noBank.length} employee(s) have no bank account (not in the bank file)`,
      employees: noBank.map(who),
    });
  const profiled = new Set(
    ids.length
      ? (
          await ctx.db
            .select({ id: employeeTaxProfiles.employeeId })
            .from(employeeTaxProfiles)
            .where(inArray(employeeTaxProfiles.employeeId, ids))
        ).map((x) => x.id)
      : [],
  );
  const noTax = staff.filter((e) => withSalary.has(e.id) && !profiled.has(e.id));
  if (noTax.length)
    issues.push({
      level: 'warning',
      code: 'NO_TAX_PROFILE',
      message: `${noTax.length} employee(s) have no tax profile: no APIT will be deducted`,
      employees: noTax.map(who),
    });
  const exits = staff.filter((e) => e.exitDate && e.exitDate <= p.endDate);
  if (exits.length)
    issues.push({
      level: 'info',
      code: 'EXITS',
      message: `${exits.length} employee(s) leave this month (paid up to their exit date)`,
      employees: exits.map(who),
    });
  const joiners = staff.filter((e) => e.joinDate > p.startDate);
  if (joiners.length)
    issues.push({
      level: 'info',
      code: 'JOINERS',
      message: `${joiners.length} employee(s) joined this month (prorated)`,
      employees: joiners.map(who),
    });
  return { ready: !issues.some((i) => i.level === 'error'), issues };
}

/** Calculate (or recalculate) a run. Deterministic: same data → same payslips. */
export async function calculate(ctx: Ctx, runId: string) {
  const ready = await readiness(ctx, runId);
  const blocking = ready.issues.filter((i) => i.level === 'error');
  if (blocking.length)
    throw new AppError(409, 'CONFLICT', blocking.map((i) => i.message).join(' '), {
      issues: blocking,
    });
  const settings = await getSettings(ctx.db);

  return withAudit(ctx.db, ctx.actor, 'payroll_runs', async (tx) => {
    const { r, p } = await loadRun(tx, runId, true);
    if (r.status !== 'draft' && r.status !== 'calculated')
      throw AppError.badRequest(`A ${r.status} run cannot be recalculated`);
    const prep = await prepareRun(tx, r, p, {
      tz: ctx.tenant.timezone,
      useAttendance: r.type === 'regular',
      otApprovalRequired: settings['attendance.ot_requires_approval'],
    });

    // Clear this run's previous results (and the loan instalments they planned).
    await tx
      .delete(loanInstallments)
      .where(
        and(
          eq(loanInstallments.status, 'due'),
          sql`${loanInstallments.payslipId} in (select id from payslips where run_id = ${r.id})`,
        ),
      );
    await tx.delete(payslips).where(eq(payslips.runId, r.id));

    const comps = await tx.select().from(payComponents);
    const compByCode = new Map(comps.map((c) => [c.code, c]));
    let gross = money(0);
    let deductions = money(0);
    let net = money(0);
    let employerCost = money(0);
    let warnings = 0;
    const results = prep.prepared.map((x) => ({ x, res: runEngine(x) }));

    for (let i = 0; i < results.length; i += 200) {
      const chunk = results.slice(i, i + 200);
      const inserted = await tx
        .insert(payslips)
        .values(
          chunk.map(({ x, res }) => ({
            runId: r.id,
            employeeId: x.employee.id,
            gross: res.totals.gross,
            totalDeductions: res.totals.deductions,
            net: res.totals.net,
            employerCost: res.totals.employerCost,
            epfBase: res.bases.epf,
            etfBase: res.bases.etf,
            apitBase: res.bases.apit,
            snapshot: x.snapshot,
            trace: res.trace,
            warnings: res.warnings,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })),
        )
        .returning({ id: payslips.id, employeeId: payslips.employeeId });
      const idBy = new Map(inserted.map((s) => [s.employeeId, s.id]));
      const lineRows = chunk.flatMap(({ x, res }) =>
        res.lines.map((l, idx) => ({
          payslipId: idBy.get(x.employee.id)!,
          componentId: compByCode.get(l.code)?.id ?? null,
          code: l.code,
          name: l.name,
          kind: l.kind,
          amount: l.amount,
          quantity: l.quantity ?? null,
          rate: l.rate ?? null,
          ref: l.ref ?? null,
          sortOrder: idx,
        })),
      );
      if (lineRows.length) await tx.insert(payslipLines).values(lineRows);
      const installments = chunk.flatMap(({ x, res }) =>
        res.lines
          .filter((l) => l.ref && x.loanRefs.has(l.ref))
          .map((l) => ({
            loanId: l.ref!,
            period: p.startDate,
            amount: l.amount,
            status: 'due' as const,
            payslipId: idBy.get(x.employee.id)!,
          })),
      );
      if (installments.length)
        await tx
          .insert(loanInstallments)
          .values(installments)
          .onConflictDoUpdate({
            target: [loanInstallments.loanId, loanInstallments.period],
            set: {
              amount: sql`excluded.amount`,
              payslipId: sql`excluded.payslip_id`,
              status: 'due',
            },
          });
      for (const { res } of chunk) {
        gross = gross.plus(res.totals.gross);
        deductions = deductions.plus(res.totals.deductions);
        net = net.plus(res.totals.net);
        employerCost = employerCost.plus(res.totals.employerCost);
        warnings += res.warnings.length;
      }
    }

    const totals = {
      employees: results.length,
      gross: gross.toFixed(2),
      deductions: deductions.toFixed(2),
      net: net.toFixed(2),
      employerCost: employerCost.toFixed(2),
      warnings,
      skipped: prep.skipped.map((s) => ({ employeeNo: s.employee.employeeNo, reason: s.reason })),
    };
    const [after] = await tx
      .update(payrollRuns)
      .set({
        status: 'calculated',
        calculatedAt: new Date(),
        calculatedBy: ctx.user.id,
        configSnapshot: prep.configSnapshot,
        totals,
        updatedBy: ctx.user.id,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, r.id))
      .returning();
    if (r.type === 'regular')
      await tx
        .update(payrollPeriods)
        .set({ status: 'calculated' })
        .where(eq(payrollPeriods.id, p.id));
    return {
      action: 'calculate',
      entityId: r.id,
      before: { status: r.status, totals: r.totals },
      after: { status: 'calculated', totals },
      result: runDto(after!, p),
    };
  });
}

type Transition = 'approve' | 'reopen' | 'lock' | 'paid';
const FROM: Record<Transition, RunRow['status']> = {
  approve: 'calculated',
  reopen: 'approved',
  lock: 'approved',
  paid: 'locked',
};

/** Maker-checker: the preparer cannot approve (unless the tenant relaxed it). */
export async function transition(ctx: Ctx, runId: string, t: Transition) {
  const settings = await getSettings(ctx.db);
  return withAudit(ctx.db, ctx.actor, 'payroll_runs', async (tx) => {
    const { r, p } = await loadRun(tx, runId, true);
    if (r.status !== FROM[t])
      throw AppError.badRequest(
        `Only a ${FROM[t]} run can be ${t === 'paid' ? 'marked paid' : `${t}d`}`,
      );
    const now = new Date();
    let set: Partial<typeof payrollRuns.$inferInsert>;
    if (t === 'approve') {
      if (r.calculatedBy === ctx.user.id && !settings['payroll.allow_self_approval'])
        throw AppError.forbidden('The person who calculated this payroll cannot approve it');
      const [neg] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(payslips)
        .where(and(eq(payslips.runId, r.id), sql`${payslips.net} < 0`));
      if (neg?.n)
        throw AppError.badRequest(`${neg.n} payslip(s) have negative net pay; fix them first`);
      set = { status: 'approved', approvedAt: now, approvedBy: ctx.user.id };
    } else if (t === 'reopen') {
      set = { status: 'calculated', approvedAt: null, approvedBy: null };
    } else if (t === 'lock') {
      set = { status: 'locked', lockedAt: now, lockedBy: ctx.user.id };
    } else {
      set = { status: 'paid', paidAt: now, paidBy: ctx.user.id };
    }
    if (t === 'lock') {
      // Loan instalments become recovered; fully recovered loans close.
      await tx
        .update(loanInstallments)
        .set({ status: 'deducted', updatedAt: now })
        .where(
          and(
            eq(loanInstallments.period, p.startDate),
            eq(loanInstallments.status, 'due'),
            sql`${loanInstallments.payslipId} in (select id from payslips where run_id = ${r.id})`,
          ),
        );
      await tx.execute(sql`
        update loans set status = 'closed', updated_at = now()
        where status = 'active' and principal <= (
          select coalesce(sum(amount), 0) from loan_installments
          where loan_id = loans.id and status = 'deducted')`);
    }
    const [after] = await tx
      .update(payrollRuns)
      .set({ ...set, updatedBy: ctx.user.id, updatedAt: now })
      .where(eq(payrollRuns.id, r.id))
      .returning();
    if (r.type === 'regular' && t !== 'reopen')
      await tx
        .update(payrollPeriods)
        .set({ status: after!.status === 'draft' ? 'open' : (after!.status as 'approved') })
        .where(eq(payrollPeriods.id, p.id));
    if (r.type === 'regular' && t === 'reopen')
      await tx
        .update(payrollPeriods)
        .set({ status: 'calculated' })
        .where(eq(payrollPeriods.id, p.id));
    return {
      action: t,
      entityId: r.id,
      before: { status: r.status },
      after: { status: after!.status },
      result: runDto(after!, p),
    };
  });
}

/** Payslips of a run with variance against the employee's previous regular payslip. */
export async function runPayslips(ctx: Ctx, runId: string): Promise<PayslipSummary[]> {
  const { r, p } = await loadRun(ctx.db, runId);
  const rows = await ctx.db
    .select({ s: payslips, e: employees, d: departments.name })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(payslips.runId, r.id))
    .orderBy(asc(employees.employeeNo));
  const ids = rows.map((x) => x.e.id);
  const prev = ids.length
    ? await ctx.db
        .selectDistinctOn([payslips.employeeId], {
          employeeId: payslips.employeeId,
          net: payslips.net,
        })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
        .where(
          and(
            inArray(payslips.employeeId, ids),
            eq(payrollRuns.type, 'regular'),
            ne(payrollRuns.id, r.id),
            sql`${payrollPeriods.startDate} < ${p.startDate}`,
            inArray(payrollRuns.status, ['approved', 'locked', 'paid']),
          ),
        )
        .orderBy(payslips.employeeId, desc(payrollPeriods.startDate))
    : [];
  const prevBy = new Map(prev.map((x) => [x.employeeId, x.net]));
  return rows.map(({ s, e, d }) => {
    const pn = prevBy.get(e.id) ?? null;
    const variance =
      pn && !money(pn).isZero()
        ? money(s.net).minus(pn).dividedBy(pn).times(100).toDecimalPlaces(1).toNumber()
        : null;
    return {
      id: s.id,
      runId: r.id,
      month: monthKey(p),
      runType: r.type,
      runStatus: r.status,
      employeeId: e.id,
      employeeNo: e.employeeNo,
      employeeName: `${e.firstName} ${e.lastName}`,
      department: d,
      gross: s.gross,
      deductions: s.totalDeductions,
      net: s.net,
      employerCost: s.employerCost,
      previousNet: pn,
      variancePercent: variance,
      warnings: s.warnings,
    };
  });
}

export async function deleteDraftRun(ctx: Ctx, runId: string) {
  return withAudit(ctx.db, ctx.actor, 'payroll_runs', async (tx) => {
    const { r } = await loadRun(tx, runId, true);
    if (r.type === 'regular')
      throw AppError.badRequest('The regular run of a period cannot be deleted');
    if (r.status !== 'draft' && r.status !== 'calculated')
      throw AppError.badRequest(`A ${r.status} run cannot be deleted`);
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, r.id));
    return { action: 'delete', entityId: r.id, before: r, result: null };
  });
}
