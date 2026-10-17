import Decimal from 'decimal.js';

/**
 * Money helpers (CLAUDE.md Hard Rule 2). Never do money arithmetic with JS `number`.
 * Rounding mode and scale always come from tenant config. Nothing here assumes them.
 */

export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Money = Decimal;
export type MoneyInput = Decimal.Value;

export const ROUNDING_MODES = ['half_up', 'half_down', 'half_even', 'up', 'down'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

const DECIMAL_ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_down: Decimal.ROUND_HALF_DOWN,
  half_even: Decimal.ROUND_HALF_EVEN,
  up: Decimal.ROUND_UP,
  down: Decimal.ROUND_DOWN,
};

export function money(value: MoneyInput): Money {
  return new Money(value);
}

export function round(value: MoneyInput, mode: RoundingMode, scale: number): Money {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Invalid rounding scale: ${scale}`);
  }
  return money(value).toDecimalPlaces(scale, DECIMAL_ROUNDING[mode]);
}

export function sum(values: readonly MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(v), money(0));
}

/**
 * Serialises for a `numeric(14,2)` column. Throws if the value has more than 2 decimals,
 * so callers must round explicitly with the tenant's rounding mode first.
 */
export function toDbString(value: MoneyInput): string {
  const d = money(value);
  if (d.decimalPlaces() > 2) {
    throw new RangeError(`Value ${d.toString()} has more than 2 decimals; round before storing`);
  }
  return d.toFixed(2);
}
