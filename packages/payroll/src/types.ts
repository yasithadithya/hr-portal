import type { RoundingMode } from '@hr/shared/money';

/**
 * Engine contracts. Amounts and rates are decimal strings (never JS numbers for money).
 * Rates are percentages ("8" = 8%). Everything statutory comes from `PayrollConfig`.
 */

export type ComponentKind = 'earning' | 'deduction' | 'employer_contribution' | 'info';
export type ComponentCalc = 'fixed' | 'variable' | 'formula' | 'system';

export interface ComponentDef {
  code: string;
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  formula?: string | null;
  isEpfApplicable: boolean;
  isEtfApplicable: boolean;
  isApitApplicable: boolean;
  /** Fixed recurring amounts are prorated for a partial month (join/exit). */
  isProrated: boolean;
  showOnPayslip: boolean;
  sortOrder: number;
}

export interface StatutoryConfig {
  epfEmployeeRate: string;
  epfEmployerRate: string;
  etfRate: string;
  /** No-pay day value = base ÷ (working days in the period | fixed divisor). */
  nopayDivisorMode: 'working_days' | 'fixed';
  nopayFixedDivisor: string | null;
  /** basic, or basic + recurring fixed EPF-applicable earnings. Used by OT and no-pay. */
  otRateBase: 'basic' | 'basic_plus_epf_components';
  nopayBase: 'basic' | 'basic_plus_epf_components';
  /** Hourly OT rate = base ÷ divisor. */
  otDivisor: string;
  otMultiplierNormal: string;
  otMultiplierHoliday: string;
  roundingMode: RoundingMode;
  roundingScale: number;
}

export interface TaxSlab {
  from: string;
  /** null = no upper limit. A base falls in a slab when from < base <= to. */
  to: string | null;
  rate: string;
  /** IRD "rate less fixed amount" form. */
  deduct: string;
}

export interface TaxTable {
  code: string;
  /** slab_monthly: slabs apply to the month's base. slab_annual_cumulative: annual slabs on the year-to-date base. */
  method: 'slab_monthly' | 'slab_annual_cumulative';
  slabs: TaxSlab[];
}

export interface PayrollConfig {
  statutory: StatutoryConfig;
  /** null = employee has no tax profile (no APIT). */
  taxTable: TaxTable | null;
  components: ComponentDef[];
}

export interface PayslipInput {
  period: {
    start: string;
    end: string;
    /** Working days in the period per the employee's calendar (half days = 0.5). */
    workingDays: number;
    /** Working days the employee was employed in the period (join/exit). */
    employedWorkingDays: number;
  };
  salary: { basic: string };
  /** Recurring components (fixed amount, or a formula component with amount ignored). */
  recurring: { code: string; amount: string }[];
  /** One-off inputs for this run (bonus, arrears, ad-hoc deductions…). */
  oneOff: { code: string; amount: string; note?: string }[];
  attendance: {
    otNormalMinutes: number;
    otHolidayMinutes: number;
    /** Unpaid days (no-pay leave + unauthorised absence), already decided by the caller. */
    nopayDays: number;
  };
  /** Instalments due this period, deducted after statutory deductions. */
  loans: { ref: string; code: string; amount: string }[];
  /** For slab_annual_cumulative only: totals earlier in the tax year. */
  ytd?: { apitBase: string; apitPaid: string; monthOfTaxYear: number };
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: string;
  quantity?: string;
  rate?: string;
  ref?: string;
}

export interface TraceStep {
  step: string;
  code?: string;
  description: string;
  formula?: string;
  inputs?: Record<string, string>;
  output: string;
}

export interface PayslipResult {
  lines: PayslipLine[];
  totals: { gross: string; deductions: string; net: string; employerCost: string };
  bases: { epf: string; etf: string; apit: string };
  warnings: { code: string; message: string }[];
  trace: TraceStep[];
}
