import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { money } from '@hr/shared/money';

import {
  calculatePayslip,
  ENGINE_VERSION,
  evaluateFormula,
  formulaVariables,
  FormulaError,
  PayrollConfigError,
  type PayrollConfig,
  type PayslipInput,
} from './index';

const FIXTURES = fileURLToPath(new URL('../__fixtures__/', import.meta.url));
const SRC = fileURLToPath(new URL('./', import.meta.url));

const sampleConfig = JSON.parse(
  readFileSync(`${FIXTURES}_sample-config.json`, 'utf8'),
) as PayrollConfig;

interface Fixture {
  name: string;
  noTaxProfile?: boolean;
  configOverride?: { statutory?: Partial<PayrollConfig['statutory']> };
  input: PayslipInput;
  expected: {
    lines?: Record<string, string>;
    absent?: string[];
    totals?: Partial<Record<'gross' | 'deductions' | 'net' | 'employerCost', string>>;
    bases?: Partial<Record<'epf' | 'etf' | 'apit', string>>;
    warnings?: string[];
  };
}

function configFor(f: Fixture): PayrollConfig {
  return {
    ...sampleConfig,
    statutory: { ...sampleConfig.statutory, ...f.configOverride?.statutory },
    taxTable: f.noTaxProfile ? null : sampleConfig.taxTable,
  };
}

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => JSON.parse(readFileSync(`${FIXTURES}${f}`, 'utf8')) as Fixture);

describe('golden fixtures (sample config — to be signed off by an accountant)', () => {
  it('has the cases the plan requires', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(19);
  });

  for (const f of fixtures) {
    it(f.name, () => {
      const r = calculatePayslip(f.input, configFor(f));
      const byCode = new Map<string, string>();
      for (const l of r.lines)
        byCode.set(
          l.code,
          money(byCode.get(l.code) ?? 0)
            .plus(l.amount)
            .toFixed(2),
        );
      for (const [code, amount] of Object.entries(f.expected.lines ?? {}))
        expect(byCode.get(code), `${code}`).toBe(amount);
      for (const code of f.expected.absent ?? []) expect(byCode.has(code), code).toBe(false);
      if (f.expected.totals) expect(r.totals).toMatchObject(f.expected.totals);
      if (f.expected.bases) expect(r.bases).toMatchObject(f.expected.bases);
      if (f.expected.warnings) expect(r.warnings.map((w) => w.code)).toEqual(f.expected.warnings);
      // Internal consistency: net = gross − deductions; every line traced.
      expect(money(r.totals.gross).minus(r.totals.deductions).toFixed(2)).toBe(r.totals.net);
      for (const l of r.lines.filter((x) => x.code !== 'APIT'))
        expect(
          r.trace.some((t) => t.code === l.code),
          `trace for ${l.code}`,
        ).toBe(true);
    });
  }
});

describe('engine behaviour', () => {
  const input = fixtures.find((f) => f.name === '06-ot-normal-and-holiday')!.input;

  it('is deterministic', () => {
    expect(calculatePayslip(input, sampleConfig)).toEqual(calculatePayslip(input, sampleConfig));
  });

  it('reads every rate from config (changing EPF to 10% changes the result)', () => {
    const cfg = {
      ...sampleConfig,
      statutory: { ...sampleConfig.statutory, epfEmployeeRate: '10' },
    };
    const line = calculatePayslip(input, cfg).lines.find((l) => l.code === 'EPF_EE')!;
    expect(line.amount).toBe('9600.00');
  });

  it('uses the fixed no-pay divisor when configured', () => {
    const cfg = {
      ...sampleConfig,
      statutory: {
        ...sampleConfig.statutory,
        nopayDivisorMode: 'fixed' as const,
        nopayFixedDivisor: '30',
      },
    };
    const r = calculatePayslip(
      { ...input, attendance: { otNormalMinutes: 0, otHolidayMinutes: 0, nopayDays: 3 } },
      cfg,
    );
    expect(r.lines.find((l) => l.code === 'NOPAY')!.amount).toBe('9600.00');
  });

  it('applies the rounding mode from config', () => {
    const base = fixtures.find((f) => f.name === '04-leaver-half-day')!.input;
    const down = {
      ...sampleConfig,
      statutory: { ...sampleConfig.statutory, roundingMode: 'down' as const },
    };
    expect(calculatePayslip(base, down).lines.find((l) => l.code === 'ETF')!.amount).toBe(
      '1115.21',
    );
  });

  it('supports cumulative annual tax tables', () => {
    const cfg: PayrollConfig = {
      ...sampleConfig,
      taxTable: {
        code: 'ANNUAL_SAMPLE',
        method: 'slab_annual_cumulative',
        slabs: [
          { from: '0', to: '1200000', rate: '0', deduct: '0' },
          { from: '1200000', to: null, rate: '10', deduct: '120000' },
        ],
      },
    };
    const month1 = {
      ...input,
      salary: { basic: '200000' },
      attendance: { ...input.attendance, otNormalMinutes: 0, otHolidayMinutes: 0 },
    };
    // Annualised 2.4M → tax 120,000/yr → 10,000 for month 1.
    const r1 = calculatePayslip(
      { ...month1, ytd: { apitBase: '0', apitPaid: '0', monthOfTaxYear: 1 } },
      cfg,
    );
    expect(r1.lines.find((l) => l.code === 'APIT')!.amount).toBe('10000.00');
    const r2 = calculatePayslip(
      { ...month1, ytd: { apitBase: '200000', apitPaid: '10000', monthOfTaxYear: 2 } },
      cfg,
    );
    expect(r2.lines.find((l) => l.code === 'APIT')!.amount).toBe('10000.00');
    expect(() => calculatePayslip(month1, cfg)).toThrow(PayrollConfigError);
  });

  it('refuses a component that is not configured', () => {
    expect(() =>
      calculatePayslip({ ...input, recurring: [{ code: 'MYSTERY', amount: '1' }] }, sampleConfig),
    ).toThrow(/MYSTERY is not configured/);
  });

  it('exports a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('formula evaluator', () => {
  const vars = { BASIC: money(100000), NOPAY_DAYS: money(2) };

  it('does decimal arithmetic with precedence, unary minus and min/max', () => {
    expect(evaluateFormula('BASIC * 0.1 + 5', vars).toString()).toBe('10005');
    expect(evaluateFormula('(BASIC - 1000) / 3', vars).toFixed(2)).toBe('33000.00');
    expect(evaluateFormula('-NOPAY_DAYS * 2', vars).toString()).toBe('-4');
    expect(evaluateFormula('max(0, 2000 - NOPAY_DAYS * 1500)', vars).toString()).toBe('0');
    expect(evaluateFormula('0.1 + 0.2', vars).toString()).toBe('0.3');
  });

  it('rejects anything that is not arithmetic on known variables', () => {
    for (const bad of [
      'process.exit(1)',
      'constructor',
      '__proto__',
      'toString',
      'BASIC; 1',
      'BASIC ** 2',
      '`x`',
      'UNKNOWN + 1',
      'BASIC / 0',
      '(BASIC',
      'BASIC 2',
    ])
      expect(() => evaluateFormula(bad, vars), bad).toThrow(FormulaError);
  });

  it('lists referenced variables', () => {
    expect(formulaVariables('max(0, BASIC - NOPAY_DAYS * 500)')).toEqual(['BASIC', 'NOPAY_DAYS']);
  });
});

describe('Hard Rule 1: no statutory constants in engine source', () => {
  // Structural numbers only: 0, 1, 2 (decimal places in a toDecimalPlaces call), 60 minutes,
  // 12 months, 100 percent. Anything else (8, 12.5, 1.5, 240, 150000…) is a rate and must be config.
  const ALLOWED = new Set(['0', '1', '2', '4', '60', '12', '100']);
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it.each(files)('%s contains no rate literals', (file) => {
    const code = readFileSync(`${SRC}${file}`, 'utf8')
      // A line may opt out only by saying why: `// structural-constant: <reason>`.
      .split('\n')
      .filter((line) => !/\/\/ structural-constant: \S/.test(line))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g, "''");
    const literals = [...code.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g)].map((m) => m[0]);
    expect(literals.filter((n) => !ALLOWED.has(n))).toEqual([]);
  });
});
