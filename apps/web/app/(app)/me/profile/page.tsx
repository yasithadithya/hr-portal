'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { PROFILE_FIELDS, type ProfileSection } from '@hr/shared';

import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEmployee } from '@/lib/queries/employees';
import {
  useDecideProfileChange,
  useMyProfileChanges,
  useRequestProfileChange,
} from '@/lib/queries/notifications';

const LABELS: Record<string, string> = {
  preferredName: 'Preferred name',
  maritalStatus: 'Marital status',
  religion: 'Religion',
  nationality: 'Nationality',
  personalEmail: 'Personal email',
  mobile: 'Mobile',
  address: 'Address',
  bankName: 'Bank',
  bankBranch: 'Branch',
  bankAccountNo: 'Account number',
  bankAccountName: 'Account name',
};
const SECTION_TITLE: Record<ProfileSection, string> = {
  personal: 'Personal details',
  contact: 'Contact details',
  bank: 'Bank account (salary)',
};

type Address = { line1?: string; line2?: string; city?: string; postalCode?: string };
const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') {
    const a = v as Address;
    return [a.line1, a.line2, a.city, a.postalCode].filter(Boolean).join(', ') || '—';
  }
  return String(v);
};

function SectionCard({
  section,
  employee,
}: {
  section: ProfileSection;
  employee: Record<string, unknown>;
}) {
  const request = useRequestProfileChange();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const fields = PROFILE_FIELDS[section] as readonly string[];
  const value = (k: string) => (k in values ? values[k] : employee[k]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{SECTION_TITLE[section]}</CardTitle>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Request a change
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {fields.map((k) => (
              <div key={k}>
                <dt className="text-muted-foreground">{LABELS[k]}</dt>
                <dd>{show(employee[k])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate({ section, values, note: note || null } as never, {
                onSuccess: () => {
                  setEditing(false);
                  setValues({});
                  setNote('');
                },
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((k) =>
                k === 'address' ? (
                  <div key={k} className="space-y-2 sm:col-span-2">
                    <FormField id="pf-line1" label="Address line 1">
                      <Input
                        id="pf-line1"
                        value={(value('address') as Address | null)?.line1 ?? ''}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            address: {
                              ...((value('address') as Address) ?? {}),
                              line1: e.target.value,
                            },
                          })
                        }
                      />
                    </FormField>
                    <FormField id="pf-city" label="City">
                      <Input
                        id="pf-city"
                        value={(value('address') as Address | null)?.city ?? ''}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            address: {
                              ...((value('address') as Address) ?? {}),
                              city: e.target.value,
                            },
                          })
                        }
                      />
                    </FormField>
                  </div>
                ) : k === 'maritalStatus' ? (
                  <FormField key={k} id={`pf-${k}`} label={LABELS[k]!}>
                    <select
                      id={`pf-${k}`}
                      className={selectClass}
                      value={(value(k) as string | null) ?? ''}
                      onChange={(e) => setValues({ ...values, [k]: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {['single', 'married', 'divorced', 'widowed', 'other'].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ) : (
                  <FormField key={k} id={`pf-${k}`} label={LABELS[k]!}>
                    <Input
                      id={`pf-${k}`}
                      value={(value(k) as string | null) ?? ''}
                      onChange={(e) => setValues({ ...values, [k]: e.target.value || null })}
                    />
                  </FormField>
                ),
              )}
            </div>
            <FormField id={`pf-note-${section}`} label="Note for HR (optional)">
              <Input
                id={`pf-note-${section}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={request.isPending || !Object.keys(values).length}>
                Send to HR
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyProfilePage() {
  const { me } = useAuth();
  const id = me?.employee?.id ?? '';
  const employee = useEmployee(id);
  const changes = useMyProfileChanges();
  const decide = useDecideProfileChange();
  // The detail record nests personal and bank fields; the change form works on flat field names.
  const d = employee.data;
  const e: Record<string, unknown> | undefined = d
    ? { ...d, ...(d.personal ?? {}), ...(d.bank ?? {}) }
    : undefined;

  if (!me?.employee)
    return <p className="text-muted-foreground">Your account is not linked to an employee.</p>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My profile"
        description="HR reviews changes before they apply."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              apiDownload('/api/v1/me/data-export', 'my-personal-data.json').catch((err) =>
                toast.error(errorMessage(err)),
              )
            }
          >
            Download my data
          </Button>
        }
      />
      {employee.error && <ErrorAlert error={employee.error} />}
      {!e ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {String(e.firstName)} {String(e.lastName)}
              </CardTitle>
              <CardDescription>
                {String(e.employeeNo)} · joined {String(e.joinDate)}
              </CardDescription>
            </CardHeader>
          </Card>
          {(['personal', 'contact', 'bank'] as const).map((s) => (
            <SectionCard key={s} section={s} employee={e} />
          ))}
          {changes.data && changes.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">My change requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {changes.data.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0"
                    data-testid="profile-change"
                  >
                    <span>
                      {SECTION_TITLE[c.section]}:{' '}
                      {Object.entries(c.changes)
                        .map(([k, v]) => `${LABELS[k] ?? k} → ${show(v.to)}`)
                        .join('; ')}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={c.status === 'pending' ? 'secondary' : 'outline'}>
                        {c.status}
                      </Badge>
                      {c.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decide.mutate({ id: c.id, action: 'withdraw' })}
                        >
                          Withdraw
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
