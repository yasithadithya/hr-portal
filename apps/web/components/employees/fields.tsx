'use client';

import type { ReactNode } from 'react';

import { EMPLOYMENT_TYPES } from '@hr/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEmployeeOptions } from '@/lib/queries/admin';
import { useRefList } from '@/lib/queries/org';

export const selectClass = 'border-input bg-background h-9 w-full rounded-md border px-3 text-sm';

export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

export type JobFieldValues = {
  branchId: string;
  departmentId: string;
  designationId: string;
  gradeId: string;
  costCenterId: string;
  reportsToId: string;
  employmentType: string;
};

/** Department/branch/designation/grade/cost-centre/manager/type pickers (controlled). */
export function JobFields({
  value,
  onChange,
  excludeEmployeeId,
}: {
  value: JobFieldValues;
  onChange: (v: JobFieldValues) => void;
  excludeEmployeeId?: string;
}) {
  const departments = useRefList('departments');
  const branches = useRefList('branches');
  const designations = useRefList('designations');
  const grades = useRefList('grades');
  const costCenters = useRefList('cost-centers');
  const people = useEmployeeOptions();
  const pick = (
    key: keyof JobFieldValues,
    label: string,
    options: { value: string; label: string }[],
    emptyLabel = '—',
  ) => (
    <FormField id={`job-${key}`} label={label}>
      <select
        id={`job-${key}`}
        className={selectClass}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      >
        {key !== 'employmentType' && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pick(
        'departmentId',
        'Department',
        (departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
      )}
      {pick(
        'designationId',
        'Designation',
        (designations.data ?? []).map((d) => ({ value: d.id, label: d.title })),
      )}
      {pick(
        'branchId',
        'Branch',
        (branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
      )}
      {pick(
        'gradeId',
        'Grade',
        (grades.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
      )}
      {pick(
        'costCenterId',
        'Cost centre',
        (costCenters.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
      )}
      {pick(
        'reportsToId',
        'Reports to',
        (people.data ?? [])
          .filter((p) => p.id !== excludeEmployeeId)
          .map((p) => ({ value: p.id, label: `${p.name} (${p.employeeNo})` })),
        'Nobody',
      )}
      {pick(
        'employmentType',
        'Employment type',
        EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') })),
      )}
    </div>
  );
}

export const emptyJob: JobFieldValues = {
  branchId: '',
  departmentId: '',
  designationId: '',
  gradeId: '',
  costCenterId: '',
  reportsToId: '',
  employmentType: 'permanent',
};

export function DateInput(props: React.ComponentProps<typeof Input>) {
  return <Input type="date" {...props} />;
}
