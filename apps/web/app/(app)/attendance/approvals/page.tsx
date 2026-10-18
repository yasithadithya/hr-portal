'use client';

import {
  AttendanceTabs,
  fmtDate,
  fmtTime,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDecideCorrection, useRegInbox } from '@/lib/queries/attendance';

export default function AttendanceApprovalsPage() {
  const tz = useTenantTz();
  const inbox = useRegInbox();
  const decide = useDecideCorrection();
  const items = inbox.data ?? [];

  return (
    <RequirePermission permission="attendance.approve" scope="team">
      <PageHeader title="Attendance" description="Attendance corrections waiting for you" />
      <AttendanceTabs />
      {inbox.error && <ErrorAlert error={inbox.error} />}
      {!inbox.data ? (
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground" data-testid="reg-inbox-empty">
          Nothing waiting for you.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Correct in</TableHead>
                <TableHead>Correct out</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id} data-testid={`reg-${r.employeeNo}`}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                  <TableCell>{fmtTime(r.requestedIn, tz)}</TableCell>
                  <TableCell>{fmtTime(r.requestedOut, tz)}</TableCell>
                  <TableCell className="max-w-64 truncate" title={r.reason}>
                    {r.reason}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, action: 'approve' })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, action: 'reject' })}
                    >
                      Reject
                    </Button>
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
