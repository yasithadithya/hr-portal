'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField } from '@/components/employees/fields';
import {
  PayrollTabs,
  runLabel,
  RunStatusBadge,
  SampleDataBanner,
} from '@/components/payroll/payroll-ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useAuth } from '@/lib/auth';
import { lkr, useOpenPeriod, useRuns } from '@/lib/queries/payroll';

function lastDayOf(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function OpenMonthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const openPeriod = useOpenPeriod();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [payDate, setPayDate] = useState(() => lastDayOf(new Date().toISOString().slice(0, 7)));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Open a payroll month</DialogTitle>
          <DialogDescription>Creates the month’s regular payroll run.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            openPeriod.mutate(
              { month, payDate },
              { onSuccess: (r) => router.push(`/payroll/runs/${r.id}`) },
            );
          }}
        >
          <FormField id="pp-month" label="Month">
            <Input
              id="pp-month"
              type="month"
              required
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                if (e.target.value) setPayDate(lastDayOf(e.target.value));
              }}
            />
          </FormField>
          <FormField id="pp-paydate" label="Pay date">
            <Input
              id="pp-paydate"
              type="date"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="submit" disabled={openPeriod.isPending}>
              Open month
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollPage() {
  const runs = useRuns();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const needsReview = runs.data?.some((r) => r.configNeedsReview) ?? false;

  return (
    <RequirePermission permission="payroll.read" scope="all">
      <PageHeader
        title="Payroll"
        actions={
          can('payroll.run', 'all') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Open month
            </Button>
          )
        }
      />
      <PayrollTabs />
      {(needsReview || runs.data?.length === 0) && <SampleDataBanner className="mb-4" />}
      {runs.error && <ErrorAlert error={runs.error} />}
      {!runs.data ? (
        <Skeleton className="h-48" />
      ) : runs.data.length === 0 ? (
        <p className="text-muted-foreground">
          No payroll yet. Set up employee pay first, then open a month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Employer cost</TableHead>
                <TableHead>Pay date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.map((r) => (
                <TableRow key={r.id} data-testid={`run-${r.month}-${r.type}`}>
                  <TableCell className="font-medium">
                    <Link className="hover:underline" href={`/payroll/runs/${r.id}`}>
                      {runLabel(r)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">{r.totals?.employees ?? '—'}</TableCell>
                  <TableCell className="text-right">{lkr(r.totals?.gross)}</TableCell>
                  <TableCell className="text-right">{lkr(r.totals?.net)}</TableCell>
                  <TableCell className="text-right">{lkr(r.totals?.employerCost)}</TableCell>
                  <TableCell>{r.payDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <OpenMonthDialog open={open} onClose={() => setOpen(false)} />
    </RequirePermission>
  );
}
