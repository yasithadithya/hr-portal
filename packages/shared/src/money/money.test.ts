import { describe, expect, it } from 'vitest';

import { money, round, sum, toDbString } from './index';

describe('money', () => {
  it('avoids float errors', () => {
    expect(money('0.1').plus('0.2').toString()).toBe('0.3');
    expect(sum(['10.10', '20.20', '30.30']).toFixed(2)).toBe('60.60');
  });

  it.each([
    ['half_up', '2.345', '2.35'],
    ['half_up', '2.355', '2.36'],
    ['half_even', '2.345', '2.34'],
    ['half_even', '2.355', '2.36'],
    ['half_down', '2.345', '2.34'],
    ['down', '2.349', '2.34'],
    ['up', '2.341', '2.35'],
    ['half_up', '-2.345', '-2.35'],
  ] as const)('rounds %s %s -> %s', (mode, input, expected) => {
    expect(round(input, mode, 2).toFixed(2)).toBe(expected);
  });

  it('rounds to whole rupees when scale is 0', () => {
    expect(round('1499.5', 'half_up', 0).toString()).toBe('1500');
  });

  it('refuses to store unrounded values', () => {
    expect(toDbString('1234.5')).toBe('1234.50');
    expect(() => toDbString('1234.567')).toThrow(RangeError);
  });
});
