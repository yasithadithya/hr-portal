'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { GENDERS, parseNic, type HireInput } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import {
  emptyJob,
  FormField,
  JobFields,
  selectClass,
  type JobFieldValues,
} from '@/components/employees/fields';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useHire } from '@/lib/queries/employees';

type FieldErrors = Record<string, string>;

function fieldErrors(err: unknown): FieldErrors {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const props =
    (err.details as { properties?: Record<string, { errors: string[] }> } | undefined)
      ?.properties ?? {};
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.errors[0] ?? 'Invalid']));
}

export default function NewEmployeePage() {
  const router = useRouter();
  const hire = useHire();
  const [p, setP] = useState({
    firstName: '',
    lastName: '',
    nameWithInitials: '',
    employeeNo: '',
    nic: '',
    dob: '',
    gender: '',
    mobile: '',
    workEmail: '',
    personalEmail: '',
    joinDate: '',
    probationEndDate: '',
    contractEndDate: '',
  });
  const [job, setJob] = useState<JobFieldValues>(emptyJob);
  const errors = fieldErrors(hire.error);
  const nic = p.nic.trim() ? parseNic(p.nic) : null;
  const text = (key: keyof typeof p, label: string, type = 'text', required = false) => (
    <FormField id={key} label={label} error={errors[key]}>
      <Input
        id={key}
        type={type}
        required={required}
        value={p[key]}
        onChange={(e) => setP({ ...p, [key]: e.target.value })}
      />
    </FormField>
  );

  return (
    <RequirePermission permission="employees.create" scope="all">
      <PageHeader
        title="Add employee"
        description="Creates the employee and opens their job history"
      />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const body = { ...p, ...job } as unknown as HireInput;
          hire.mutate(body, { onSuccess: (d) => router.push(`/employees/${d.id}`) });
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Person</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text('firstName', 'First name', 'text', true)}
            {text('lastName', 'Last name', 'text', true)}
            {text('nameWithInitials', 'Name with initials')}
            <FormField
              id="nic"
              label="NIC"
              error={errors.nic ?? (p.nic.trim() && !nic ? 'Not a valid NIC' : undefined)}
            >
              <Input id="nic" value={p.nic} onChange={(e) => setP({ ...p, nic: e.target.value })} />
              {nic && (!p.dob || !p.gender) && (
                <p className="text-muted-foreground text-xs">
                  NIC suggests born {nic.suggestedDob}, {nic.suggestedGender}.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      setP({
                        ...p,
                        dob: p.dob || (nic.suggestedDob ?? ''),
                        gender: p.gender || (nic.suggestedGender ?? ''),
                      })
                    }
                  >
                    Use this
                  </button>
                </p>
              )}
            </FormField>
            {text('dob', 'Date of birth', 'date')}
            <FormField id="gender" label="Gender" error={errors.gender}>
              <select
                id="gender"
                className={selectClass}
                value={p.gender}
                onChange={(e) => setP({ ...p, gender: e.target.value })}
              >
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </FormField>
            {text('mobile', 'Mobile', 'tel')}
            {text('workEmail', 'Work email', 'email')}
            {text('personalEmail', 'Personal email', 'email')}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {text('employeeNo', 'Employee no (blank = automatic)')}
              {text('joinDate', 'Join date', 'date', true)}
              {text('probationEndDate', 'Probation ends', 'date')}
              {text('contractEndDate', 'Contract ends', 'date')}
            </div>
            <JobFields value={job} onChange={setJob} />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={hire.isPending}>
            {hire.isPending ? 'Saving…' : 'Add employee'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </RequirePermission>
  );
}
