import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { schema, withAudit, type Tx } from '@hr/db';
import {
  bankCodesInputSchema,
  CURRENT_STATUSES,
  loanInputSchema,
  ok,
  recurringInputSchema,
  salaryInputSchema,
  taxProfileInputSchema,
  type PaySetup,
} from '@hr/shared';
import { money } from '@hr/shared/money';
import { addDays } from '@hr/shared/time';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { tenantToday } from '../employees/service';
import { auditSensitiveRead } from '../privacy/service';

const {
  employeeBankCodes,
  employeePayComponents,
  employeeSalary,
  employeeTaxProfiles,
  employees,
  loans,
  payComponents,
  payrollPeriods,
  payrollRuns,
  payslips,
} = schema;

const empParams = { params: z.object({ id: z.uuid() }) };
const m = (v: string) => money(v).toFixed(2);

async function mustEmployee(tx: Tx | ReturnType<typeof authedCtx>['db'], id: string) {
  const [e] = await tx.select().from(employees).where(eq(employees.id, id));
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}

/** Salary history may not reach back into a month that was paid through a locked run. */
async function assertNotLocked(tx: Tx, employeeId: string, from: string) {
  const [hit] = await tx
    .select({ end: payrollPeriods.endDate })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(
      and(
        eq(payslips.employeeId, employeeId),
        inArray(payrollRuns.status, ['locked', 'paid']),
        gte(payrollPeriods.endDate, from),
      ),
    )
    .limit(1);
  if (hit)
    throw new AppError(
      409,
      'CONFLICT',
      `Payroll up to ${hit.end} is locked. Start the change after that, and pay any difference as arrears.`,
    );
}

export async function paySetup(
  db: ReturnType<typeof authedCtx>['db'],
  id: string,
): Promise<PaySetup> {
  const e = await mustEmployee(db, id);
  const sal = await db
    .select()
    .from(employeeSalary)
    .where(eq(employeeSalary.employeeId, id))
    .orderBy(desc(employeeSalary.effectiveFrom));
  const rec = await db
    .select({ r: employeePayComponents, c: payComponents })
    .from(employeePayComponents)
    .innerJoin(payComponents, eq(payComponents.id, employeePayComponents.componentId))
    .where(eq(employeePayComponents.employeeId, id))
    .orderBy(asc(payComponents.sortOrder), desc(employeePayComponents.effectiveFrom));
  const tax = await db
    .select()
    .from(employeeTaxProfiles)
    .where(eq(employeeTaxProfiles.employeeId, id))
    .orderBy(desc(employeeTaxProfiles.effectiveFrom));
  const [codes] = await db
    .select()
    .from(employeeBankCodes)
    .where(eq(employeeBankCodes.employeeId, id));
  const ln = await db
    .select({
      l: loans,
      recovered: sql<string>`coalesce((select sum(li.amount) from loan_installments li where li.loan_id = "loans"."id" and li.status = 'deducted'), 0)`,
    })
    .from(loans)
    .where(eq(loans.employeeId, id))
    .orderBy(desc(loans.startPeriod));
  return {
    employeeId: id,
    salaries: sal.map((s) => ({
      id: s.id,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      basic: m(s.basic),
      nopayFromAbsence: s.nopayFromAbsence,
      otEligible: s.otEligible,
      reason: s.reason,
    })),
    recurring: rec.map(({ r, c }) => ({
      id: r.id,
      componentId: c.id,
      code: c.code,
      name: c.name,
      kind: c.kind,
      amount: m(r.amount),
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    })),
    taxProfiles: tax.map((t) => ({
      id: t.id,
      tableCode: t.tableCode,
      isResident: t.isResident,
      hasSecondaryEmployment: t.hasSecondaryEmployment,
      effectiveFrom: t.effectiveFrom,
    })),
    bank: {
      bankName: e.bankName,
      branch: e.bankBranch,
      accountNo: e.bankAccountNo,
      accountName: e.bankAccountName,
      bankCode: codes?.bankCode ?? null,
      branchCode: codes?.branchCode ?? null,
    },
    loans: ln.map(({ l, recovered }) => ({
      id: l.id,
      type: l.type,
      principal: m(l.principal),
      installmentAmount: m(l.installmentAmount),
      startPeriod: l.startPeriod.slice(0, 7),
      status: l.status,
      recovered: m(recovered),
      note: l.note,
    })),
  };
}

export function payrollSetupRoutes(): Router {
  const router = Router();
  const read = requirePermission('payroll.read', 'all');
  const run = requirePermission('payroll.run', 'all');

  /** Pay overview for the employee list: current basic, tax table, bank details present. */
  router.get('/payroll/employees', read, async (req, res) => {
    const ctx = authedCtx(req);
    const today = tenantToday(ctx);
    const staff = await ctx.db
      .select()
      .from(employees)
      .where(and(isNull(employees.archivedAt), inArray(employees.status, CURRENT_STATUSES)))
      .orderBy(asc(employees.employeeNo));
    const sal = await ctx.db
      .select()
      .from(employeeSalary)
      .where(
        and(
          lte(employeeSalary.effectiveFrom, today),
          or(isNull(employeeSalary.effectiveTo), gte(employeeSalary.effectiveTo, today)),
        ),
      );
    const tax = await ctx.db
      .select()
      .from(employeeTaxProfiles)
      .where(lte(employeeTaxProfiles.effectiveFrom, today))
      .orderBy(desc(employeeTaxProfiles.effectiveFrom));
    res.json(
      ok(
        staff.map((e) => ({
          employeeId: e.id,
          employeeNo: e.employeeNo,
          name: `${e.firstName} ${e.lastName}`,
          basic: sal.find((s) => s.employeeId === e.id)?.basic ?? null,
          taxTable: tax.find((t) => t.employeeId === e.id)?.tableCode ?? null,
          hasTaxProfile: tax.some((t) => t.employeeId === e.id),
          hasBank: !!e.bankAccountNo,
        })),
      ),
    );
  });

  router.get('/payroll/employees/:id/setup', read, validate(empParams), async (req, res) => {
    const ctx = authedCtx(req);
    const id = parsed(req, empParams).params.id;
    const setup = await paySetup(ctx.db, id);
    await auditSensitiveRead(ctx, 'employee_salary', id, 'view_salary', id);
    res.json(ok(setup));
  });

  /** New salary from a date; the previous one ends the day before (same date = correction). */
  const salSchemas = { ...empParams, body: salaryInputSchema };
  router.post('/payroll/employees/:id/salary', run, validate(salSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, salSchemas);
    await withAudit(ctx.db, ctx.actor, 'employee_salary', async (tx) => {
      const e = await mustEmployee(tx, params.id);
      if (body.effectiveFrom < e.joinDate)
        throw AppError.badRequest('That date is before the join date');
      await assertNotLocked(tx, e.id, body.effectiveFrom);
      const [later] = await tx
        .select({ id: employeeSalary.id })
        .from(employeeSalary)
        .where(
          and(
            eq(employeeSalary.employeeId, e.id),
            sql`${employeeSalary.effectiveFrom} > ${body.effectiveFrom}`,
          ),
        )
        .limit(1);
      if (later) throw AppError.badRequest('A later salary change exists; change that one instead');
      await tx
        .update(employeeSalary)
        .set({
          effectiveTo: addDays(body.effectiveFrom, -1),
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(employeeSalary.employeeId, e.id),
            sql`${employeeSalary.effectiveFrom} < ${body.effectiveFrom}`,
            isNull(employeeSalary.effectiveTo),
          ),
        );
      const [row] = await tx
        .insert(employeeSalary)
        .values({
          employeeId: e.id,
          effectiveFrom: body.effectiveFrom,
          basic: body.basic,
          nopayFromAbsence: body.nopayFromAbsence,
          otEligible: body.otEligible,
          reason: body.reason ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: [employeeSalary.employeeId, employeeSalary.effectiveFrom],
          set: {
            basic: body.basic,
            nopayFromAbsence: body.nopayFromAbsence,
            otEligible: body.otEligible,
            reason: body.reason ?? null,
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { action: 'set_salary', entityId: row!.id, after: row, result: row };
    });
    res.status(201).json(ok(await paySetup(ctx.db, params.id)));
  });

  const recSchemas = { ...empParams, body: recurringInputSchema };
  router.post('/payroll/employees/:id/recurring', run, validate(recSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, recSchemas);
    await withAudit(ctx.db, ctx.actor, 'employee_pay_components', async (tx) => {
      await mustEmployee(tx, params.id);
      const [c] = await tx
        .select()
        .from(payComponents)
        .where(eq(payComponents.id, body.componentId));
      if (!c || !c.isActive) throw AppError.badRequest('Unknown component');
      if (c.isSystem || c.calc === 'variable')
        throw AppError.badRequest(
          `${c.name} cannot be a recurring item (use run inputs for one-offs)`,
        );
      if (body.effectiveTo && body.effectiveTo < body.effectiveFrom)
        throw AppError.badRequest('The end date is before the start date');
      const [row] = await tx
        .insert(employeePayComponents)
        .values({
          employeeId: params.id,
          componentId: c.id,
          amount: body.amount,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'add_recurring', entityId: row!.id, after: row, result: row };
    });
    res.status(201).json(ok(await paySetup(ctx.db, params.id)));
  });

  const endSchemas = {
    params: z.object({ id: z.uuid() }),
    body: z.object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  };
  router.post('/payroll/recurring/:id/end', run, validate(endSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, endSchemas);
    const employeeId = await withAudit(ctx.db, ctx.actor, 'employee_pay_components', async (tx) => {
      const [before] = await tx
        .select()
        .from(employeePayComponents)
        .where(eq(employeePayComponents.id, params.id));
      if (!before) throw AppError.notFound('Item not found');
      if (body.effectiveTo < before.effectiveFrom)
        throw AppError.badRequest('The end date is before the start date');
      const [after] = await tx
        .update(employeePayComponents)
        .set({ effectiveTo: body.effectiveTo, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(employeePayComponents.id, params.id))
        .returning();
      return {
        action: 'end_recurring',
        entityId: params.id,
        before,
        after,
        result: before.employeeId,
      };
    });
    res.json(ok(await paySetup(ctx.db, employeeId)));
  });

  const taxSchemas = { ...empParams, body: taxProfileInputSchema };
  router.put('/payroll/employees/:id/tax-profile', run, validate(taxSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, taxSchemas);
    await withAudit(ctx.db, ctx.actor, 'employee_tax_profiles', async (tx) => {
      await mustEmployee(tx, params.id);
      const [row] = await tx
        .insert(employeeTaxProfiles)
        .values({ ...body, employeeId: params.id, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [employeeTaxProfiles.employeeId, employeeTaxProfiles.effectiveFrom],
          set: {
            tableCode: body.tableCode,
            isResident: body.isResident,
            hasSecondaryEmployment: body.hasSecondaryEmployment,
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { action: 'set_tax_profile', entityId: row!.id, after: row, result: row };
    });
    res.json(ok(await paySetup(ctx.db, params.id)));
  });

  const bankSchemas = { ...empParams, body: bankCodesInputSchema };
  router.put('/payroll/employees/:id/bank-codes', run, validate(bankSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, bankSchemas);
    await withAudit(ctx.db, ctx.actor, 'employee_bank_codes', async (tx) => {
      await mustEmployee(tx, params.id);
      const [row] = await tx
        .insert(employeeBankCodes)
        .values({ ...body, employeeId: params.id, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: employeeBankCodes.employeeId,
          set: { ...body, updatedBy: ctx.user.id, updatedAt: new Date() },
        })
        .returning();
      return { action: 'set_bank_codes', entityId: row!.id, after: row, result: row };
    });
    res.json(ok(await paySetup(ctx.db, params.id)));
  });

  const loanSchemas = { ...empParams, body: loanInputSchema };
  router.post('/payroll/employees/:id/loans', run, validate(loanSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, loanSchemas);
    if (money(body.installmentAmount).greaterThan(body.principal))
      throw AppError.badRequest('The instalment is more than the amount');
    await withAudit(ctx.db, ctx.actor, 'loans', async (tx) => {
      await mustEmployee(tx, params.id);
      const [row] = await tx
        .insert(loans)
        .values({
          employeeId: params.id,
          type: body.type,
          principal: body.principal,
          installmentAmount: body.installmentAmount,
          startPeriod: `${body.startPeriod}-01`,
          note: body.note ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'create', entityId: row!.id, after: row, result: row };
    });
    res.status(201).json(ok(await paySetup(ctx.db, params.id)));
  });

  router.post('/payroll/loans/:id/cancel', run, validate(empParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, empParams);
    const employeeId = await withAudit(ctx.db, ctx.actor, 'loans', async (tx) => {
      const [before] = await tx.select().from(loans).where(eq(loans.id, params.id));
      if (!before) throw AppError.notFound('Loan not found');
      if (before.status !== 'active')
        throw AppError.badRequest(`This loan is already ${before.status}`);
      const [after] = await tx
        .update(loans)
        .set({ status: 'cancelled', updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(loans.id, params.id))
        .returning();
      return { action: 'cancel', entityId: params.id, before, after, result: before.employeeId };
    });
    res.json(ok(await paySetup(ctx.db, employeeId)));
  });

  return router;
}
