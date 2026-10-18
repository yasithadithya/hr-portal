/**
 * Pure Sri Lanka payroll engine (CLAUDE.md Hard Rule 11). No DB, no I/O.
 * `calculatePayslip(input, config)` returns lines, totals, bases and a full calculation trace.
 */
export const ENGINE_VERSION = '1.0.0';

export * from './types';
export { calculatePayslip, PayrollConfigError, SYSTEM_CODES } from './engine';
export { evaluateFormula, formulaVariables, FormulaError } from './formula';
