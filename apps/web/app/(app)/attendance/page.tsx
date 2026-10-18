'use client';

import { ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { useState } from 'react';

import type { AttendanceDay } from '@hr/shared';

import {
  AttendanceTabs,
  fmtDate,
  fmtMinutes,
  fmtTime,
  monthLabel,
  shiftMonth,
  StatusBadge,
  todayIn,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { ClockCard } from '@/components/attendance/clock-card';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField } from '@/components/employees/fields';
import { STATUS_STYLE } from '@/components/leave/leave-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import {
  useDecideCorrection,
  useMonthDays,
  useMyRegularizations,
  useRequestCorrection,
} from '@/lib/queries/attendance';

function CorrectionDialog({ date, onClose }: { date: string | null; onClose: () => void }) {
  const request = useRequestCorrection();
  const [f, setF] = useState({ requestedIn: '', requestedOut: '', outNextDay: false, reason: '' });
  return (
    <Dialog
      open={!!date}
      onOpenChange={(o) => {
        if (!o) {
          setF({ requestedIn: '', requestedOut: '', outNextDay: false, reason: '' });
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a correction</DialogTitle>
          <DialogDescription>
            {date && fmtDate(date)} — give the time you actually came in and/or left. Your manager
            approves it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate(
              {
                date: date!,
                requestedIn: f.requestedIn || null,
                requestedOut: f.requestedOut || null,
                outNextDay: f.outNextDay,
                reason: f.reason,
              },
              { onSuccess: onClose },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="rg-in" label="In time">
              <Input
                id="rg-in"
                type="time"
                value={f.requestedIn}
                onChange={(e) => setF({ ...f, requestedIn: e.target.value })}
              />
            </FormField>
            <FormField id="rg-out" label="Out time">
              <Input
                id="rg-out"
                type="time"
                value={f.requestedOut}
                onChange={(e) => setF({ ...f, requestedOut: e.target.value })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.outNextDay}
              onChange={(e) => setF({ ...f, outNextDay: e.target.checked })}
            />
            I left on the next day (night shift)
          </label>
          <FormField id="rg-reason" label="Reason">
            <Textarea
              id="rg-reason"
              required
              minLength={3}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="submit"
              disabled={request.isPending || (!f.requestedIn && !f.requestedOut)}
            >
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MonthTable({ days, onFix }: { days: AttendanceDay[]; onFix: (date: string) => void }) {
  const tz = useTenantTz();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>In</TableHead>
            <TableHead>Out</TableHead>
            <TableHead>Worked</TableHead>
            <TableHead>Late</TableHead>
            <TableHead>OT</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...days].reverse().map((d) => (
            <TableRow key={d.id} data-testid={`day-${d.date}`}>
              <TableCell className="whitespace-nowrap">{fmtDate(d.date)}</TableCell>
              <TableCell>
                <StatusBadge status={d.status} />
              </TableCell>
              <TableCell>{fmtTime(d.firstIn, tz)}</TableCell>
              <TableCell>{fmtTime(d.lastOut, tz)}</TableCell>
              <TableCell>{fmtMinutes(d.workedMinutes)}</TableCell>
              <TableCell>{fmtMinutes(d.lateMinutes)}</TableCell>
              <TableCell>{fmtMinutes(d.otMinutes)}</TableCell>
              <TableCell className="text-right">
                {!d.isLocked && ['incomplete', 'absent', 'half_day'].includes(d.status) && (
                  <Button size="sm" variant="ghost" onClick={() => onFix(d.date)}>
                    <Wrench /> Fix
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function MyAttendancePage() {
  const tz = useTenantTz();
  const { me } = useAuth();
  const [month, setMonth] = useState(() => todayIn(tz).slice(0, 7));
  const days = useMonthDays(month, me?.employee?.id);
  const regs = useMyRegularizations();
  const decide = useDecideCorrection();
  const [fixDate, setFixDate] = useState<string | null>(null);

  return (
    <RequirePermission permission="attendance.clock">
      <PageHeader title="Attendance" />
      <AttendanceTabs />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <ClockCard />
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{monthLabel(month)}</h2>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Previous month"
                  onClick={() => setMonth(shiftMonth(month, -1))}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Next month"
                  onClick={() => setMonth(shiftMonth(month, 1))}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
            {days.error && <ErrorAlert error={days.error} />}
            {!days.data ? (
              me?.employee?.id ? (
                <Skeleton className="h-64" />
              ) : null
            ) : days.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">No attendance for this month yet.</p>
            ) : (
              <MonthTable days={days.data} onFix={setFixDate} />
            )}
          </div>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">My corrections</CardTitle>
            <CardDescription>Missed a punch? Use “Fix” on the day.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {regs.data?.length === 0 && (
              <p className="text-muted-foreground text-sm">No correction requests.</p>
            )}
            {regs.data?.map((r) => (
              <div key={r.id} className="space-y-1 border-b pb-3 text-sm last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{fmtDate(r.date)}</span>
                  <Badge variant={STATUS_STYLE[r.status] ?? 'outline'}>{r.status}</Badge>
                </div>
                <p className="text-muted-foreground">
                  {r.requestedIn && `In ${fmtTime(r.requestedIn, tz)}`}
                  {r.requestedIn && r.requestedOut && ' · '}
                  {r.requestedOut && `Out ${fmtTime(r.requestedOut, tz)}`} — {r.reason}
                </p>
                {r.status === 'pending' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: r.id, action: 'cancel' })}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <CorrectionDialog date={fixDate} onClose={() => setFixDate(null)} />
    </RequirePermission>
  );
}
