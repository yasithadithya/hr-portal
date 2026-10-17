import { describe, expect, it } from 'vitest';

import { csvCell, parseCsv, parseCsvRecords } from './csv';

describe('csv', () => {
  it('handles quotes, embedded commas/newlines, CRLF and BOM', () => {
    const text =
      '﻿date,name\r\n2026-01-15,"Thai Pongal, Tamil"\r\n2026-02-04,"Line\nbreak ""quoted"""\n';
    expect(parseCsv(text)).toEqual([
      ['date', 'name'],
      ['2026-01-15', 'Thai Pongal, Tamil'],
      ['2026-02-04', 'Line\nbreak "quoted"'],
    ]);
  });

  it('maps records by normalised header with file line numbers, skipping blank lines', () => {
    expect(parseCsvRecords('Date,Holiday Name\n\n2026-05-01 , May Day \n')).toEqual([
      { line: 2, record: { date: '2026-05-01', holiday_name: 'May Day' } },
    ]);
  });

  it('round-trips cells that need quoting', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(parseCsv(`${csvCell('a,b')},${csvCell('x')}`)).toEqual([['a,b', 'x']]);
  });
});
