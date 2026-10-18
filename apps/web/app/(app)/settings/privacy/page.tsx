'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useSaveSetting, useSettings } from '@/lib/queries/org';

const retentionSchema = z.object({
  years: z.number().int().nullable(),
  due: z.array(z.object({ id: z.uuid(), employeeNo: z.string(), exitDate: z.string().nullable() })),
});

export default function PrivacySettingsPage() {
  const settings = useSettings();
  const save = useSaveSetting();
  const qc = useQueryClient();
  const s = settings.data;
  const [notice, setNotice] = useState<string | null>(null);
  const [years, setYears] = useState<string | null>(null);
  const retention = useQuery({
    queryKey: ['privacy', 'retention'],
    queryFn: ({ signal }) => api.get('/api/v1/privacy/retention', retentionSchema, { signal }),
  });
  const run = useMutation({
    mutationFn: () =>
      api.post(
        '/api/v1/privacy/retention/run',
        z.object({ anonymized: z.number(), filesRemoved: z.number() }),
      ),
    onSuccess: async (r) => {
      toast.success(`Removed personal data of ${r.anonymized} former employee(s)`);
      await qc.invalidateQueries({ queryKey: ['privacy'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!s) return <Skeleton className="h-96" />;
  const currentNotice = notice ?? s['privacy.notice'] ?? '';
  return (
    <RequirePermission permission="settings.manage" scope="all">
      <PageHeader
        title="Privacy"
        description="Sri Lanka Personal Data Protection Act (PDPA) tools"
      />
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Privacy notice</CardTitle>
            <CardDescription>
              Shown to every user, who must acknowledge it. Use text approved by your legal adviser.
              Current version: {s['privacy.notice_version']}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              aria-label="Privacy notice text"
              className="min-h-48"
              placeholder="Explain what personal data you hold, why, who sees it, how long you keep it and how employees can ask for a copy or correction."
              value={currentNotice}
              onChange={(e) => setNotice(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={notice === null || save.isPending}
                onClick={async () => {
                  await save.mutateAsync({ key: 'privacy.notice', value: notice || null });
                  // A changed notice must be acknowledged again by everyone.
                  if (s['privacy.notice'])
                    await save.mutateAsync({
                      key: 'privacy.notice_version',
                      value: s['privacy.notice_version'] + 1,
                    });
                  setNotice(null);
                  await qc.invalidateQueries({ queryKey: ['privacy'] });
                }}
              >
                {s['privacy.notice'] ? 'Publish new version' : 'Publish notice'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retention of former employees’ data</CardTitle>
            <CardDescription>
              After this many years from their exit date, a former employee’s personal details,
              contacts, documents and photo are removed. Payroll, EPF/ETF, tax and leave/attendance
              records are kept under the employee number. Runs nightly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                Confirm the legal retention periods (tax, EPF/ETF, labour records) with your
                accountant or lawyer before turning this on. Removal can’t be undone.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                aria-label="Retention years"
                type="number"
                min={1}
                max={50}
                className="w-32"
                placeholder="Never"
                value={
                  years ??
                  (s['privacy.retention_years_after_exit'] === null
                    ? ''
                    : String(s['privacy.retention_years_after_exit']))
                }
                onChange={(e) => setYears(e.target.value)}
              />
              <span className="text-muted-foreground text-sm">years after exit</span>
              <Button
                variant="outline"
                disabled={years === null || save.isPending}
                onClick={() =>
                  save.mutate(
                    {
                      key: 'privacy.retention_years_after_exit',
                      value: years ? Number(years) : null,
                    },
                    {
                      onSuccess: async () => {
                        setYears(null);
                        await qc.invalidateQueries({ queryKey: ['privacy', 'retention'] });
                      },
                    },
                  )
                }
              >
                Save
              </Button>
            </div>
            {retention.data?.years && (
              <div className="space-y-2">
                <p className="text-sm">
                  Due now: <strong>{retention.data.due.length}</strong> former employee(s)
                  {retention.data.due.length > 0 &&
                    ` — ${retention.data.due
                      .slice(0, 10)
                      .map((d) => d.employeeNo)
                      .join(', ')}`}
                </p>
                {retention.data.due.length > 0 && (
                  <Button
                    variant="destructive"
                    disabled={run.isPending}
                    onClick={() => run.mutate()}
                  >
                    Remove their personal data now
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data requests</CardTitle>
            <CardDescription>
              Employees download their own data from My HR → Profile. HR can download any employee’s
              package from their employee page. Every download, and every view of NIC, bank, salary
              or payslip details by someone else, is recorded in the audit log.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </RequirePermission>
  );
}
