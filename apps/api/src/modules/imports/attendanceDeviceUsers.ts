import { schema } from '@hr/db';
import type { RowError } from '@hr/shared';

import type { ImportDefinition } from './framework';

const { attendanceDeviceUsers, employees } = schema;

interface Lookups {
  byEmployeeNo: Map<string, string>;
}
interface Value {
  deviceUserId: string;
  employeeId: string;
}

const key = (s: string) => s.trim().toUpperCase();

/** Device user id → employee mapping in bulk. An existing mapping for the same id is replaced. */
export const deviceUserImport: ImportDefinition<Lookups, Value> = {
  kind: 'attendance-device-users',
  title: 'Fingerprint device users',
  fields: [
    {
      key: 'deviceUserId',
      label: 'Device user id',
      required: true,
      aliases: ['ac_no', 'ac-no', 'user_id', 'enroll_no', 'enrollment_no', 'badge', 'pin'],
    },
    {
      key: 'employeeNo',
      label: 'Employee no',
      required: true,
      aliases: ['emp_no', 'employee_number'],
    },
  ],
  async prepare(ctx) {
    const emps = await ctx.db
      .select({ no: employees.employeeNo, id: employees.id })
      .from(employees);
    return { byEmployeeNo: new Map(emps.map((e) => [key(e.no), e.id])) };
  },
  validate(row, l, state) {
    const errors: RowError[] = [];
    const dev = (row.values.deviceUserId ?? '').trim();
    const employeeId = l.byEmployeeNo.get(key(row.values.employeeNo ?? ''));
    if (dev.length > 40)
      errors.push({ line: row.line, field: 'deviceUserId', message: 'At most 40 characters' });
    if (!employeeId)
      errors.push({
        line: row.line,
        field: 'employeeNo',
        message: `Unknown employee "${row.values.employeeNo}"`,
      });
    const first = state.get(key(dev));
    if (first !== undefined)
      errors.push({ line: row.line, field: 'deviceUserId', message: `Duplicate of line ${first}` });
    else state.set(key(dev), row.line);
    if (errors.length) return { errors };
    return { value: { deviceUserId: dev, employeeId: employeeId! }, errors };
  },
  async commit(ctx, tx, rows) {
    for (const { value } of rows) {
      await tx
        .insert(attendanceDeviceUsers)
        .values({ ...value, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: attendanceDeviceUsers.deviceUserId,
          set: { employeeId: value.employeeId, updatedBy: ctx.user.id, updatedAt: new Date() },
        });
    }
    return rows.length;
  },
};
