import { z } from 'zod';

import { businessDateSchema } from '../time/index';

/** Money on the wire is a decimal string with up to 2 places (never a JS float). */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), 'Use an amount like 12500 or 12500.50');
const rateString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v), 'Use a number like 8 or 1.5');
const positiveMoney = moneyString.refine((v) => !v.startsWith('-'), 'Must be zero or more');

export const COMPONENT_KINDS = ['earning', 'deduction', 'employer_contribution', 'info'] as const;
export const COMPONENT_CALCS = ['fixed', 'variable', 'formula', 'system'] as const;
export const RUN_STATUSES = ['draft', 'calculated', 'approved', 'locked', 'paid'] as const;
export const RUN_TYPES = ['regular', 'off_cycle', 'adjustment'] as const;
export const ROUNDING_MODES_API = ['half_up', 'half_down', 'half_even', 'up', 'down'] as const;

// ── Components ──────────────────────────────────────────────────────────────
export const payComponentInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Letters, digits and _ only')
      .transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(COMPONENT_KINDS),
    calc: z.enum(['fixed', 'variable', 'formula']),
    formula: z.string().trim().max(500).nullable().optional(),
    isEpfApplicable: z.boolean(),
    isEtfApplicable: z.boolean(),
    isApitApplicable: z.boolean(),
    isProrated: z.boolean(),
    showOnPayslip: z.boolean(),
    glCode: z.string().trim().max(30).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .refine((c) => c.calc !== 'formula' || !!c.formula, {
    message: 'A formula component needs a formula',
    path: ['formula'],
  });
export type PayComponentInput = z.input<typeof payComponentInputSchema>;

export const payComponentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(COMPONENT_KINDS),
  calc: z.enum(COMPONENT_CALCS),
  formula: z.string().nullable(),
  isEpfApplicable: z.boolean(),
  isEtfApplicable: z.boolean(),
  isApitApplicable: z.boolean(),
  isProrated: z.boolean(),
  showOnPayslip: z.boolean(),
  glCode: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  needsReview: z.boolean(),
});
export type PayComponent = z.infer<typeof payComponentSchema>;

// ── Statutory settings ──────────────────────────────────────────────────────
export const statutoryInputSchema = z
  .object({
    effectiveFrom: businessDateSchema,
    epfEmployeeRate: rateString,
    epfEmployerRate: rateString,
    etfRate: rateString,
    nopayDivisorMode: z.enum(['working_days', 'fixed']),
    nopayFixedDivisor: rateString.nullable().optional(),
    nopayBase: z.enum(['basic', 'basic_plus_epf_components']),
    otRateBase: z.enum(['basic', 'basic_plus_epf_components']),
    otDivisor: rateString,
    otMultiplierNormal: rateString,
    otMultiplierHoliday: rateString,
    restDayOtAsHoliday: z.boolean(),
    roundingMode: z.enum(ROUNDING_MODES_API),
    roundingScale: z.number().int().min(0).max(2),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((s) => s.nopayDivisorMode !== 'fixed' || Number(s.nopayFixedDivisor) > 0, {
    message: 'Give the fixed divisor (e.g. 30)',
    path: ['nopayFixedDivisor'],
  })
  .refine((s) => Number(s.otDivisor) > 0, { message: 'Must be above 0', path: ['otDivisor'] });
export type StatutoryInput = z.input<typeof statutoryInputSchema>;

export const statutorySchema = z.object({
  id: z.uuid(),
  effectiveFrom: z.string(),
  epfEmployeeRate: z.string(),
  epfEmployerRate: z.string(),
  etfRate: z.string(),
  nopayDivisorMode: z.enum(['working_days', 'fixed']),
  nopayFixedDivisor: z.string().nullable(),
  nopayBase: z.enum(['basic', 'basic_plus_epf_components']),
  otRateBase: z.enum(['basic', 'basic_plus_epf_components']),
  otDivisor: z.string(),
  otMultiplierNormal: z.string(),
  otMultiplierHoliday: z.string(),
  restDayOtAsHoliday: z.boolean(),
  roundingMode: z.enum(ROUNDING_MODES_API),
  roundingScale: z.number().int(),
  needsReview: z.boolean(),
  notes: z.string().nullable(),
});
export type Statutory = z.infer<typeof statutorySchema>;

// ── Tax tables ──────────────────────────────────────────────────────────────
export const taxSlabInputSchema = z.object({
  from: positiveMoney,
  to: positiveMoney.nullable(),
  rate: rateString,
  deduct: positiveMoney,
});
export const taxTableInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_]+$/)
      .transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1).max(100),
    method: z.enum(['slab_monthly', 'slab_annual_cumulative']),
    effectiveFrom: businessDateSchema,
    source: z.string().trim().max(500).nullable().optional(),
    slabs: z.array(taxSlabInputSchema).min(1).max(30),
  })
  .superRefine((t, ctx) => {
    const s = [...t.slabs].sort((a, b) => Number(a.from) - Number(b.from));
    s.forEach((slab, i) => {
      if (slab.to !== null && Number(slab.to) <= Number(slab.from))
        ctx.addIssue({ code: 'custom', path: ['slabs', i, 'to'], message: 'Must be above "from"' });
      const next = s[i + 1];
      if (next && slab.to !== next.from)
        ctx.addIssue({
          code: 'custom',
          path: ['slabs', i, 'to'],
          message: `Slabs must be continuous (next starts at ${next.from})`,
        });
      if (!next && slab.to !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['slabs', i, 'to'],
          message: 'The last slab must be open-ended',
        });
    });
  });
export type TaxTableInput = z.input<typeof taxTableInputSchema>;

export const taxTableSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  method: z.enum(['slab_monthly', 'slab_annual_cumulative']),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  needsReview: z.boolean(),
  source: z.string().nullable(),
  slabs: z.array(
    z.object({ from: z.string(), to: z.string().nullable(), rate: z.string(), deduct: z.string() }),
  ),
});
export type TaxTableDto = z.infer<typeof taxTableSchema>;

// ── Bank templates ──────────────────────────────────────────────────────────
export const bankColumnSchema = z.object({
  header: z.string().max(60).optional(),
  field: z
    .enum([
      'employeeNo',
      'name',
      'accountName',
      'accountNo',
      'bankName',
      'bankCode',
      'branchCode',
      'amount',
      'reference',
      'payDate',
      'nic',
    ])
    .optional(),
  value: z.string().max(100).optional(),
  width: z.number().int().min(1).max(200).optional(),
  align: z.enum(['left', 'right']).optional(),
  pad: z.string().length(1).optional(),
  format: z
    .enum(['amount_2dp', 'amount_cents', 'upper', 'date:YYYYMMDD', 'date:YYMMDD', 'date:DDMMYYYY'])
    .optional(),
});
export const bankTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    bank: z.string().trim().min(1).max(80),
    format: z.enum(['csv', 'fixed_width']),
    spec: z.object({
      delimiter: z.string().max(3).optional(),
      includeHeader: z.boolean().optional(),
      lineEnding: z.enum(['crlf', 'lf']).optional(),
      columns: z.array(bankColumnSchema).min(1).max(60),
    }),
    isActive: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    t.spec.columns.forEach((c, i) => {
      if (!c.field && c.value === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['spec', 'columns', i],
          message: 'Give a field or a fixed value',
        });
      if (t.format === 'fixed_width' && !c.width)
        ctx.addIssue({
          code: 'custom',
          path: ['spec', 'columns', i, 'width'],
          message: 'Fixed-width columns need a width',
        });
    });
  });
export type BankTemplateInput = z.input<typeof bankTemplateInputSchema>;
export const bankTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  bank: z.string(),
  format: z.enum(['csv', 'fixed_width']),
  spec: z.object({
    delimiter: z.string().optional(),
    includeHeader: z.boolean().optional(),
    lineEnding: z.enum(['crlf', 'lf']).optional(),
    columns: z.array(bankColumnSchema),
  }),
  needsReview: z.boolean(),
  isActive: z.boolean(),
});
export type BankTemplate = z.infer<typeof bankTemplateSchema>;

// ── Employee pay setup ──────────────────────────────────────────────────────
export const salaryInputSchema = z.object({
  effectiveFrom: businessDateSchema,
  basic: positiveMoney,
  nopayFromAbsence: z.boolean().default(false),
  otEligible: z.boolean().default(false),
  reason: z.string().trim().max(200).nullable().optional(),
});
export const recurringInputSchema = z.object({
  componentId: z.uuid(),
  amount: positiveMoney,
  effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable().optional(),
});
export const taxProfileInputSchema = z.object({
  tableCode: z.string().trim().max(30).nullable(),
  isResident: z.boolean(),
  hasSecondaryEmployment: z.boolean(),
  effectiveFrom: businessDateSchema,
});
export const bankCodesInputSchema = z.object({
  bankCode: z.string().trim().max(10).nullable(),
  branchCode: z.string().trim().max(10).nullable(),
});
export const loanInputSchema = z.object({
  type: z.enum(['loan', 'advance']),
  principal: positiveMoney.refine((v) => Number(v) > 0, 'Must be above 0'),
  installmentAmount: positiveMoney.refine((v) => Number(v) > 0, 'Must be above 0'),
  startPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  note: z.string().trim().max(300).nullable().optional(),
});

export const paySetupSchema = z.object({
  employeeId: z.uuid(),
  salaries: z.array(
    z.object({
      id: z.uuid(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
      basic: z.string(),
      nopayFromAbsence: z.boolean(),
      otEligible: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  recurring: z.array(
    z.object({
      id: z.uuid(),
      componentId: z.uuid(),
      code: z.string(),
      name: z.string(),
      kind: z.enum(COMPONENT_KINDS),
      amount: z.string(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
    }),
  ),
  taxProfiles: z.array(
    z.object({
      id: z.uuid(),
      tableCode: z.string().nullable(),
      isResident: z.boolean(),
      hasSecondaryEmployment: z.boolean(),
      effectiveFrom: z.string(),
    }),
  ),
  bank: z.object({
    bankName: z.string().nullable(),
    branch: z.string().nullable(),
    accountNo: z.string().nullable(),
    accountName: z.string().nullable(),
    bankCode: z.string().nullable(),
    branchCode: z.string().nullable(),
  }),
  loans: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(['loan', 'advance']),
      principal: z.string(),
      installmentAmount: z.string(),
      startPeriod: z.string(),
      status: z.enum(['active', 'closed', 'cancelled']),
      recovered: z.string(),
      note: z.string().nullable(),
    }),
  ),
});
export type PaySetup = z.infer<typeof paySetupSchema>;

// ── Periods, runs, inputs ───────────────────────────────────────────────────
export const periodInputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  payDate: businessDateSchema,
});

export const runSchema = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  month: z.string(),
  type: z.enum(RUN_TYPES),
  status: z.enum(RUN_STATUSES),
  payDate: z.string(),
  calculatedAt: z.string().nullable(),
  calculatedBy: z.uuid().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.uuid().nullable(),
  lockedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  totals: z
    .object({
      employees: z.number().int(),
      gross: z.string(),
      deductions: z.string(),
      net: z.string(),
      employerCost: z.string(),
      warnings: z.number().int(),
    })
    .nullable(),
  configNeedsReview: z.boolean(),
  notes: z.string().nullable(),
});
export type PayrollRun = z.infer<typeof runSchema>;

export const runCreateSchema = z.object({
  periodId: z.uuid(),
  type: z.enum(['off_cycle', 'adjustment']),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const readinessSchema = z.object({
  ready: z.boolean(),
  issues: z.array(
    z.object({
      level: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      message: z.string(),
      employees: z.array(z.object({ id: z.uuid(), employeeNo: z.string(), name: z.string() })),
    }),
  ),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const runInputSchema = z.object({
  employeeId: z.uuid(),
  componentId: z.uuid(),
  amount: positiveMoney,
  quantity: z.number().min(0).max(100_000).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});
export const runInputDtoSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  componentId: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(COMPONENT_KINDS),
  amount: z.string(),
  note: z.string().nullable(),
  source: z.string(),
});
export type RunInput = z.infer<typeof runInputDtoSchema>;

// ── Payslips ────────────────────────────────────────────────────────────────
export const payslipLineSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.enum(COMPONENT_KINDS),
  amount: z.string(),
  quantity: z.string().nullable(),
  rate: z.string().nullable(),
});
export const payslipSummarySchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  month: z.string(),
  runType: z.enum(RUN_TYPES),
  runStatus: z.enum(RUN_STATUSES),
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  department: z.string().nullable(),
  gross: z.string(),
  deductions: z.string(),
  net: z.string(),
  employerCost: z.string(),
  previousNet: z.string().nullable(),
  variancePercent: z.number().nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type PayslipSummary = z.infer<typeof payslipSummarySchema>;

export const traceStepSchema = z.object({
  step: z.string(),
  code: z.string().optional(),
  description: z.string(),
  formula: z.string().optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  output: z.string(),
});

export const payslipDetailSchema = payslipSummarySchema.extend({
  payDate: z.string(),
  bases: z.object({ epf: z.string(), etf: z.string(), apit: z.string() }),
  lines: z.array(payslipLineSchema),
  /** Only for payroll staff. */
  trace: z.array(traceStepSchema).nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
});
export type PayslipDetail = z.infer<typeof payslipDetailSchema>;

export const EXPORT_KINDS = ['register', 'epf', 'etf', 'apit', 'bank', 'gl'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
