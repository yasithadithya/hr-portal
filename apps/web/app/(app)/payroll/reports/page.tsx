'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { RequirePermission } from '@/components/auth/require-permission';
import { errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { PayrollTabs } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { downloadT10 } from '@/lib/queries/payroll';

export default function PayrollReportsPage() {
  const now = new Date();
  // Default: the tax year that most recently ended (April–March unless configured otherwise).
  const [year, setYear] = useState(
    now.getUTCMonth() >= 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2,
  );
  return (
    <RequirePermission permission="payroll.read" scope="all">
      <PageHeader title="Payroll" />
      <PayrollTabs />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">T-10 annual data</CardTitle>
            <CardDescription>
              Per-employee remuneration and APIT for a tax year, from locked payrolls. Sample
              layout: confirm the format with the client’s accountant.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="t10-year" className="text-sm">
                Tax year starting
              </label>
              <Input
                id="t10-year"
                type="number"
                className="w-28"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => downloadT10(year).catch((e) => toast.error(errorMessage(e)))}
            >
              <Download /> {year}/{String(year + 1).slice(2)}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly files</CardTitle>
            <CardDescription>
              Payroll register, EPF / ETF / APIT schedules, bank file and GL journal are on each
              payroll run (after approval).
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </RequirePermission>
  );
}
