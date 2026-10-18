'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { runLabel } from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { downloadPayslip, lkr, useMyPayslips, usePayslip } from '@/lib/queries/payroll';

export default function MyPayslipsPage() {
  const list = useMyPayslips();
  const [open, setOpen] = useState<string | null>(null);
  const selected = open ?? list.data?.[0]?.id ?? null;
  const detail = usePayslip(selected);
  const d = detail.data;
  const dl = (id: string, name: string) =>
    downloadPayslip(id, name).catch((e) => toast.error(errorMessage(e)));

  return (
    <RequirePermission permission="payslips.read">
      <PageHeader title="My payslips" />
      {list.error && <ErrorAlert error={list.error} />}
      {!list.data ? (
        <Skeleton className="h-48" />
      ) : list.data.length === 0 ? (
        <p className="text-muted-foreground" data-testid="no-payslips">
          No payslips yet. They appear here once payroll for the month is finalised.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <ul className="space-y-1">
            {list.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpen(p.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${selected === p.id ? 'bg-muted font-medium' : 'hover:bg-muted/60'}`}
                >
                  {runLabel({ month: p.month, type: p.runType })}
                  <span className="text-muted-foreground block text-xs">Net {lkr(p.net)}</span>
                </button>
              </li>
            ))}
          </ul>
          {d && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {runLabel({ month: d.month, type: d.runType })}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => dl(d.id, `payslip-${d.month}.pdf`)}
                >
                  <Download /> PDF
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {d.lines
                      .filter((l) => l.kind === 'earning' || l.kind === 'deduction')
                      .map((l, i) => (
                        <TableRow key={`${l.code}-${i}`}>
                          <TableCell>{l.name}</TableCell>
                          <TableCell
                            className={`text-right ${l.kind === 'deduction' ? 'text-red-600' : ''}`}
                          >
                            {l.kind === 'deduction' ? '−' : ''}
                            {lkr(l.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    <TableRow>
                      <TableCell className="font-semibold">Net pay</TableCell>
                      <TableCell className="text-right font-semibold" data-testid="my-net">
                        {lkr(d.net)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </RequirePermission>
  );
}
