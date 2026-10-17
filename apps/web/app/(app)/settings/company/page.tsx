'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useCompany, useSaveCompany, useUploadLogo } from '@/lib/queries/org';
import { companyProfileSchema, type CompanyProfile } from '@hr/shared';

type Form = z.input<typeof companyProfileSchema>;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

function CompanyForm({ profile, readOnly }: { profile: CompanyProfile; readOnly: boolean }) {
  const save = useSaveCompany();
  const upload = useUploadLogo();
  const fileRef = useRef<HTMLInputElement>(null);
  const { logoUrl: _logo, ...defaults } = profile;
  const form = useForm<Form>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: { ...defaults, email: defaults.email ?? '' },
  });
  const { errors } = form.formState;
  const text = (name: keyof Form & string, label: string) => (
    <Field id={name} label={label} error={errors[name]?.message as string | undefined}>
      <Input id={name} disabled={readOnly} {...form.register(name)} />
    </Field>
  );

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
          <CardDescription>
            Shown on sign-in, the sidebar and payslips. PNG, JPEG, WebP or SVG, up to 1 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="bg-muted flex size-16 items-center justify-center overflow-hidden rounded-md border">
            {profile.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img
                src={profile.logoUrl}
                alt="Company logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-muted-foreground text-xs">No logo</span>
            )}
          </div>
          {!readOnly && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                aria-label="Logo file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Upload /> {upload.isPending ? 'Uploading…' : 'Upload logo'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {text('name', 'Display name')}
          {text('legalName', 'Legal name')}
          {text('regNo', 'Business registration no.')}
          {text('tin', 'Taxpayer identification no. (TIN)')}
          {text('epfRegNo', 'EPF employer registration no.')}
          {text('etfRegNo', 'ETF employer registration no.')}
          {text('phone', 'Phone')}
          {text('email', 'Email')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {(['line1', 'line2', 'city', 'district', 'postalCode', 'country'] as const).map((k) => (
            <Field
              key={k}
              id={`address.${k}`}
              label={
                {
                  line1: 'Address line 1',
                  line2: 'Address line 2',
                  city: 'City',
                  district: 'District',
                  postalCode: 'Postal code',
                  country: 'Country',
                }[k]
              }
            >
              <Input id={`address.${k}`} disabled={readOnly} {...form.register(`address.${k}`)} />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regional</CardTitle>
          <CardDescription>
            The timezone decides what &quot;today&quot; is for attendance, leave and payroll.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {text('timezone', 'Timezone')}
          {text('currency', 'Currency')}
          <Field id="fiscalYearStartMonth" label="Financial year starts">
            <select
              id="fiscalYearStartMonth"
              disabled={readOnly}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              {...form.register('fiscalYearStartMonth', { valueAsNumber: true })}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      {!readOnly && (
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      )}
    </form>
  );
}

export default function CompanyPage() {
  const company = useCompany();
  const { can } = useAuth();
  return (
    <RequirePermission permission={['settings.manage', 'users.manage', 'audit.read']}>
      <PageHeader
        title="Company"
        description="Legal and statutory details used on payslips and returns"
      />
      {company.error && <ErrorAlert error={company.error} />}
      {company.data ? (
        <CompanyForm profile={company.data} readOnly={!can('settings.manage', 'all')} />
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
    </RequirePermission>
  );
}
