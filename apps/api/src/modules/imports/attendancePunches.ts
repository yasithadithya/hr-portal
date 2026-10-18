import { schema } from '@hr/db';
import type { RowError } from '@hr/shared';
import { parseDeviceTimestamp } from '@hr/shared/attendance';
import { addDays, zonedInstant } from '@hr/shared/time';

import { lockedMonths, processRange } from '../attendance/process';
import { tenantToday } from '../employees/service';

import type { ImportDefinition } from './framework';

const { attendanceDeviceUsers, attendancePunches, employees } = schema;

interface Lookups {
  byDeviceUser: Map<string, string>;
  byEmployeeNo: Map<string, string>;
  locked: Set<string>;
  tz: string;
  now: Date;
}

interface Value {
  employeeId: string;
  at: Date;
  date: string;
  deviceId: string | null;
}

const key = (s: string) => s.trim().toUpperCase();

/**
 * Fingerprint-device exports (PLAN.md Phase 6). Each row is one punch; the employee is found by
 * device user id (see device users) or employee number. Times are tenant-local wall time.
 * Re-importing the same file adds nothing (unique employee + instant + source).
 */
export const attendancePunchImport: ImportDefinition<Lookups, Value> = {
  kind: 'attendance-punches',
  title: 'Attendance punches (fingerprint device export)',
  fields: [
    {
      key: 'deviceUserId',
      label: 'Device user id',
      required: false,
      description: 'The id enrolled on the device (or give the employee number)',
      aliases: ['ac_no', 'ac-no', 'user_id', 'enroll_no', 'enrollment_no', 'badge', 'pin', 'id'],
    },
    {
      key: 'employeeNo',
      label: 'Employee no',
      required: false,
      aliases: ['emp_no', 'employee_number'],
    },
    {
      key: 'timestamp',
      label: 'Date & time',
      required: false,
      example: '2026-10-19 08:15:00',
      description: 'Date and time in one column (or use the separate Date and Time columns)',
      aliases: ['datetime', 'date_time', 'time_stamp', 'check_time', 'punch_time'],
    },
    {
      key: 'date',
      label: 'Date',
      required: false,
      example: '19/10/2026',
      description: 'YYYY-MM-DD or DD/MM/YYYY',
      aliases: ['punch_date', 'att_date'],
    },
    { key: 'time', label: 'Time', required: false, example: '08:15', aliases: ['punch_time_only'] },
    { key: 'deviceId', label: 'Device', required: false, aliases: ['device', 'machine', 'sn'] },
  ],

  async prepare(ctx, rows) {
    const map = await ctx.db
      .select({ d: attendanceDeviceUsers.deviceUserId, e: attendanceDeviceUsers.employeeId })
      .from(attendanceDeviceUsers);
    const emps = await ctx.db
      .select({ no: employees.employeeNo, id: employees.id })
      .from(employees);
    // Lock check over the file's date span (unparseable dates are reported in validate).
    const dates = rows
      .map((r) => parseDeviceTimestamp(r.values))
      .flatMap((p) => ('date' in p ? [p.date] : []))
      .sort();
    const locked = dates.length
      ? await lockedMonths(ctx.db, dates[0]!, dates[dates.length - 1]!)
      : new Set<string>();
    return {
      byDeviceUser: new Map(map.map((m) => [key(m.d), m.e])),
      byEmployeeNo: new Map(emps.map((e) => [key(e.no), e.id])),
      locked,
      tz: ctx.tenant.timezone,
      now: new Date(),
    };
  },

  validate(row, l, state) {
    const v = row.values;
    const errors: RowError[] = [];
    const dev = v.deviceUserId?.trim();
    const no = v.employeeNo?.trim();
    let employeeId: string | undefined;
    if (dev) {
      employeeId = l.byDeviceUser.get(key(dev));
      if (!employeeId)
        errors.push({
          line: row.line,
          field: 'deviceUserId',
          message: `Device user "${dev}" is not mapped to an employee`,
        });
    } else if (no) {
      employeeId = l.byEmployeeNo.get(key(no));
      if (!employeeId)
        errors.push({ line: row.line, field: 'employeeNo', message: `Unknown employee "${no}"` });
    } else {
      errors.push({
        line: row.line,
        field: 'deviceUserId',
        message: 'Give a device user id or an employee number',
      });
    }
    const ts = parseDeviceTimestamp(v);
    let at: Date | undefined;
    let date: string | undefined;
    if ('error' in ts) {
      errors.push({ line: row.line, field: v.timestamp ? 'timestamp' : 'date', message: ts.error });
    } else {
      date = ts.date;
      at = zonedInstant(ts.date, ts.time, l.tz);
      if (at > l.now)
        errors.push({ line: row.line, field: 'date', message: 'That time is in the future' });
      if (l.locked.has(date.slice(0, 7)))
        errors.push({ line: row.line, field: 'date', message: `${date.slice(0, 7)} is locked` });
    }
    if (employeeId && at) {
      const k = `${employeeId}:${at.toISOString()}`;
      const first = state.get(k);
      if (first !== undefined)
        errors.push({ line: row.line, field: null, message: `Duplicate of line ${first}` });
      else state.set(k, row.line);
    }
    if (errors.length) return { errors };
    return {
      value: {
        employeeId: employeeId!,
        at: at!,
        date: date!,
        deviceId: v.deviceId?.trim() || null,
      },
      errors,
    };
  },

  async commit(ctx, tx, rows) {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const out = await tx
        .insert(attendancePunches)
        .values(
          rows.slice(i, i + 1000).map(({ value }) => ({
            employeeId: value.employeeId,
            at: value.at,
            source: 'device' as const,
            deviceId: value.deviceId,
            createdBy: ctx.user.id,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: attendancePunches.id });
      inserted += out.length;
    }
    // Recompute the affected employee-days in the same transaction.
    const dates = rows.map((r) => r.value.date).sort();
    await processRange(tx, {
      tz: ctx.tenant.timezone,
      from: addDays(dates[0]!, -1),
      to: dates[dates.length - 1]!,
      today: tenantToday(ctx),
      employeeIds: [...new Set(rows.map((r) => r.value.employeeId))],
    });
    return inserted;
  },
};
