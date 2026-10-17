import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { schema } from '@hr/db';
import { hireSchema, normaliseNic, type ImportField, type RowError } from '@hr/shared';

import { hire } from '../employees/service';

import type { ImportDefinition, RawRow } from './framework';

const { employees, departments, branches, designations, grades, costCenters, employeeJobHistory } =
  schema;

type HireValue = z.output<typeof hireSchema> & { reportsToNo: string | null };

interface Lookups {
  department: Map<string, string>;
  branch: Map<string, string>;
  designation: Map<string, string>;
  grade: Map<string, string>;
  costCenter: Map<string, string>;
  existingNo: Map<string, string>;
  existingNic: Set<string>;
  existingEpf: Set<string>;
  fileNos: Set<string>;
}

const f = (
  key: string,
  label: string,
  required = false,
  extra: Partial<ImportField> = {},
): ImportField => ({
  key,
  label,
  required,
  aliases: [],
  ...extra,
});

export const EMPLOYEE_IMPORT_FIELDS: ImportField[] = [
  f('employeeNo', 'Employee no', false, {
    description: 'Blank = next number from the sequence',
    aliases: ['emp_no', 'employee_number', 'epf_number_internal'],
  }),
  f('firstName', 'First name', true, { aliases: ['first', 'given_name'] }),
  f('lastName', 'Last name', true, { aliases: ['last', 'surname'] }),
  f('nameWithInitials', 'Name with initials', false, { aliases: ['initials_name'] }),
  f('nic', 'NIC', false, { example: '199012345678', aliases: ['nic_no', 'national_id'] }),
  f('dob', 'Date of birth', false, {
    example: '1990-05-14',
    aliases: ['date_of_birth', 'birthday'],
  }),
  f('gender', 'Gender', false, { example: 'male | female | other', aliases: ['sex'] }),
  f('maritalStatus', 'Marital status'),
  f('mobile', 'Mobile', false, { aliases: ['phone', 'mobile_no'] }),
  f('workEmail', 'Work email', false, { aliases: ['email', 'office_email'] }),
  f('personalEmail', 'Personal email'),
  f('joinDate', 'Join date', true, {
    example: '2024-01-15',
    aliases: ['date_joined', 'joined', 'doj'],
  }),
  f('employmentType', 'Employment type', false, {
    example: 'permanent | contract | probation | intern | part_time | consultant',
    aliases: ['type'],
  }),
  f('probationEndDate', 'Probation end date'),
  f('contractEndDate', 'Contract end date'),
  f('departmentCode', 'Department code', false, { aliases: ['department', 'dept'] }),
  f('branchCode', 'Branch code', false, { aliases: ['branch', 'location'] }),
  f('designation', 'Designation', false, { aliases: ['job_title', 'title', 'position'] }),
  f('gradeCode', 'Grade code', false, { aliases: ['grade'] }),
  f('costCenterCode', 'Cost centre code', false, { aliases: ['cost_center', 'cost_centre'] }),
  f('reportsToEmployeeNo', 'Reports to (employee no)', false, {
    aliases: ['manager', 'manager_no', 'supervisor'],
  }),
  f('bankName', 'Bank'),
  f('bankBranch', 'Bank branch'),
  f('bankAccountNo', 'Bank account no', false, { aliases: ['account_no', 'account_number'] }),
  f('bankAccountName', 'Account name'),
  f('epfNo', 'EPF no', false, { aliases: ['epf', 'epf_number'] }),
  f('etfNo', 'ETF no'),
  f('taxFileNo', 'Tax file no', false, { aliases: ['tin'] }),
];

const key = (s: string) => s.trim().toUpperCase();

function lookup(
  map: Map<string, string>,
  raw: string | undefined,
  label: string,
  field: string,
  line: number,
  errors: RowError[],
) {
  if (!raw?.trim()) return null;
  const id = map.get(key(raw));
  if (!id) errors.push({ line, field, message: `Unknown ${label} "${raw.trim()}"` });
  return id ?? null;
}

function claim(
  state: Map<string, number>,
  k: string,
  line: number,
  label: string,
  field: string,
  errors: RowError[],
) {
  const first = state.get(k);
  if (first !== undefined)
    errors.push({ line, field, message: `Duplicate ${label} (also on line ${first})` });
  else state.set(k, line);
}

export const employeeImport: ImportDefinition<Lookups, HireValue> = {
  kind: 'employees',
  title: 'Employees',
  fields: EMPLOYEE_IMPORT_FIELDS,

  async prepare(ctx, rows: RawRow[]) {
    const pairs = async (q: Promise<{ k: string; id: string }[]>) =>
      new Map((await q).map((r) => [key(r.k), r.id]));
    const emps = await ctx.db
      .select({
        no: employees.employeeNo,
        id: employees.id,
        nic: employees.nic,
        epf: employees.epfNo,
      })
      .from(employees);
    return {
      department: await pairs(
        ctx.db.select({ k: departments.code, id: departments.id }).from(departments),
      ),
      branch: await pairs(ctx.db.select({ k: branches.code, id: branches.id }).from(branches)),
      designation: await pairs(
        ctx.db.select({ k: designations.title, id: designations.id }).from(designations),
      ),
      grade: await pairs(ctx.db.select({ k: grades.code, id: grades.id }).from(grades)),
      costCenter: await pairs(
        ctx.db.select({ k: costCenters.code, id: costCenters.id }).from(costCenters),
      ),
      existingNo: new Map(emps.map((e) => [key(e.no), e.id])),
      existingNic: new Set(emps.flatMap((e) => (e.nic ? [e.nic] : []))),
      existingEpf: new Set(emps.flatMap((e) => (e.epf ? [key(e.epf)] : []))),
      fileNos: new Set(
        rows
          .map((r) => r.values.employeeNo?.trim())
          .filter(Boolean)
          .map((n) => key(n!)),
      ),
    };
  },

  validate(row, l, state) {
    const v = row.values;
    const errors: RowError[] = [];
    const ids = {
      departmentId: lookup(
        l.department,
        v.departmentCode,
        'department code',
        'departmentCode',
        row.line,
        errors,
      ),
      branchId: lookup(l.branch, v.branchCode, 'branch code', 'branchCode', row.line, errors),
      designationId: lookup(
        l.designation,
        v.designation,
        'designation',
        'designation',
        row.line,
        errors,
      ),
      gradeId: lookup(l.grade, v.gradeCode, 'grade code', 'gradeCode', row.line, errors),
      costCenterId: lookup(
        l.costCenter,
        v.costCenterCode,
        'cost centre code',
        'costCenterCode',
        row.line,
        errors,
      ),
    };

    let reportsToId: string | null = null;
    let reportsToNo: string | null = null;
    const mgr = v.reportsToEmployeeNo?.trim();
    if (mgr) {
      if (l.existingNo.has(key(mgr))) reportsToId = l.existingNo.get(key(mgr))!;
      else if (l.fileNos.has(key(mgr))) reportsToNo = key(mgr);
      else
        errors.push({
          line: row.line,
          field: 'reportsToEmployeeNo',
          message: `No employee "${mgr}" here or in the file`,
        });
      if (v.employeeNo && key(v.employeeNo) === key(mgr)) {
        errors.push({
          line: row.line,
          field: 'reportsToEmployeeNo',
          message: 'An employee cannot report to themselves',
        });
      }
    }

    const parsed = hireSchema.safeParse({
      ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])),
      employeeNo: v.employeeNo?.trim() || null,
      gender: v.gender?.trim().toLowerCase() || null,
      maritalStatus: v.maritalStatus?.trim().toLowerCase() || null,
      employmentType:
        v.employmentType
          ?.trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_') || 'permanent',
      ...ids,
      reportsToId,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          line: row.line,
          field: String(issue.path[0] ?? '') || null,
          message: issue.message,
        });
      }
    }

    // Uniqueness: against the database and earlier rows in this file.
    if (v.employeeNo?.trim()) {
      if (l.existingNo.has(key(v.employeeNo)))
        errors.push({ line: row.line, field: 'employeeNo', message: 'Employee no already exists' });
      claim(state, `no:${key(v.employeeNo)}`, row.line, 'employee no', 'employeeNo', errors);
    }
    if (parsed.success && parsed.data.nic) {
      if (l.existingNic.has(parsed.data.nic))
        errors.push({
          line: row.line,
          field: 'nic',
          message: 'NIC already belongs to an employee',
        });
      claim(state, `nic:${normaliseNic(parsed.data.nic)}`, row.line, 'NIC', 'nic', errors);
    }
    if (v.epfNo?.trim()) {
      if (l.existingEpf.has(key(v.epfNo)))
        errors.push({ line: row.line, field: 'epfNo', message: 'EPF no already exists' });
      claim(state, `epf:${key(v.epfNo)}`, row.line, 'EPF no', 'epfNo', errors);
    }

    if (errors.length || !parsed.success) return { errors };
    return { value: { ...parsed.data, reportsToNo }, errors };
  },

  async commit(ctx, tx, rows) {
    const created = new Map<string, string>();
    for (const { value } of rows) {
      const { reportsToNo: _r, ...input } = value;
      const e = await hire(ctx, input, tx);
      created.set(key(e.employeeNo), e.id);
    }
    // Second pass: managers that were themselves in the file.
    for (const { value } of rows) {
      if (!value.reportsToNo) continue;
      const managerId = created.get(value.reportsToNo);
      const employeeId = value.employeeNo ? created.get(key(value.employeeNo)) : undefined;
      if (!managerId || !employeeId) continue;
      await tx
        .update(employees)
        .set({ reportsToId: managerId })
        .where(eq(employees.id, employeeId));
      await tx
        .update(employeeJobHistory)
        .set({ reportsToId: managerId })
        .where(
          sql`${employeeJobHistory.employeeId} = ${employeeId} and ${employeeJobHistory.reason} = 'hire'`,
        );
    }
    return rows.length;
  },
};
