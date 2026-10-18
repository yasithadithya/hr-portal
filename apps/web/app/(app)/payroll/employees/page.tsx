'use client';

import Link from 'next/link';
import { useState } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { PayrollTabs } from '@/components/payroll/payroll-ui';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { lkr, usePayOverview } from '@/lib/queries/payroll';

export default function PayEmployeesPage() {
  const list = usePayOverview();
  const [q, setQ] = useState('');
  const rows = (list.data ?? []).filter((r) =>
    `${r.employeeNo} ${r.name}`.toLowerCase().includes(q.toLowerCase()),
  );
  const missing = (list.data ?? []).filter((r) => !r.basic).length;
  return (
    <RequirePermission permission="payroll.read" scope="all">
      <PageHeader title="Payroll" />
      <PayrollTabs />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Input
          aria-label="Search"
          placeholder="Search employees…"
          className="w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {missing > 0 && (
          <p className="text-sm text-amber-600">{missing} employee(s) have no salary yet.</p>
        )}
      </div>
      {list.error && <ErrorAlert error={list.error} />}
      {!list.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Basic salary</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead>Bank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId} data-testid={`pay-${r.employeeNo}`}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/payroll/employees/${r.employeeId}`}
                    >
                      {r.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">{r.employeeNo}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.basic ? lkr(r.basic) : <span className="text-amber-600">Not set</span>}
                  </TableCell>
                  <TableCell>
                    {r.hasTaxProfile ? (
                      (r.taxTable ?? 'Not liable')
                    ) : (
                      <Badge variant="outline">No profile</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.hasBank ? '✓' : <Badge variant="outline">Missing</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </RequirePermission>
  );
}
