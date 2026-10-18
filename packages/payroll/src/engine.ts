import { money, round, sum, type Money } from '@hr/shared/money';

import { evaluateFormula, FormulaError } from './formula';
import type {
  ComponentDef,
  PayrollConfig,
  PayslipInput,
  PayslipLine,
  PayslipResult,
  TaxSlab,
  TraceStep,
} from './types';

/**
 * Pure payroll engine (CLAUDE.md Hard Rule 11, PLAN.md Phase 7). No DB, no I/O, no clock.
 * Every rate, divisor, multiplier and rounding rule comes from `config`; a test fails if a rate
 * literal appears in this package's source.
 *
 * Order: basic (prorated on join/exit) → recurring earnings → one-off earnings → OT → no-pay →
 * bases → EPF/ETF → APIT → loans → other deductions → net.
 */

/** Codes the engine computes itself. They must exist in the component catalogue. */
export const SYSTEM_CODES = {
  basic: 'BASIC',
  otNormal: 'OT',
  otHoliday: 'OT_HOLIDAY',
  nopay: 'NOPAY',
  epfEmployee: 'EPF_EE',
  epfEmployer: 'EPF_ER',
  etf: 'ETF',
  apit: 'APIT',
} as const;

export class PayrollConfigError extends Error {}

const PERCENT = 100;
const MINUTES_PER_HOUR = 60;
const MONTHS_PER_YEAR = 12;

interface Line extends Omit<PayslipLine, 'amount'> {
  amount: Money;
  def: ComponentDef;
}

export function calculatePayslip(input: PayslipInput, config: PayrollConfig): PayslipResult {
  const s = config.statutory;
  const r = (v: Money) => round(v, s.roundingMode, s.roundingScale);
  const pct = (rate: string) => money(rate).dividedBy(PERCENT);
  const defs = new Map(config.components.map((c) => [c.code, c]));
  const def = (code: string): ComponentDef => {
    const d = defs.get(code);
    if (!d) throw new PayrollConfigError(`Pay component ${code} is not configured`);
    return d;
  };

  const trace: TraceStep[] = [];
  const warnings: PayslipResult['warnings'] = [];
  const lines: Line[] = [];
  const add = (code: string, amount: Money, extra: Partial<Line> = {}) => {
    const d = def(code);
    const line: Line = { code, name: d.name, kind: d.kind, amount: r(amount), def: d, ...extra };
    lines.push(line);
    return line;
  };

  // ── 1. Basic, prorated for a partial month ────────────────────────────────
  const basic = money(input.salary.basic);
  const wd = money(input.period.workingDays);
  const employed = money(input.period.employedWorkingDays);
  const partial = wd.greaterThan(0) && employed.lessThan(wd);
  const factor = partial ? employed.dividedBy(wd) : money(1);
  const basicDef = def(SYSTEM_CODES.basic);
  const basicEarned = basicDef.isProrated ? basic.times(factor) : basic;
  const basicLine = add(SYSTEM_CODES.basic, basicEarned);
  trace.push({
    step: 'basic',
    code: SYSTEM_CODES.basic,
    description: partial
      ? 'Basic salary prorated for the days employed this period'
      : 'Basic salary for the full period',
    ...(partial ? { formula: 'BASIC × EMPLOYED_DAYS ÷ WORKING_DAYS' } : {}),
    inputs: {
      BASIC: basic.toString(),
      WORKING_DAYS: wd.toString(),
      EMPLOYED_DAYS: employed.toString(),
    },
    output: basicLine.amount.toFixed(s.roundingScale),
  });

  const nopayDays = money(input.attendance.nopayDays);
  const otNormalHours = money(input.attendance.otNormalMinutes).dividedBy(MINUTES_PER_HOUR);
  const otHolidayHours = money(input.attendance.otHolidayMinutes).dividedBy(MINUTES_PER_HOUR);
  const vars = (): Record<string, Money> => {
    const v: Record<string, Money> = {
      BASIC: basic,
      BASIC_EARNED: basicLine.amount,
      WORKING_DAYS: wd,
      EMPLOYED_DAYS: employed,
      NOPAY_DAYS: nopayDays,
      PAID_DAYS: employed.minus(nopayDays),
      OT_NORMAL_HOURS: otNormalHours,
      OT_HOLIDAY_HOURS: otHolidayHours,
    };
    for (const l of lines) v[l.code] = (v[l.code] ?? money(0)).plus(l.amount);
    return v;
  };

  // ── 2. Recurring earnings (fixed or formula) ──────────────────────────────
  const recurringValue = (item: { code: string; amount: string }, d: ComponentDef) => {
    if (d.calc === 'formula') {
      if (!d.formula) throw new PayrollConfigError(`Component ${d.code} has no formula`);
      try {
        const v = evaluateFormula(d.formula, vars());
        return { value: v, formula: d.formula };
      } catch (err) {
        if (err instanceof FormulaError)
          throw new PayrollConfigError(`Formula for ${d.code}: ${err.message}`);
        throw err;
      }
    }
    const full = money(item.amount);
    return d.isProrated && partial
      ? { value: full.times(factor), formula: `${d.code} × EMPLOYED_DAYS ÷ WORKING_DAYS` }
      : { value: full };
  };
  const ordered = (items: { code: string; amount: string }[]) =>
    [...items].sort((a, b) => def(a.code).sortOrder - def(b.code).sortOrder);

  for (const item of ordered(input.recurring)) {
    const d = def(item.code);
    if (d.kind !== 'earning') continue;
    const { value, formula } = recurringValue(item, d);
    const l = add(item.code, value);
    trace.push({
      step: 'recurring_earning',
      code: item.code,
      description: `${d.name} (recurring)`,
      ...(formula ? { formula } : {}),
      inputs: { amount: item.amount },
      output: l.amount.toFixed(s.roundingScale),
    });
  }

  // ── 3. One-off earnings ───────────────────────────────────────────────────
  for (const item of input.oneOff) {
    const d = def(item.code);
    if (d.kind !== 'earning') continue;
    const l = add(item.code, money(item.amount));
    trace.push({
      step: 'one_off_earning',
      code: item.code,
      description: `${d.name}${item.note ? ` — ${item.note}` : ''}`,
      output: l.amount.toFixed(s.roundingScale),
    });
  }

  // Base for OT and no-pay: basic (full month) or basic + recurring fixed EPF earnings.
  const rateBase = (mode: 'basic' | 'basic_plus_epf_components') => {
    if (mode === 'basic') return basic;
    const extra = input.recurring
      .map((i) => ({ i, d: def(i.code) }))
      .filter(({ d }) => d.kind === 'earning' && d.isEpfApplicable && d.calc === 'fixed')
      .map(({ i }) => money(i.amount));
    return basic.plus(sum(extra));
  };

  // ── 4. Overtime ───────────────────────────────────────────────────────────
  const otBase = rateBase(s.otRateBase);
  const hourly = otBase.dividedBy(s.otDivisor);
  for (const [code, hours, mult, label] of [
    [SYSTEM_CODES.otNormal, otNormalHours, s.otMultiplierNormal, 'normal'],
    [SYSTEM_CODES.otHoliday, otHolidayHours, s.otMultiplierHoliday, 'rest-day/holiday'],
  ] as const) {
    if (hours.isZero()) continue;
    const l = add(code, hours.times(hourly).times(mult), {
      quantity: hours.toDecimalPlaces(2).toString(),
      rate: r(hourly.times(mult)).toString(),
    });
    trace.push({
      step: 'overtime',
      code,
      description: `Overtime (${label})`,
      formula: `HOURS × (${s.otRateBase === 'basic' ? 'BASIC' : 'BASIC + EPF allowances'} ÷ OT_DIVISOR) × MULTIPLIER`,
      inputs: {
        HOURS: hours.toDecimalPlaces(4).toString(),
        BASE: otBase.toString(),
        OT_DIVISOR: s.otDivisor,
        MULTIPLIER: mult,
      },
      output: l.amount.toFixed(s.roundingScale),
    });
  }

  // ── 5. No-pay ─────────────────────────────────────────────────────────────
  if (nopayDays.greaterThan(0)) {
    const divisor = s.nopayDivisorMode === 'fixed' ? money(s.nopayFixedDivisor ?? '') : money(wd);
    if (divisor.lessThanOrEqualTo(0))
      throw new PayrollConfigError('No-pay divisor must be greater than zero');
    const nopayBase = rateBase(s.nopayBase);
    const perDay = nopayBase.dividedBy(divisor);
    // Never deduct more than the basic actually earned.
    let value = perDay.times(nopayDays);
    if (value.greaterThan(basicLine.amount)) {
      value = basicLine.amount;
      warnings.push({
        code: 'NOPAY_CAPPED',
        message: 'No-pay deduction was capped at the basic earned this period',
      });
    }
    const l = add(SYSTEM_CODES.nopay, value, {
      quantity: nopayDays.toString(),
      rate: r(perDay).toString(),
    });
    trace.push({
      step: 'nopay',
      code: SYSTEM_CODES.nopay,
      description: 'No-pay deduction',
      formula: `NOPAY_DAYS × (BASE ÷ ${s.nopayDivisorMode === 'fixed' ? 'FIXED_DIVISOR' : 'WORKING_DAYS'})`,
      inputs: {
        NOPAY_DAYS: nopayDays.toString(),
        BASE: nopayBase.toString(),
        DIVISOR: divisor.toString(),
      },
      output: l.amount.toFixed(s.roundingScale),
    });
  }

  // ── 6. Bases ──────────────────────────────────────────────────────────────
  const baseFor = (flag: 'isEpfApplicable' | 'isEtfApplicable' | 'isApitApplicable') =>
    sum(
      lines
        .filter((l) => l.def[flag] && (l.kind === 'earning' || l.kind === 'deduction'))
        .map((l) => (l.kind === 'earning' ? l.amount : l.amount.negated())),
    );
  const clamp0 = (v: Money) => (v.isNegative() ? money(0) : v);
  const epfBase = clamp0(baseFor('isEpfApplicable'));
  const etfBase = clamp0(baseFor('isEtfApplicable'));
  const apitBase = clamp0(baseFor('isApitApplicable'));
  for (const [name, v, flag] of [
    ['EPF', epfBase, 'EPF-applicable'],
    ['ETF', etfBase, 'ETF-applicable'],
    ['APIT', apitBase, 'APIT-applicable'],
  ] as const) {
    trace.push({
      step: 'base',
      description: `${name} base = ${flag} earnings − ${flag} deductions`,
      inputs: Object.fromEntries(
        lines
          .filter(
            (l) =>
              l.def[
                name === 'EPF'
                  ? 'isEpfApplicable'
                  : name === 'ETF'
                    ? 'isEtfApplicable'
                    : 'isApitApplicable'
              ],
          )
          .map((l) => [l.code, (l.kind === 'earning' ? l.amount : l.amount.negated()).toString()]),
      ),
      output: v.toFixed(s.roundingScale),
    });
  }

  // ── 7. EPF / ETF ──────────────────────────────────────────────────────────
  for (const [code, base, rate, label] of [
    [SYSTEM_CODES.epfEmployee, epfBase, s.epfEmployeeRate, 'EPF employee contribution'],
    [SYSTEM_CODES.epfEmployer, epfBase, s.epfEmployerRate, 'EPF employer contribution'],
    [SYSTEM_CODES.etf, etfBase, s.etfRate, 'ETF employer contribution'],
  ] as const) {
    const l = add(code, base.times(pct(rate)), { rate });
    trace.push({
      step: 'statutory',
      code,
      description: label,
      formula: 'BASE × RATE%',
      inputs: { BASE: base.toString(), RATE: rate },
      output: l.amount.toFixed(s.roundingScale),
    });
  }

  // ── 8. APIT ───────────────────────────────────────────────────────────────
  if (config.taxTable) {
    const t = config.taxTable;
    let tax: Money;
    let formula: string;
    const inputs: Record<string, string> = { TABLE: t.code };
    if (t.method === 'slab_monthly') {
      const slab = findSlab(t.slabs, apitBase);
      tax = slabTax(slab, apitBase);
      formula = 'BASE × RATE% − DEDUCT';
      Object.assign(inputs, slabInputs(slab), { BASE: apitBase.toString() });
    } else {
      if (!input.ytd)
        throw new PayrollConfigError('Cumulative tax tables need year-to-date figures');
      const m = money(input.ytd.monthOfTaxYear);
      const cumulative = money(input.ytd.apitBase).plus(apitBase);
      const annualised = cumulative.times(MONTHS_PER_YEAR).dividedBy(m);
      const slab = findSlab(t.slabs, annualised);
      const dueToDate = slabTax(slab, annualised).times(m).dividedBy(MONTHS_PER_YEAR);
      tax = clamp0(dueToDate.minus(input.ytd.apitPaid));
      formula = '(ANNUAL_TAX(CUMULATIVE × 12 ÷ MONTH) × MONTH ÷ 12) − PAID_TO_DATE';
      Object.assign(inputs, slabInputs(slab), {
        CUMULATIVE: cumulative.toString(),
        MONTH: m.toString(),
        PAID_TO_DATE: input.ytd.apitPaid,
      });
    }
    const l = add(SYSTEM_CODES.apit, clamp0(tax));
    trace.push({
      step: 'apit',
      code: SYSTEM_CODES.apit,
      description: `APIT (${t.code})`,
      formula,
      inputs,
      output: l.amount.toFixed(s.roundingScale),
    });
  } else {
    trace.push({
      step: 'apit',
      description: 'No APIT: the employee has no tax profile',
      output: money(0).toFixed(s.roundingScale),
    });
  }

  // ── 9–10. Loans, then other deductions (never pushing net below zero) ─────
  const netSoFar = () => {
    const earn = sum(lines.filter((l) => l.kind === 'earning').map((l) => l.amount));
    const ded = sum(lines.filter((l) => l.kind === 'deduction').map((l) => l.amount));
    return earn.minus(ded);
  };
  if (netSoFar().isNegative()) {
    warnings.push({
      code: 'NEGATIVE_NET',
      message: 'Statutory deductions exceed earnings; net pay is negative',
    });
  }
  const capped = (code: string, wanted: Money, extra: Partial<Line>, description: string) => {
    const room = clamp0(netSoFar());
    const take = wanted.greaterThan(room) ? room : wanted;
    if (take.lessThan(wanted)) {
      warnings.push({
        code: 'DEDUCTION_SHORTFALL',
        message: `${description}: only ${r(take).toString()} of ${r(wanted).toString()} could be deducted`,
      });
    }
    if (take.isZero() && wanted.greaterThan(0)) return;
    const l = add(code, take, extra);
    trace.push({
      step: 'deduction',
      code,
      description,
      inputs: { requested: r(wanted).toString(), available: r(room).toString() },
      output: l.amount.toFixed(s.roundingScale),
    });
  };
  for (const loan of input.loans) {
    if (def(loan.code).kind !== 'deduction')
      throw new PayrollConfigError(`${loan.code} must be a deduction`);
    capped(loan.code, money(loan.amount), { ref: loan.ref }, `${def(loan.code).name} instalment`);
  }
  const otherDeductions = [
    ...ordered(input.recurring)
      .filter((i) => def(i.code).kind === 'deduction')
      .map((i) => ({
        code: i.code,
        value: recurringValue(i, def(i.code)).value,
        note: 'recurring',
      })),
    ...input.oneOff
      .filter((i) => def(i.code).kind === 'deduction')
      .map((i) => ({ code: i.code, value: money(i.amount), note: i.note ?? 'one-off' })),
  ];
  for (const d of otherDeductions) capped(d.code, d.value, {}, `${def(d.code).name} (${d.note})`);

  // Info / employer lines from recurring items (e.g. a benefit shown on the payslip).
  for (const item of input.recurring) {
    const d = def(item.code);
    if (d.kind === 'info' || d.kind === 'employer_contribution') {
      add(item.code, recurringValue(item, d).value);
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const gross = sum(lines.filter((l) => l.kind === 'earning').map((l) => l.amount));
  const deductions = sum(lines.filter((l) => l.kind === 'deduction').map((l) => l.amount));
  const employerCost = gross.plus(
    sum(lines.filter((l) => l.kind === 'employer_contribution').map((l) => l.amount)),
  );
  const net = gross.minus(deductions);
  trace.push({
    step: 'net',
    description: 'Net pay = gross earnings − deductions',
    inputs: { gross: gross.toString(), deductions: deductions.toString() },
    output: net.toFixed(s.roundingScale),
  });

  const f = (v: Money) => v.toFixed(s.roundingScale);
  return {
    lines: lines.map(({ def: d, amount, ...l }) => {
      void d;
      return { ...l, amount: f(amount) };
    }),
    totals: {
      gross: f(gross),
      deductions: f(deductions),
      net: f(net),
      employerCost: f(employerCost),
    },
    bases: { epf: f(epfBase), etf: f(etfBase), apit: f(apitBase) },
    warnings,
    trace,
  };
}

function findSlab(slabs: TaxSlab[], base: Money): TaxSlab {
  const sorted = [...slabs].sort((a, b) => money(a.from).comparedTo(b.from));
  const hit = sorted.find(
    (sl) => base.greaterThan(sl.from) && (sl.to === null || base.lessThanOrEqualTo(sl.to)),
  );
  // A base at or below the lowest bound uses the first slab (normally the nil band).
  const slab = hit ?? sorted[0];
  if (!slab) throw new PayrollConfigError('The tax table has no slabs');
  return slab;
}

function slabTax(slab: TaxSlab, base: Money): Money {
  const t = base.times(slab.rate).dividedBy(PERCENT).minus(slab.deduct);
  return t.isNegative() ? money(0) : t;
}

function slabInputs(slab: TaxSlab): Record<string, string> {
  return {
    SLAB: `${slab.from} – ${slab.to ?? '∞'}`,
    RATE: slab.rate,
    DEDUCT: slab.deduct,
  };
}
