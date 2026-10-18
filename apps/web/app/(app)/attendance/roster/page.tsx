'use client';

import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  AttendanceTabs,
  fmtDate,
  todayIn,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { selectClass } from '@/components/employees/fields';
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
import { useAuth } from '@/lib/auth';
import { useRoster, useSaveRoster, useShifts } from '@/lib/queries/attendance';
import { useRefList } from '@/lib/queries/org';

const addDays = (d: string, n: number) =>
  new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Monday of the week containing `d` (from the date string, not local time). */
function mondayOf(d: string) {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

/** Cell value encoding for the <select>: "default" | "off" | shift id. */
type Choice = string;

export default function RosterPage() {
  const tz = useTenantTz();
  const { can } = useAuth();
  const editable = can('attendance.manage', 'all');
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIn(tz)));
  const [departmentId, setDepartmentId] = useState('');
  const roster = useRoster(weekStart, departmentId || undefined);
  const shifts = useShifts();
  const departments = useRefList('departments');
  const save = useSaveRoster();
  const [changes, setChanges] = useState<Record<string, Choice>>({});
  const shiftById = useMemo(
    () => new Map((shifts.data ?? []).map((s) => [s.id, s])),
    [shifts.data],
  );

  const changeWeek = (n: number) => {
    setChanges({});
    setWeekStart(addDays(weekStart, n * 7));
  };

  const pending = Object.entries(changes);
  function onSave() {
    save.mutate(
      pending.map(([k, v]) => {
        const [employeeId, date] = k.split('|') as [string, string];
        return { employeeId, date, shiftId: v === 'default' ? 'clear' : v === 'off' ? null : v };
      }),
      { onSuccess: () => setChanges({}) },
    );
  }

  return (
    <RequirePermission permission="attendance.read" scope="team">
      <PageHeader
        title="Attendance"
        actions={
          editable && (
            <Button disabled={!pending.length || save.isPending} onClick={onSave}>
              <Save /> Save {pending.length ? `${pending.length} change(s)` : ''}
            </Button>
          )
        }
      />
      <AttendanceTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous week"
          onClick={() => changeWeek(-1)}
        >
          <ChevronLeft />
        </Button>
        <h2 className="min-w-52 text-center font-semibold">
          {fmtDate(weekStart, { weekday: undefined })} –{' '}
          {fmtDate(addDays(weekStart, 6), { weekday: undefined })}
        </h2>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => changeWeek(1)}>
          <ChevronRight />
        </Button>
        <select
          aria-label="Department"
          className={`${selectClass} ml-auto w-48`}
          value={departmentId}
          onChange={(e) => {
            setChanges({});
            setDepartmentId(e.target.value);
          }}
        >
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Each person works their assigned shift unless the roster says otherwise for a date.
        {editable && ' Pick a different shift or a rest day for rotating schedules.'}
      </p>
      {roster.error && <ErrorAlert error={roster.error} />}
      {!roster.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Employee</TableHead>
                {roster.data.dates.map((d) => (
                  <TableHead key={d} className="min-w-32 whitespace-nowrap">
                    {fmtDate(d, { month: undefined })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.data.rows.map((r) => (
                <TableRow key={r.employeeId} data-testid={`roster-${r.employeeNo}`}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-muted-foreground text-xs">{r.employeeNo}</div>
                  </TableCell>
                  {r.cells.map((c) => {
                    const key = `${r.employeeId}|${c.date}`;
                    const saved: Choice = c.source === 'roster' ? (c.shiftId ?? 'off') : 'default';
                    const value = changes[key] ?? saved;
                    const shown =
                      value === 'default'
                        ? c.source === 'assignment'
                          ? shiftById.get(c.shiftId!)
                          : undefined
                        : value === 'off'
                          ? undefined
                          : shiftById.get(value);
                    const label =
                      value === 'off'
                        ? 'Rest day'
                        : (shown?.code ?? (c.source === 'none' ? '—' : '…'));
                    if (!editable)
                      return (
                        <TableCell key={c.date}>
                          <span
                            className="inline-block rounded px-2 py-0.5 text-xs"
                            style={
                              shown ? { background: `${shown.color}22`, color: shown.color } : {}
                            }
                          >
                            {label}
                          </span>
                        </TableCell>
                      );
                    const defaultLabel =
                      c.source === 'assignment'
                        ? `${shiftById.get(c.shiftId!)?.code ?? 'Assigned'} (default)`
                        : c.source === 'none'
                          ? 'No shift'
                          : 'Assigned shift';
                    return (
                      <TableCell
                        key={c.date}
                        className={changes[key] ? 'bg-amber-50 dark:bg-amber-950/30' : ''}
                      >
                        <select
                          aria-label={`${r.name} ${c.date}`}
                          className={`${selectClass} h-8 text-xs`}
                          style={shown ? { borderLeft: `3px solid ${shown.color}` } : {}}
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next = { ...changes };
                            if (v === saved) delete next[key];
                            else next[key] = v;
                            setChanges(next);
                          }}
                        >
                          <option value="default">{defaultLabel}</option>
                          <option value="off">Rest day</option>
                          {shifts.data
                            ?.filter((s) => !s.archived)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.code}
                              </option>
                            ))}
                        </select>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </RequirePermission>
  );
}
