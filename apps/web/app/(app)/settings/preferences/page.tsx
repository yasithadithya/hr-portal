'use client';

import { useState } from 'react';

import { formatSequence, type NumberSequence } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSaveSequence, useSaveSetting, useSequences, useSettings } from '@/lib/queries/org';

function SequenceRow({ seq }: { seq: NumberSequence }) {
  const save = useSaveSequence();
  const [prefix, setPrefix] = useState(seq.prefix);
  const [padding, setPadding] = useState(seq.padding);
  const [nextValue, setNextValue] = useState(seq.nextValue);
  return (
    <div className="grid items-end gap-3 sm:grid-cols-4">
      <div className="space-y-2">
        <Label htmlFor={`${seq.key}-prefix`}>Prefix</Label>
        <Input
          id={`${seq.key}-prefix`}
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${seq.key}-padding`}>Digits</Label>
        <Input
          id={`${seq.key}-padding`}
          type="number"
          min={0}
          max={12}
          value={padding}
          onChange={(e) => setPadding(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${seq.key}-next`}>Next number</Label>
        <Input
          id={`${seq.key}-next`}
          type="number"
          min={1}
          value={nextValue}
          onChange={(e) => setNextValue(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          Next:{' '}
          <span className="text-foreground font-mono" data-testid={`${seq.key}-preview`}>
            {formatSequence({ prefix, padding }, nextValue || 1)}
          </span>
        </p>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ key: seq.key, prefix, padding, nextValue })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  const settings = useSettings();
  const seqs = useSequences();
  const save = useSaveSetting();
  const [color, setColor] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const s = settings.data;

  return (
    <RequirePermission permission="settings.manage" scope="all">
      <PageHeader title="Preferences" description="Security, branding and numbering" />
      {settings.error && <ErrorAlert error={settings.error} />}
      {!s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block font-medium">Require two-factor authentication</span>
                  <span className="text-muted-foreground text-sm">
                    Everyone must set up an authenticator app at their next sign-in.
                  </span>
                </span>
                <Switch
                  aria-label="Require two-factor authentication"
                  checked={s['security.mfa_required']}
                  onCheckedChange={(v) => save.mutate({ key: 'security.mfa_required', value: v })}
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Branding</CardTitle>
              <CardDescription>The logo is set on the Company page.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="brand-color">Brand colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="brand-color"
                    type="color"
                    className="h-9 w-12 rounded border"
                    value={color ?? s['branding.primary_color'] ?? '#171717'}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <code className="text-sm">
                    {color ?? s['branding.primary_color'] ?? 'default'}
                  </code>
                </div>
              </div>
              <Button
                size="sm"
                disabled={!color}
                onClick={() =>
                  save.mutate(
                    { key: 'branding.primary_color', value: color },
                    { onSuccess: () => setColor(null) },
                  )
                }
              >
                Save colour
              </Button>
              {s['branding.primary_color'] && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => save.mutate({ key: 'branding.primary_color', value: null })}
                >
                  Reset
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="expiry-days">Warn before a document expires (days)</Label>
                <Input
                  id="expiry-days"
                  type="number"
                  min={1}
                  max={365}
                  className="w-32"
                  value={days ?? s['documents.expiry_warning_days']}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </div>
              <Button
                size="sm"
                disabled={days === null}
                onClick={() =>
                  save.mutate(
                    { key: 'documents.expiry_warning_days', value: days },
                    { onSuccess: () => setDays(null) },
                  )
                }
              >
                Save
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance</CardTitle>
              <CardDescription>
                Geofence and office-network checks are set per branch (Organisation → Branches).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block font-medium">Overtime needs approval</span>
                  <span className="text-muted-foreground text-sm">
                    Payroll pays only the OT a manager has approved on the daily board.
                  </span>
                </span>
                <Switch
                  aria-label="Overtime needs approval"
                  checked={s['attendance.ot_requires_approval']}
                  onCheckedChange={(v) =>
                    save.mutate({ key: 'attendance.ot_requires_approval', value: v })
                  }
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <span>
                  <span className="block font-medium">Branches with both checks</span>
                  <span className="text-muted-foreground text-sm">
                    When a branch has a geofence and an IP allowlist, a clock-in must pass…
                  </span>
                </span>
                <select
                  aria-label="Branch check rule"
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  value={s['attendance.branch_check']}
                  onChange={(e) =>
                    save.mutate({ key: 'attendance.branch_check', value: e.target.value })
                  }
                >
                  <option value="either">either check</option>
                  <option value="both">both checks</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Numbering</CardTitle>
              <CardDescription>
                Employee numbers are assigned automatically when someone is hired.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {seqs.error && <ErrorAlert error={seqs.error} />}
              {seqs.data?.map((q) => (
                <div key={q.key}>
                  <p className="mb-2 text-sm font-medium capitalize">{q.key}</p>
                  <SequenceRow key={`${q.prefix}${q.padding}${q.nextValue}`} seq={q} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </RequirePermission>
  );
}
