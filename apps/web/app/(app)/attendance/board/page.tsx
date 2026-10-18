'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { AttendanceDay } from '@hr/shared';

import {
  AttendanceTabs,
  exceptionRank,
  fmtDate,
  fmtMinutes,
  fmtTime,
  STATUS_LABEL,
  StatusBadge,
  todayIn,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { selectClass } from '@/components/employees/fields';
import { Button } from '@/components/ui/button';
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
import { useApproveOt, useBoard } from '@/lib/queries/attendance';
import { useRefList, useSettings } from '@/lib/queries/org';

const addDays = (d: string, n: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

function OtCell({ d, canApprove }: { d: AttendanceDay; canApprove: boolean }) {
  const approve = useApproveOt();
  const [value, setValue] = useState<string>(String(d.otApprovedMinutes ?? d.otMinutes));
  if (!d.otMinutes) return <>—</>;
  if (!canApprove || d.isLocked)
    return (
      <>
        {fmtMinutes(d.otMinutes)}
        {d.otApprovedMinutes !== null && (
          <span className="text-muted-foreground"> ({fmtMinutes(d.otApprovedMinutes)} ok)</span>
        )}
      </>
    );
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        approve.mutate({ id: d.id, approvedMinutes: Number(value) });
      }}
    >
      <span className="whitespace-nowrap">{fmtMinutes(d.otMinutes)} →</span>
      <Input
        aria-label={`Approved OT minutes for ${d.employeeName}`}
        className="h-8 w-20"
        type="number"
        min={0}
        max={d.otMinutes}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        variant={d.otApprovedMinutes === null ? 'default' : 'outline'}
        disabled={approve.isPending}
      >
        {d.otApprovedMinutes === null ? 'Approve' : 'Update'}
      </Button>
    </form>
  );
}

export default function BoardPage() {
  const tz = useTenantTz();
  const today = todayIn(tz);
  const { can, me } = useAuth();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const board = useBoard(date, departmentId || undefined);
  const departments = useRefList('departments');
  const settings = useSettings();
  const otApproval = !!settings.data?.['attendance.ot_requires_approval'];
  const canApprove = can('attendance.approve', 'team');

  const rows = useMemo(
    () =>
      (board.data ?? [])
        .filter((d) => !status || d.status === status || (status === 'late' && d.lateMinutes > 0))
        .sort(
          (a, b) =>
            exceptionRank(a) - exceptionRank(b) || a.employeeName.localeCompare(b.employeeName),
        ),
    [board.data, status],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { late: 0 };
    for (const d of board.data ?? []) {
      c[d.status] = (c[d.status] ?? 0) + 1;
      if (d.lateMinutes > 0) c.late!++;
    }
    return c;
  }, [board.data]);

  return (
    <RequirePermission permission="attendance.read" scope="team">
      <PageHeader title="Attendance" />
      <AttendanceTabs />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous day"
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft />
        </Button>
        <Input
          aria-label="Date"
          type="date"
          className="w-44"
          max={today}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label="Next day"
          disabled={date >= today}
          onClick={() => setDate(addDays(date, 1))}
        >
          <ChevronRight />
        </Button>
        <select
          aria-label="Department"
          className={`${selectClass} w-48`}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[
          ['', `All ${board.data?.length ?? 0}`],
          ['incomplete', `${STATUS_LABEL.incomplete} ${counts.incomplete ?? 0}`],
          ['absent', `${date === today ? 'Not in yet' : 'Absent'} ${counts.absent ?? 0}`],
          ['late', `Late ${counts.late ?? 0}`],
          ['half_day', `Half day ${counts.half_day ?? 0}`],
          ['present', `Present ${counts.present ?? 0}`],
          ['on_leave', `On leave ${counts.on_leave ?? 0}`],
        ].map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            variant={status === k ? 'default' : 'outline'}
            onClick={() => setStatus(k!)}
          >
            {label}
          </Button>
        ))}
      </div>

      {board.error && <ErrorAlert error={board.error} />}
      {!board.data ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Nobody to show for {fmtDate(date)}.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Late</TableHead>
                <TableHead>Early</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead>OT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id} data-testid={`board-${d.employeeNo}`}>
                  <TableCell>
                    <div className="font-medium">{d.employeeName}</div>
                    <div className="text-muted-foreground text-xs">
                      {d.employeeNo}
                      {d.department && ` · ${d.department}`}
                    </div>
                  </TableCell>
                  <TableCell>{d.shift?.code ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell>{fmtTime(d.firstIn, tz)}</TableCell>
                  <TableCell>{fmtTime(d.lastOut, tz)}</TableCell>
                  <TableCell className={d.lateMinutes ? 'text-amber-600' : ''}>
                    {fmtMinutes(d.lateMinutes)}
                  </TableCell>
                  <TableCell>{fmtMinutes(d.earlyMinutes)}</TableCell>
                  <TableCell>{fmtMinutes(d.workedMinutes)}</TableCell>
                  <TableCell>
                    <OtCell
                      d={d}
                      canApprove={otApproval && canApprove && d.employeeId !== me?.employee?.id}
                    />
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
