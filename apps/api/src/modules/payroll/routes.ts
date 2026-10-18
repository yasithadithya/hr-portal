import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { schema, scopeCondition, withAudit } from '@hr/db';
import {
  csvCell,
  EXPORT_KINDS,
  ok,
  periodInputSchema,
  runCreateSchema,
  runInputSchema,
  type PayslipDetail,
  type RunInput,
} from '@hr/shared';
import { money, sum } from '@hr/shared/money';

import { authedCtx, scopeOf, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { getSettings } from '../company/routes';

import { buildBankFile, BankFileError, type PaymentRow } from './bankFile';
import { payslipPdf } from './pdf';
import * as service from './service';

const {
  bankFileTemplates,
  companyProfile,
  costCenters,
  departments,
  employeeBankCodes,
  employees,
  payComponents,
  payrollInputs,
  payrollPeriods,
  payrollRuns,
  payslipLines,
  payslips,
} = schema;
type Ctx = RequestContext & { user: AuthedUser };

const idParams = { params: z.object({ id: z.uuid() }) };
const BOM = String.fromCharCode(0xfeff);

function sendCsv(res: Response, name: string, rows: unknown[][]) {
  res
    .type('text/csv; charset=utf-8')
    .attachment(name)
    .send(`${BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
}

async function payslipDetail(
  ctx: Ctx,
  id: string,
  withTrace: boolean,
): Promise<PayslipDetail | null> {
  const [row] = await ctx.db
    .select({ s: payslips, r: payrollRuns, p: payrollPeriods, e: employees, d: departments.name })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(payslips.id, id));
  if (!row) return null;
  const lines = await ctx.db
    .select()
    .from(payslipLines)
    .where(eq(payslipLines.payslipId, id))
    .orderBy(asc(payslipLines.sortOrder));
  const comps = await ctx.db
    .select({ code: payComponents.code, show: payComponents.showOnPayslip })
    .from(payComponents);
  const hidden = new Set(comps.filter((c) => !c.show).map((c) => c.code));
  const { s, r, p, e, d } = row;
  return {
    id: s.id,
    runId: r.id,
    month: service.monthKey(p),
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
    previousNet: null,
    variancePercent: null,
    warnings: s.warnings,
    payDate: p.payDate,
    bases: { epf: s.epfBase, etf: s.etfBase, apit: s.apitBase },
    lines: lines
      .filter((l) => withTrace || !hidden.has(l.code))
      .map((l) => ({
        code: l.code,
        name: l.name,
        kind: l.kind,
        amount: l.amount,
        quantity: l.quantity === null ? null : money(l.quantity).toString(),
        rate: l.rate === null ? null : money(l.rate).toFixed(2),
      })),
    trace: withTrace ? (s.trace as PayslipDetail['trace']) : null,
    snapshot: withTrace ? (s.snapshot as Record<string, unknown>) : null,
  };
}

/** Data behind every export: payslips of a run with employee, department, cost centre, lines. */
async function exportRows(ctx: Ctx, runId: string) {
  const rows = await ctx.db
    .select({
      s: payslips,
      e: employees,
      dept: departments.name,
      cc: costCenters.code,
      codes: employeeBankCodes,
    })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(costCenters, eq(costCenters.id, employees.costCenterId))
    .leftJoin(employeeBankCodes, eq(employeeBankCodes.employeeId, employees.id))
    .where(eq(payslips.runId, runId))
    .orderBy(asc(employees.employeeNo));
  const lines = rows.length
    ? await ctx.db
        .select()
        .from(payslipLines)
        .where(
          inArray(
            payslipLines.payslipId,
            rows.map((r) => r.s.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    lines: lines.filter((l) => l.payslipId === r.s.id),
    amount: (code: string) =>
      sum(
        lines.filter((l) => l.payslipId === r.s.id && l.code === code).map((l) => l.amount),
      ).toFixed(2),
  }));
}

export function payrollRunRoutes(): Router {
  const router = Router();
  const read = requirePermission('payroll.read', 'all');
  const run = requirePermission('payroll.run', 'all');
  const approve = requirePermission('payroll.approve', 'all');
  const lock = requirePermission('payroll.lock', 'all');

  // ── Periods & runs ─────────────────────────────────────────────────────────
  router.get('/payroll/runs', read, async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select({ r: payrollRuns, p: payrollPeriods })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .orderBy(desc(payrollPeriods.startDate), asc(payrollRuns.createdAt))
      .limit(120);
    res.json(ok(rows.map(({ r, p }) => service.runDto(r, p))));
  });

  const periodSchemas = { body: periodInputSchema };
  router.post('/payroll/periods', run, validate(periodSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, periodSchemas);
    const { run: r, period: p } = await service.createPeriod(ctx, body.month, body.payDate);
    res.status(201).json(ok(service.runDto(r, p)));
  });

  const createRun = { body: runCreateSchema };
  router.post('/payroll/runs', run, validate(createRun), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, createRun);
    const out = await withAudit(ctx.db, ctx.actor, 'payroll_runs', async (tx) => {
      const [p] = await tx
        .select()
        .from(payrollPeriods)
        .where(eq(payrollPeriods.id, body.periodId));
      if (!p) throw AppError.notFound('Payroll period not found');
      const [r] = await tx
        .insert(payrollRuns)
        .values({
          periodId: p.id,
          type: body.type,
          notes: body.notes ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'create', entityId: r!.id, after: r, result: service.runDto(r!, p) };
    });
    res.status(201).json(ok(out));
  });

  router.get('/payroll/runs/:id', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { r, p } = await service.loadRun(ctx.db, parsed(req, idParams).params.id);
    res.json(ok(service.runDto(r, p)));
  });

  router.delete('/payroll/runs/:id', run, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    await service.deleteDraftRun(ctx, parsed(req, idParams).params.id);
    res.json(ok({ deleted: true }));
  });

  router.get('/payroll/runs/:id/readiness', read, validate(idParams), async (req, res) => {
    res.json(ok(await service.readiness(authedCtx(req), parsed(req, idParams).params.id)));
  });

  router.post('/payroll/runs/:id/calculate', run, validate(idParams), async (req, res) => {
    res.json(ok(await service.calculate(authedCtx(req), parsed(req, idParams).params.id)));
  });

  for (const [t, guard] of [
    ['approve', approve],
    ['reopen', approve],
    ['lock', lock],
    ['paid', lock],
  ] as const) {
    router.post(`/payroll/runs/:id/${t}`, guard, validate(idParams), async (req, res) => {
      res.json(ok(await service.transition(authedCtx(req), parsed(req, idParams).params.id, t)));
    });
  }

  router.get('/payroll/runs/:id/payslips', read, validate(idParams), async (req, res) => {
    res.json(ok(await service.runPayslips(authedCtx(req), parsed(req, idParams).params.id)));
  });

  // ── One-off inputs ─────────────────────────────────────────────────────────
  async function inputDtos(ctx: Ctx, runId: string): Promise<RunInput[]> {
    const rows = await ctx.db
      .select({ i: payrollInputs, c: payComponents, e: employees })
      .from(payrollInputs)
      .innerJoin(payComponents, eq(payComponents.id, payrollInputs.componentId))
      .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
      .where(eq(payrollInputs.runId, runId))
      .orderBy(asc(employees.employeeNo), asc(payComponents.sortOrder));
    return rows.map(({ i, c, e }) => ({
      id: i.id,
      employeeId: e.id,
      employeeNo: e.employeeNo,
      employeeName: `${e.firstName} ${e.lastName}`,
      componentId: c.id,
      code: c.code,
      name: c.name,
      kind: c.kind,
      amount: i.amount,
      note: i.note,
      source: i.source,
    }));
  }

  router.get('/payroll/runs/:id/inputs', read, validate(idParams), async (req, res) => {
    res.json(ok(await inputDtos(authedCtx(req), parsed(req, idParams).params.id)));
  });

  const inputSchemas = { ...idParams, body: runInputSchema };
  router.post('/payroll/runs/:id/inputs', run, validate(inputSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, inputSchemas);
    await withAudit(ctx.db, ctx.actor, 'payroll_inputs', async (tx) => {
      const { r } = await service.loadRun(tx, params.id, true);
      if (r.status !== 'draft' && r.status !== 'calculated')
        throw AppError.badRequest(`Inputs cannot change on a ${r.status} run`);
      const [c] = await tx
        .select()
        .from(payComponents)
        .where(eq(payComponents.id, body.componentId));
      if (
        !c ||
        !c.isActive ||
        c.isSystem ||
        c.kind === 'info' ||
        c.kind === 'employer_contribution'
      )
        throw AppError.badRequest('Choose an earning or deduction component');
      const [e] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, body.employeeId));
      if (!e) throw AppError.badRequest('Unknown employee');
      const [row] = await tx
        .insert(payrollInputs)
        .values({
          runId: r.id,
          employeeId: body.employeeId,
          componentId: c.id,
          amount: body.amount,
          quantity:
            body.quantity === null || body.quantity === undefined ? null : String(body.quantity),
          note: body.note ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      // Results are stale until recalculated.
      if (r.status === 'calculated')
        await tx
          .update(payrollRuns)
          .set({ status: 'draft', updatedAt: new Date() })
          .where(eq(payrollRuns.id, r.id));
      return { action: 'add_input', entityId: row!.id, after: row, result: row };
    });
    res.status(201).json(ok(await inputDtos(ctx, params.id)));
  });

  const inputDelete = { params: z.object({ id: z.uuid(), inputId: z.uuid() }) };
  router.delete(
    '/payroll/runs/:id/inputs/:inputId',
    run,
    validate(inputDelete),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, inputDelete);
      await withAudit(ctx.db, ctx.actor, 'payroll_inputs', async (tx) => {
        const { r } = await service.loadRun(tx, params.id, true);
        if (r.status !== 'draft' && r.status !== 'calculated')
          throw AppError.badRequest(`Inputs cannot change on a ${r.status} run`);
        const [before] = await tx
          .delete(payrollInputs)
          .where(and(eq(payrollInputs.id, params.inputId), eq(payrollInputs.runId, r.id)))
          .returning();
        if (!before) throw AppError.notFound('Input not found');
        if (r.status === 'calculated')
          await tx
            .update(payrollRuns)
            .set({ status: 'draft', updatedAt: new Date() })
            .where(eq(payrollRuns.id, r.id));
        return { action: 'delete_input', entityId: params.inputId, before, result: null };
      });
      res.json(ok(await inputDtos(ctx, params.id)));
    },
  );

  // ── Exports ────────────────────────────────────────────────────────────────
  const exportSchemas = {
    params: z.object({ id: z.uuid(), kind: z.enum(EXPORT_KINDS) }),
    query: z.object({ templateId: z.uuid().optional() }),
  };
  router.get('/payroll/runs/:id/export/:kind', read, validate(exportSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, query } = parsed(req, exportSchemas);
    const { r, p } = await service.loadRun(ctx.db, params.id);
    const month = service.monthKey(p);
    const allowed =
      params.kind === 'register'
        ? ['calculated', 'approved', 'locked', 'paid']
        : ['approved', 'locked', 'paid'];
    if (!allowed.includes(r.status))
      throw AppError.badRequest(
        params.kind === 'register'
          ? 'Calculate the payroll first'
          : 'Statutory, bank and GL exports are available once the payroll is approved',
      );
    const rows = await exportRows(ctx, r.id);
    const [company] = await ctx.db.select().from(companyProfile).limit(1);
    await withAudit(ctx.db, ctx.actor, 'payroll_exports', async () => ({
      action: `export_${params.kind}`,
      entityId: r.id,
      after: { kind: params.kind, rows: rows.length },
      result: null,
    }));
    const base = `payroll-${month}${r.type !== 'regular' ? `-${r.type}` : ''}`;

    if (params.kind === 'register') {
      const comps = await ctx.db.select().from(payComponents).orderBy(asc(payComponents.sortOrder));
      const used = comps.filter((c) => rows.some((x) => x.lines.some((l) => l.code === c.code)));
      return sendCsv(res, `${base}-register.csv`, [
        [
          'Employee no',
          'Name',
          'Department',
          ...used.map((c) => c.name),
          'Gross',
          'Deductions',
          'Net',
          'Employer cost',
        ],
        ...rows.map((x) => [
          x.e.employeeNo,
          `${x.e.firstName} ${x.e.lastName}`,
          x.dept ?? '',
          ...used.map((c) => x.amount(c.code)),
          x.s.gross,
          x.s.totalDeductions,
          x.s.net,
          x.s.employerCost,
        ]),
      ]);
    }
    if (params.kind === 'epf') {
      // SAMPLE C-Form data layout — confirm the exact format with the client's accountant.
      return sendCsv(res, `${base}-epf-schedule.csv`, [
        ['Employer EPF no', company?.epfRegNo ?? '', 'Month', month],
        [
          'Member no',
          'NIC',
          'Name',
          'Total earnings',
          'Employee (EPF_EE)',
          'Employer (EPF_ER)',
          'Total contribution',
        ],
        ...rows
          .filter((x) => money(x.s.epfBase).greaterThan(0))
          .map((x) => {
            const ee = x.amount('EPF_EE');
            const er = x.amount('EPF_ER');
            return [
              x.e.epfNo ?? '',
              x.e.nic ?? '',
              `${x.e.firstName} ${x.e.lastName}`,
              x.s.epfBase,
              ee,
              er,
              money(ee).plus(er).toFixed(2),
            ];
          }),
      ]);
    }
    if (params.kind === 'etf') {
      return sendCsv(res, `${base}-etf-schedule.csv`, [
        ['Employer ETF no', company?.etfRegNo ?? '', 'Month', month],
        ['Member no', 'NIC', 'Name', 'Total earnings', 'Contribution (ETF)'],
        ...rows
          .filter((x) => money(x.s.etfBase).greaterThan(0))
          .map((x) => [
            x.e.etfNo ?? x.e.epfNo ?? '',
            x.e.nic ?? '',
            `${x.e.firstName} ${x.e.lastName}`,
            x.s.etfBase,
            x.amount('ETF'),
          ]),
      ]);
    }
    if (params.kind === 'apit') {
      return sendCsv(res, `${base}-apit-schedule.csv`, [
        ['Employer TIN', company?.tin ?? '', 'Month', month],
        ['Employee no', 'Name', 'NIC', 'TIN', 'Taxable remuneration', 'APIT deducted'],
        ...rows.map((x) => [
          x.e.employeeNo,
          `${x.e.firstName} ${x.e.lastName}`,
          x.e.nic ?? '',
          x.e.taxFileNo ?? '',
          x.s.apitBase,
          x.amount('APIT'),
        ]),
      ]);
    }
    if (params.kind === 'gl') {
      // Sample journal: earnings and employer contributions debit; deductions, contributions payable and net pay credit.
      const comps = await ctx.db.select().from(payComponents);
      const gl = new Map(comps.map((c) => [c.code, c.glCode ?? c.code]));
      const acc = new Map<
        string,
        {
          gl: string;
          cc: string;
          debit: ReturnType<typeof money>;
          credit: ReturnType<typeof money>;
        }
      >();
      const post = (glCode: string, cc: string, debit: string, credit: string) => {
        const k = `${glCode}|${cc}`;
        const cur = acc.get(k) ?? { gl: glCode, cc, debit: money(0), credit: money(0) };
        cur.debit = cur.debit.plus(debit);
        cur.credit = cur.credit.plus(credit);
        acc.set(k, cur);
      };
      for (const x of rows) {
        const cc = x.cc ?? '';
        for (const l of x.lines) {
          const code = gl.get(l.code) ?? l.code;
          if (l.kind === 'earning') post(code, cc, l.amount, '0');
          else if (l.kind === 'deduction') post(code, cc, '0', l.amount);
          else if (l.kind === 'employer_contribution') {
            post(`${code}_EXPENSE`, cc, l.amount, '0');
            post(`${code}_PAYABLE`, cc, '0', l.amount);
          }
        }
        post('NET_SALARY_PAYABLE', cc, '0', x.s.net);
      }
      return sendCsv(res, `${base}-journal.csv`, [
        ['GL code', 'Cost centre', 'Debit', 'Credit', 'Description'],
        ...[...acc.values()]
          .sort((a, b) => a.gl.localeCompare(b.gl) || a.cc.localeCompare(b.cc))
          .map((a) => [a.gl, a.cc, a.debit.toFixed(2), a.credit.toFixed(2), `Payroll ${month}`]),
      ]);
    }
    // bank
    const [tpl] = query.templateId
      ? await ctx.db
          .select()
          .from(bankFileTemplates)
          .where(eq(bankFileTemplates.id, query.templateId))
      : await ctx.db
          .select()
          .from(bankFileTemplates)
          .where(eq(bankFileTemplates.isActive, true))
          .orderBy(asc(bankFileTemplates.name))
          .limit(1);
    if (!tpl) throw AppError.badRequest('Add a bank file template first');
    const payments: PaymentRow[] = rows
      .filter((x) => money(x.s.net).greaterThan(0) && x.e.bankAccountNo)
      .map((x) => ({
        employeeNo: x.e.employeeNo,
        name: `${x.e.firstName} ${x.e.lastName}`,
        accountName: x.e.bankAccountName ?? `${x.e.firstName} ${x.e.lastName}`,
        accountNo: x.e.bankAccountNo ?? '',
        bankName: x.e.bankName ?? '',
        bankCode: x.codes?.bankCode ?? '',
        branchCode: x.codes?.branchCode ?? '',
        amount: x.s.net,
        reference: `SALARY ${month}`,
        payDate: p.payDate,
        nic: x.e.nic ?? '',
      }));
    try {
      const text = buildBankFile(tpl.format, tpl.spec, payments);
      res
        .type(tpl.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8')
        .attachment(
          `${base}-bank-${tpl.bank.toLowerCase().replace(/\W+/g, '-')}.${tpl.format === 'csv' ? 'csv' : 'txt'}`,
        )
        .send(text);
    } catch (err) {
      if (err instanceof BankFileError) throw AppError.badRequest(err.message);
      throw err;
    }
  });

  /** T-10 data: per employee totals for a tax year, from locked/paid runs (SAMPLE layout). */
  const t10Schemas = { query: z.object({ year: z.coerce.number().int().min(2000).max(2100) }) };
  router.get('/payroll/reports/t10', read, validate(t10Schemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, t10Schemas);
    const [company] = await ctx.db.select().from(companyProfile).limit(1);
    const startMonth = company?.fiscalYearStartMonth ?? 4;
    const from = `${query.year}-${String(startMonth).padStart(2, '0')}-01`;
    const to = `${startMonth === 1 ? query.year : query.year + 1}-${String(startMonth === 1 ? 12 : startMonth - 1).padStart(2, '0')}-28`;
    const rows = await ctx.db
      .select({
        e: employees,
        gross: sql<string>`sum(${payslips.gross})`,
        apitBase: sql<string>`sum(${payslips.apitBase})`,
        apit: sql<string>`coalesce(sum((select sum(pl.amount) from payslip_lines pl where pl.payslip_id = "payslips"."id" and pl.code = 'APIT')), 0)`,
      })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(
        and(
          inArray(payrollRuns.status, ['locked', 'paid']),
          gte(payrollPeriods.startDate, from),
          lte(payrollPeriods.startDate, to),
        ),
      )
      .groupBy(employees.id)
      .orderBy(asc(employees.employeeNo));
    sendCsv(res, `t10-${query.year}-${query.year + 1}.csv`, [
      [
        'Employer',
        company?.name ?? '',
        'TIN',
        company?.tin ?? '',
        'Tax year',
        `${query.year}/${query.year + 1}`,
      ],
      [
        'Employee no',
        'Name',
        'NIC',
        'TIN',
        'Gross remuneration',
        'Taxable remuneration',
        'APIT deducted',
      ],
      ...rows.map((x) => [
        x.e.employeeNo,
        `${x.e.firstName} ${x.e.lastName}`,
        x.e.nic ?? '',
        x.e.taxFileNo ?? '',
        money(x.gross).toFixed(2),
        money(x.apitBase).toFixed(2),
        money(x.apit).toFixed(2),
      ]),
    ]);
  });

  // ── Payslips (payroll staff and self-service) ──────────────────────────────
  const listSchemas = { query: z.object({ employeeId: z.uuid().optional() }) };
  router.get(
    '/payslips',
    requirePermission('payslips.read'),
    validate(listSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { query } = parsed(req, listSchemas);
      const payrollStaff = ctx.permissions['payroll.read'] === 'all';
      const rows = await ctx.db
        .select({ s: payslips, r: payrollRuns, p: payrollPeriods, e: employees })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
        .innerJoin(employees, eq(employees.id, payslips.employeeId))
        .where(
          and(
            scopeCondition(scopeOf(req, 'payslips.read'), ctx.user.employeeId, employees.id),
            query.employeeId
              ? eq(payslips.employeeId, query.employeeId)
              : eq(
                  payslips.employeeId,
                  ctx.user.employeeId ?? '00000000-0000-0000-0000-000000000000',
                ),
            // Employees see a payslip only once payroll is locked.
            payrollStaff ? undefined : inArray(payrollRuns.status, ['locked', 'paid']),
          ),
        )
        .orderBy(desc(payrollPeriods.startDate))
        .limit(60);
      res.json(
        ok(
          rows.map(({ s, r, p, e }) => ({
            id: s.id,
            runId: r.id,
            month: service.monthKey(p),
            runType: r.type,
            runStatus: r.status,
            employeeId: e.id,
            employeeNo: e.employeeNo,
            employeeName: `${e.firstName} ${e.lastName}`,
            department: null,
            gross: s.gross,
            deductions: s.totalDeductions,
            net: s.net,
            employerCost: s.employerCost,
            previousNet: null,
            variancePercent: null,
            warnings: payrollStaff ? s.warnings : [],
          })),
        ),
      );
    },
  );

  /** Visible = own payslip of a locked run, or any payslip for payroll staff (and in payslips.read scope). */
  async function visiblePayslip(ctx: Ctx, req: Express.Request, id: string) {
    const payrollStaff = ctx.permissions['payroll.read'] === 'all';
    const [row] = await ctx.db
      .select({ id: payslips.id, status: payrollRuns.status })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .innerJoin(employees, eq(employees.id, payslips.employeeId))
      .where(
        and(
          eq(payslips.id, id),
          payrollStaff
            ? undefined
            : scopeCondition(scopeOf(req, 'payslips.read'), ctx.user.employeeId, employees.id),
        ),
      );
    if (!row || (!payrollStaff && !['locked', 'paid'].includes(row.status)))
      throw AppError.notFound('Payslip not found');
    return payrollStaff;
  }

  router.get(
    '/payslips/:id',
    requirePermission('payslips.read'),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      const staff = await visiblePayslip(ctx, req, params.id);
      res.json(ok(await payslipDetail(ctx, params.id, staff)));
    },
  );

  router.get(
    '/payslips/:id/pdf',
    requirePermission('payslips.read'),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      await visiblePayslip(ctx, req, params.id);
      const detail = (await payslipDetail(ctx, params.id, false))!;
      const [e] = await ctx.db.select().from(employees).where(eq(employees.id, detail.employeeId));
      const [company] = await ctx.db.select().from(companyProfile).limit(1);
      const settings = await getSettings(ctx.db);
      const mode = settings['payroll.payslip_password'];
      const password =
        mode === 'nic' ? e?.nic : mode === 'dob' ? e?.dob?.replaceAll('-', '') : null;
      if (mode !== 'none' && !password)
        throw AppError.badRequest(
          `Payslips are protected with the employee's ${mode === 'nic' ? 'NIC' : 'date of birth'}, which is missing`,
        );
      const addr = company?.address;
      const pdf = await payslipPdf(
        detail,
        {
          companyName: company?.legalName ?? company?.name ?? ctx.tenant.name,
          address: addr
            ? [addr.line1, addr.line2, addr.city].filter(Boolean).join(', ') || null
            : null,
          color: settings['branding.primary_color'],
        },
        { password: password ?? null, nic: e?.nic ?? null, epfNo: e?.epfNo ?? null },
      );
      await withAudit(ctx.db, ctx.actor, 'payslips', async () => ({
        action: 'download_pdf',
        entityId: params.id,
        result: null,
      }));
      res
        .type('application/pdf')
        .attachment(`payslip-${detail.month}-${detail.employeeNo}.pdf`)
        .send(pdf);
    },
  );

  return router;
}
