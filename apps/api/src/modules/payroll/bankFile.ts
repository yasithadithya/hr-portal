import type { BankFileSpec } from '@hr/db/schema';
import { csvCell } from '@hr/shared';
import { money } from '@hr/shared/money';

/**
 * Bank transfer file from a template (PLAN.md Phase 7: layouts are data). Pure: rows in, text out.
 * Fixed-width values that don't fit are an error, never silently truncated (a cut account
 * number pays the wrong person).
 */
export interface PaymentRow {
  employeeNo: string;
  name: string;
  accountName: string;
  accountNo: string;
  bankName: string;
  bankCode: string;
  branchCode: string;
  /** Decimal string, 2 places. */
  amount: string;
  reference: string;
  /** YYYY-MM-DD */
  payDate: string;
  nic: string;
}

export class BankFileError extends Error {}

function formatValue(raw: string, format: string | undefined): string {
  if (!format) return raw;
  if (format === 'upper') return raw.toUpperCase();
  if (format === 'amount_2dp') return money(raw || '0').toFixed(2);
  if (format === 'amount_cents')
    return money(raw || '0')
      .times(100)
      .toFixed(0);
  if (format.startsWith('date:')) {
    const [y, m, d] = raw.split('-') as [string, string, string];
    return format
      .slice(5)
      .replace('YYYY', y)
      .replace('YY', y.slice(2))
      .replace('MM', m)
      .replace('DD', d);
  }
  return raw;
}

export function buildBankFile(
  format: 'csv' | 'fixed_width',
  spec: BankFileSpec,
  rows: PaymentRow[],
): string {
  const eol = spec.lineEnding === 'lf' ? '\n' : '\r\n';
  const cell = (row: PaymentRow, c: BankFileSpec['columns'][number]) =>
    formatValue(
      c.value ?? (c.field ? String(row[c.field as keyof PaymentRow] ?? '') : ''),
      c.format,
    );

  if (format === 'csv') {
    const delim = spec.delimiter ?? ',';
    const lines: string[] = [];
    if (spec.includeHeader !== false)
      lines.push(spec.columns.map((c) => csvCell(c.header ?? c.field ?? '')).join(delim));
    for (const r of rows) lines.push(spec.columns.map((c) => csvCell(cell(r, c))).join(delim));
    return lines.join(eol) + eol;
  }

  return (
    rows
      .map((r) =>
        spec.columns
          .map((c, i) => {
            const width = c.width ?? 0;
            const v = cell(r, c);
            if (v.length > width)
              throw new BankFileError(
                `${r.employeeNo}: "${c.field ?? `column ${i + 1}`}" is ${v.length} characters; the layout allows ${width}`,
              );
            const pad = c.pad ?? ' ';
            return c.align === 'right' ? v.padStart(width, pad) : v.padEnd(width, pad);
          })
          .join(''),
      )
      .join(eol) + eol
  );
}
