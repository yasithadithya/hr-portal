'use client';

import { ChevronLeft, ChevronRight, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  AttendanceTabs,
  fmtMinutes,
  monthLabel,
  shiftMonth,
  todayIn,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  useLockPeriod,
  useMonthlySummary,
  useProcess,
  useUnlockPeriod,
} from '@/lib/queries/attendance';
import { useRefList } from '@/lib/queries/org';

const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export default function MonthlyPage() {
  const tz = useTenantTz();
  const today = todayIn(tz);
  const { can } = useAuth();
  const isManager = can('attendance.manage', 'all');
  const [month, setMonth] = useState(() => shiftMonth(today.slice(0, 7), -1));
  const [departmentId, setDepartmentId] = useState('');
  const summary = useMonthlySummary(month, departmentId || undefined);
  const departments = useRefList('departments');
  const process = useProcess();
  const lock = useLockPeriod();
  const unlock = useUnlockPeriod();
  const [lockProblem, setLockProblem] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState('');
  const s = summary.data;
  const ended = lastDay(month) < today;

  function onLock(force: boolean) {
    setLockProblem(null);
    lock.mutate(
      { month, force },
      {
        onError: (e) =>
          setLockProblem(
            e instanceof ApiError && e.status === 409 && !force ? e.message : errorMessage(e),
          ),
      },
    );
  }

  return (
    <RequirePermission permission="attendance.read" scope="team">
      <PageHeader
        title="Attendance"
        actions={
          isManager &&
          s && (
            <>
              <Button
                variant="outline"
                disabled={process.isPending || s.period.status === 'locked'}
                onClick={() => process.mutate({ from: `${month}-01`, to: lastDay(month) })}
              >
                <RefreshCw /> Recalculate
              </Button>
              {s.period.status === 'locked' ? (
                <Button variant="outline" onClick={() => setUnlockOpen(true)}>
                  <LockOpen /> Unlock
                </Button>
              ) : (
                <Button disabled={!ended || lock.isPending} onClick={() => onLock(false)}>
                  <Lock /> Lock month
                </Button>
              )}
            </>
          )
        }
      />
      <AttendanceTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft />
        </Button>
        <h2 className="min-w-40 text-center font-semibold">{monthLabel(month)}</h2>
        <Button
          size="icon"
          variant="outline"
          aria-label="Next month"
          disabled={month >= today.slice(0, 7)}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight />
        </Button>
        {s && (
          <Badge
            variant={s.period.status === 'locked' ? 'default' : 'outline'}
            data-testid="period-status"
          >
            {s.period.status === 'locked' ? 'Locked' : 'Open'}
          </Badge>
        )}
        <select
          aria-label="Department"
          className={`${selectClass} ml-auto w-48`}
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

      {lockProblem && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Not ready to lock</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {lockProblem}. Fix them first, or lock anyway (they stay as they are).
            <Button size="sm" variant="outline" onClick={() => onLock(true)}>
              Lock anyway
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {s && s.pendingRegularizations > 0 && !lockProblem && (
        <p className="mb-4 text-sm text-amber-600">
          {s.pendingRegularizations} correction request(s) for this month are still pending.
        </p>
      )}
      {!ended && isManager && (
        <p className="text-muted-foreground mb-4 text-sm">
          The month can be locked after it ends. Payroll reads locked months.
        </p>
      )}

      {summary.error && <ErrorAlert error={summary.error} />}
      {!s ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Worked</TableHead>
                <TableHead className="text-right">OT</TableHead>
                {s.otRequiresApproval && <TableHead className="text-right">OT approved</TableHead>}
                <TableHead className="text-right">Missing punch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.rows.map((r) => (
                <TableRow key={r.employeeId} data-testid={`summary-${r.employeeNo}`}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {r.employeeNo}
                      {r.department && ` · ${r.department}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.expectedDays}</TableCell>
                  <TableCell className="text-right">{r.presentDays}</TableCell>
                  <TableCell className="text-right">{r.leaveDays}</TableCell>
                  <TableCell className={`text-right ${r.absentDays ? 'text-red-600' : ''}`}>
                    {r.absentDays}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.lateCount ? `${r.lateCount}× (${fmtMinutes(r.lateMinutes)})` : '—'}
                  </TableCell>
                  <TableCell className="text-right">{fmtMinutes(r.workedMinutes)}</TableCell>
                  <TableCell className="text-right">{fmtMinutes(r.otMinutes)}</TableCell>
                  {s.otRequiresApproval && (
                    <TableCell className="text-right">{fmtMinutes(r.payableOtMinutes)}</TableCell>
                  )}
                  <TableCell className={`text-right ${r.incompleteDays ? 'text-orange-600' : ''}`}>
                    {r.incompleteDays || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unlock {monthLabel(month)}?</DialogTitle>
            <DialogDescription>
              Attendance for the month can change again. The reason is kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              unlock.mutate(
                { month, reason },
                {
                  onSuccess: () => {
                    setUnlockOpen(false);
                    setReason('');
                  },
                },
              );
            }}
          >
            <FormField id="unlock-reason" label="Reason">
              <Input
                id="unlock-reason"
                required
                minLength={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={unlock.isPending}>
                Unlock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </RequirePermission>
  );
}
