import { and, eq, inArray } from 'drizzle-orm';

import { schema } from '@hr/db';
import type { RowError } from '@hr/shared';

import type { ImportDefinition } from './framework';

const { employees, leaveLedger, leaveTypes } = schema;

interface Lookups {
  employee: Map<string, string>;
  type: Map<string, { id: string; unit: string }>;
  existing: Set<string>;
}

interface Value {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  amount: number;
  note: string | null;
}

const key = (s: string) => s.trim().toUpperCase();
const openingKey = (e: string, t: string, y: number) => `open:${e}:${t}:${y}`;

/** Opening balances when moving onto the system (PLAN.md Phase 5). One per employee/type/year. */
export const leaveBalanceImport: ImportDefinition<Lookups, Value> = {
  kind: 'leave-balances',
  title: 'Leave opening balances',
  fields: [
    {
      key: 'employeeNo',
      label: 'Employee no',
      required: true,
      aliases: ['emp_no', 'employee_number'],
    },
    {
      key: 'leaveTypeCode',
      label: 'Leave type code',
      required: true,
      example: 'ANNUAL',
      aliases: ['leave_type', 'type'],
    },
    { key: 'year', label: 'Year', required: true, example: '2026', aliases: ['leave_year'] },
    {
      key: 'amount',
      label: 'Opening balance',
      required: true,
      example: '7.5',
      description: 'Days (hours for short leave)',
      aliases: ['balance', 'days', 'opening'],
    },
    { key: 'note', label: 'Note', required: false, aliases: ['remarks'] },
  ],

  async prepare(ctx) {
    const emps = await ctx.db
      .select({ no: employees.employeeNo, id: employees.id })
      .from(employees);
    const types = await ctx.db
      .select({ code: leaveTypes.code, id: leaveTypes.id, unit: leaveTypes.unit })
      .from(leaveTypes);
    const existing = await ctx.db
      .select({ k: leaveLedger.idempotencyKey })
      .from(leaveLedger)
      .where(and(eq(leaveLedger.entryType, 'opening'), inArray(leaveLedger.refType, ['import'])));
    return {
      employee: new Map(emps.map((e) => [key(e.no), e.id])),
      type: new Map(types.map((t) => [key(t.code), { id: t.id, unit: t.unit }])),
      existing: new Set(existing.flatMap((e) => (e.k ? [e.k] : []))),
    };
  },

  validate(row, l, state) {
    const v = row.values;
    const errors: RowError[] = [];
    const employeeId = l.employee.get(key(v.employeeNo ?? ''));
    if (!employeeId)
      errors.push({
        line: row.line,
        field: 'employeeNo',
        message: `Unknown employee "${v.employeeNo}"`,
      });
    const type = l.type.get(key(v.leaveTypeCode ?? ''));
    if (!type)
      errors.push({
        line: row.line,
        field: 'leaveTypeCode',
        message: `Unknown leave type "${v.leaveTypeCode}"`,
      });
    const year = Number(v.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      errors.push({ line: row.line, field: 'year', message: 'Year must be like 2026' });
    const amount = Number(v.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000) {
      errors.push({
        line: row.line,
        field: 'amount',
        message: 'Opening balance must be a number, 0 or more',
      });
    } else if (type && type.unit !== 'hour' && Math.round(amount * 2) !== amount * 2) {
      errors.push({ line: row.line, field: 'amount', message: 'Use whole or half days' });
    }
    if (employeeId && type && Number.isInteger(year)) {
      const k = openingKey(employeeId, type.id, year);
      if (l.existing.has(k))
        errors.push({
          line: row.line,
          field: null,
          message: 'An opening balance was already imported for this employee, type and year',
        });
      const first = state.get(k);
      if (first !== undefined)
        errors.push({ line: row.line, field: null, message: `Duplicate of line ${first}` });
      else state.set(k, row.line);
    }
    if (errors.length) return { errors };
    return {
      value: {
        employeeId: employeeId!,
        leaveTypeId: type!.id,
        year,
        amount,
        note: v.note?.trim() || null,
      },
      errors,
    };
  },

  async commit(ctx, tx, rows) {
    await tx.insert(leaveLedger).values(
      rows.map(({ value }) => ({
        employeeId: value.employeeId,
        leaveTypeId: value.leaveTypeId,
        periodYear: value.year,
        entryType: 'opening' as const,
        amount: String(value.amount),
        idempotencyKey: openingKey(value.employeeId, value.leaveTypeId, value.year),
        refType: 'import',
        note: value.note ?? 'Opening balance (import)',
        effectiveDate: `${value.year}-01-01`,
        createdBy: ctx.user.id,
      })),
    );
    return rows.length;
  },
};
