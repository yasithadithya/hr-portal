import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { schema, withAudit, type TenantDb, type Tx } from '@hr/db';
import { evaluateFormula, FormulaError, SYSTEM_CODES } from '@hr/payroll';
import {
  bankTemplateInputSchema,
  ok,
  payComponentInputSchema,
  statutoryInputSchema,
  taxTableInputSchema,
  type BankTemplate,
  type PayComponent,
  type Statutory,
  type TaxTableDto,
} from '@hr/shared';
import { money } from '@hr/shared/money';
import { addDays } from '@hr/shared/time';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

const {
  bankFileTemplates,
  payComponents,
  payrollRuns,
  statutorySettings,
  taxTables,
  taxTableSlabs,
} = schema;
type Db = TenantDb | Tx;
const idParams = { params: z.object({ id: z.uuid() }) };

/** Variables a formula may use (the engine provides these). */
const FORMULA_VARS = [
  'BASIC',
  'BASIC_EARNED',
  'WORKING_DAYS',
  'EMPLOYED_DAYS',
  'NOPAY_DAYS',
  'PAID_DAYS',
  'OT_NORMAL_HOURS',
  'OT_HOLIDAY_HOURS',
];

function componentDto(c: typeof payComponents.$inferSelect): PayComponent {
  return {
    id: c.id,
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
    glCode: c.glCode,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    isSystem: c.isSystem,
    needsReview: c.needsReview,
  };
}

const statDto = (s: typeof statutorySettings.$inferSelect): Statutory => ({
  id: s.id,
  effectiveFrom: s.effectiveFrom,
  epfEmployeeRate: money(s.epfEmployeeRate).toString(),
  epfEmployerRate: money(s.epfEmployerRate).toString(),
  etfRate: money(s.etfRate).toString(),
  nopayDivisorMode: s.nopayDivisorMode,
  nopayFixedDivisor: s.nopayFixedDivisor ? money(s.nopayFixedDivisor).toString() : null,
  nopayBase: s.nopayBase,
  otRateBase: s.otRateBase,
  otDivisor: money(s.otDivisor).toString(),
  otMultiplierNormal: money(s.otMultiplierNormal).toString(),
  otMultiplierHoliday: money(s.otMultiplierHoliday).toString(),
  restDayOtAsHoliday: s.restDayOtAsHoliday,
  roundingMode: s.roundingMode,
  roundingScale: s.roundingScale,
  needsReview: s.needsReview,
  notes: s.notes,
});

const bankDto = (b: typeof bankFileTemplates.$inferSelect): BankTemplate => ({
  id: b.id,
  name: b.name,
  bank: b.bank,
  format: b.format,
  spec: b.spec as BankTemplate['spec'],
  needsReview: b.needsReview,
  isActive: b.isActive,
});

async function tableDtos(db: Db): Promise<TaxTableDto[]> {
  const tables = await db
    .select()
    .from(taxTables)
    .orderBy(asc(taxTables.code), desc(taxTables.effectiveFrom));
  const slabs = tables.length
    ? await db
        .select()
        .from(taxTableSlabs)
        .where(
          inArray(
            taxTableSlabs.tableId,
            tables.map((t) => t.id),
          ),
        )
        .orderBy(asc(taxTableSlabs.fromAmount))
    : [];
  return tables.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    method: t.method,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo,
    needsReview: t.needsReview,
    source: t.source,
    slabs: slabs
      .filter((s) => s.tableId === t.id)
      .map((s) => ({
        from: money(s.fromAmount).toString(),
        to: s.toAmount === null ? null : money(s.toAmount).toString(),
        rate: money(s.rate).toString(),
        deduct: money(s.deductAmount).toString(),
      })),
  }));
}

/** Has a locked/paid run's configuration snapshot used this row? Then it is history. */
async function usedByLockedRun(db: Db, key: 'statutoryId' | 'taxTableId', id: string) {
  const cond =
    key === 'statutoryId'
      ? sql`${payrollRuns.configSnapshot}->>'statutoryId' = ${id}`
      : sql`${payrollRuns.configSnapshot}->'taxTables' @> ${JSON.stringify([{ id }])}::jsonb`;
  const [row] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(inArray(payrollRuns.status, ['locked', 'paid']), cond))
    .limit(1);
  return !!row;
}

function checkFormula(formula: string, codes: string[]) {
  const vars = Object.fromEntries([...FORMULA_VARS, ...codes].map((v) => [v, money(1)]));
  try {
    evaluateFormula(formula, vars);
  } catch (err) {
    if (err instanceof FormulaError)
      throw AppError.badRequest(
        `Formula: ${err.message}. You can use ${FORMULA_VARS.join(', ')} and earlier component codes.`,
      );
    throw err;
  }
}

export function payrollConfigRoutes(): Router {
  const router = Router();
  const read = requirePermission('payroll.read', 'all');
  const configure = requirePermission('payroll.configure', 'all');

  // ── Components ─────────────────────────────────────────────────────────────
  router.get('/payroll/components', read, async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(payComponents)
      .orderBy(asc(payComponents.sortOrder), asc(payComponents.code));
    res.json(ok(rows.map(componentDto)));
  });

  const compCreate = { body: payComponentInputSchema };
  router.post('/payroll/components', configure, validate(compCreate), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, compCreate);
    if ((Object.values(SYSTEM_CODES) as string[]).includes(body.code))
      throw AppError.badRequest(`${body.code} is a system component`);
    const codes = (await ctx.db.select({ c: payComponents.code }).from(payComponents)).map(
      (x) => x.c,
    );
    if (body.calc === 'formula') checkFormula(body.formula!, codes);
    const row = await withAudit(ctx.db, ctx.actor, 'pay_components', async (tx) => {
      const [c] = await tx
        .insert(payComponents)
        .values({
          ...body,
          formula: body.calc === 'formula' ? body.formula! : null,
          glCode: body.glCode ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      return { action: 'create', entityId: c!.id, after: c, result: c! };
    });
    res.status(201).json(ok(componentDto(row)));
  });

  const compUpdate = { ...idParams, body: payComponentInputSchema };
  router.put('/payroll/components/:id', configure, validate(compUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, compUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'pay_components', async (tx) => {
      const [before] = await tx.select().from(payComponents).where(eq(payComponents.id, params.id));
      if (!before) throw AppError.notFound('Component not found');
      if (before.isSystem && (body.code !== before.code || body.kind !== before.kind))
        throw AppError.badRequest('The code and kind of a system component cannot change');
      if (!before.isSystem && body.code !== before.code)
        throw AppError.badRequest('A component code cannot change (payslips refer to it)');
      const codes = (await tx.select({ c: payComponents.code }).from(payComponents)).map(
        (x) => x.c,
      );
      if (!before.isSystem && body.calc === 'formula') checkFormula(body.formula!, codes);
      const [c] = await tx
        .update(payComponents)
        .set({
          name: body.name,
          isEpfApplicable: body.isEpfApplicable,
          isEtfApplicable: body.isEtfApplicable,
          isApitApplicable: body.isApitApplicable,
          isProrated: body.isProrated,
          showOnPayslip: body.showOnPayslip,
          glCode: body.glCode ?? null,
          sortOrder: body.sortOrder,
          isActive: before.isSystem ? true : body.isActive,
          ...(before.isSystem
            ? {}
            : {
                kind: body.kind,
                calc: body.calc,
                formula: body.calc === 'formula' ? body.formula! : null,
              }),
          needsReview: false,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(payComponents.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: c, result: c! };
    });
    res.json(ok(componentDto(row)));
  });

  // ── Statutory settings (effective-dated) ───────────────────────────────────
  router.get('/payroll/statutory', read, async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(statutorySettings)
      .orderBy(desc(statutorySettings.effectiveFrom));
    res.json(ok(rows.map(statDto)));
  });

  const statValues = (b: z.output<typeof statutoryInputSchema>) => ({
    ...b,
    nopayFixedDivisor: b.nopayDivisorMode === 'fixed' ? (b.nopayFixedDivisor ?? null) : null,
    notes: b.notes ?? null,
    needsReview: false,
  });
  const statCreate = { body: statutoryInputSchema };
  router.post('/payroll/statutory', configure, validate(statCreate), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, statCreate);
    const row = await withAudit(ctx.db, ctx.actor, 'statutory_settings', async (tx) => {
      const [s] = await tx
        .insert(statutorySettings)
        .values({ ...statValues(body), createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: s!.id, after: s, result: s! };
    });
    res.status(201).json(ok(statDto(row)));
  });

  const statUpdate = { ...idParams, body: statutoryInputSchema };
  router.put('/payroll/statutory/:id', configure, validate(statUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, statUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'statutory_settings', async (tx) => {
      const [before] = await tx
        .select()
        .from(statutorySettings)
        .where(eq(statutorySettings.id, params.id));
      if (!before) throw AppError.notFound('Settings not found');
      if (await usedByLockedRun(tx, 'statutoryId', before.id))
        throw new AppError(
          409,
          'CONFLICT',
          'These settings were used by a locked payroll. Add new settings with a later effective date instead.',
        );
      const [s] = await tx
        .update(statutorySettings)
        .set({ ...statValues(body), updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(statutorySettings.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: s, result: s! };
    });
    res.json(ok(statDto(row)));
  });

  // ── Tax tables (versioned by effective date) ───────────────────────────────
  router.get('/payroll/tax-tables', read, async (req, res) => {
    res.json(ok(await tableDtos(authedCtx(req).db)));
  });

  const slabRows = (tableId: string, b: z.output<typeof taxTableInputSchema>, userId: string) =>
    b.slabs.map((s) => ({
      tableId,
      fromAmount: s.from,
      toAmount: s.to,
      rate: s.rate,
      deductAmount: s.deduct,
      createdBy: userId,
      updatedBy: userId,
    }));

  /** A new version: the previous version of the same code ends the day before. */
  const tableCreate = { body: taxTableInputSchema };
  router.post('/payroll/tax-tables', configure, validate(tableCreate), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, tableCreate);
    await withAudit(ctx.db, ctx.actor, 'tax_tables', async (tx) => {
      await tx
        .update(taxTables)
        .set({ effectiveTo: addDays(body.effectiveFrom, -1), updatedAt: new Date() })
        .where(
          and(
            eq(taxTables.code, body.code),
            lt(taxTables.effectiveFrom, body.effectiveFrom),
            sql`(${taxTables.effectiveTo} is null or ${taxTables.effectiveTo} >= ${body.effectiveFrom})`,
          ),
        );
      const [t] = await tx
        .insert(taxTables)
        .values({
          code: body.code,
          name: body.name,
          method: body.method,
          effectiveFrom: body.effectiveFrom,
          source: body.source ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        })
        .returning();
      await tx.insert(taxTableSlabs).values(slabRows(t!.id, body, ctx.user.id));
      return { action: 'create', entityId: t!.id, after: { ...t, slabs: body.slabs }, result: t };
    });
    res.status(201).json(ok(await tableDtos(ctx.db)));
  });

  const tableUpdate = { ...idParams, body: taxTableInputSchema };
  router.put('/payroll/tax-tables/:id', configure, validate(tableUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, tableUpdate);
    await withAudit(ctx.db, ctx.actor, 'tax_tables', async (tx) => {
      const [before] = await tx.select().from(taxTables).where(eq(taxTables.id, params.id));
      if (!before) throw AppError.notFound('Tax table not found');
      if (await usedByLockedRun(tx, 'taxTableId', before.id))
        throw new AppError(
          409,
          'CONFLICT',
          'This table was used by a locked payroll. Add a new version with a later effective date instead.',
        );
      if (body.code !== before.code || body.effectiveFrom !== before.effectiveFrom)
        throw AppError.badRequest('Code and effective date cannot change; add a new version');
      await tx
        .update(taxTables)
        .set({
          name: body.name,
          method: body.method,
          source: body.source ?? null,
          needsReview: false,
          updatedBy: ctx.user.id,
          updatedAt: new Date(),
        })
        .where(eq(taxTables.id, params.id));
      await tx.delete(taxTableSlabs).where(eq(taxTableSlabs.tableId, params.id));
      await tx.insert(taxTableSlabs).values(slabRows(params.id, body, ctx.user.id));
      return { action: 'update', entityId: params.id, before, after: body, result: null };
    });
    res.json(ok(await tableDtos(ctx.db)));
  });

  // ── Bank file templates ────────────────────────────────────────────────────
  router.get('/payroll/bank-templates', read, async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(bankFileTemplates)
      .orderBy(asc(bankFileTemplates.name));
    res.json(ok(rows.map(bankDto)));
  });

  const bankCreate = { body: bankTemplateInputSchema };
  router.post('/payroll/bank-templates', configure, validate(bankCreate), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, bankCreate);
    const row = await withAudit(ctx.db, ctx.actor, 'bank_file_templates', async (tx) => {
      const [b] = await tx
        .insert(bankFileTemplates)
        .values({ ...body, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: b!.id, after: b, result: b! };
    });
    res.status(201).json(ok(bankDto(row)));
  });

  const bankUpdate = { ...idParams, body: bankTemplateInputSchema };
  router.put('/payroll/bank-templates/:id', configure, validate(bankUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, bankUpdate);
    const row = await withAudit(ctx.db, ctx.actor, 'bank_file_templates', async (tx) => {
      const [before] = await tx
        .select()
        .from(bankFileTemplates)
        .where(eq(bankFileTemplates.id, params.id));
      if (!before) throw AppError.notFound('Template not found');
      const [b] = await tx
        .update(bankFileTemplates)
        .set({ ...body, needsReview: false, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(bankFileTemplates.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: b, result: b! };
    });
    res.json(ok(bankDto(row)));
  });

  return router;
}
