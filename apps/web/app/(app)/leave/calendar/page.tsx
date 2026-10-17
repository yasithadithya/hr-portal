'use client';

import { useState } from 'react';

import { eachDay, monthRange, weekdayOf } from '@hr/shared/time';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { selectClass } from '@/components/employees/fields';
import { LeaveTabs } from '@/components/leave/leave-tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeaveCalendar } from '@/lib/queries/leave';
import { useRefList } from '@/lib/queries/org';

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export default function LeaveCalendarPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const cal = useLeaveCalendar(month, departmentId || undefined);
  const depts = useRefList('departments');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const range = monthRange(y, m);
  const days = eachDay(range.start, range.end);
  const lead = WEEK.indexOf(weekdayOf(range.start) as (typeof WEEK)[number]);
  const label = new Date(`${range.start}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });

  return (
    <RequirePermission permission="leave.read" scope="team">
      <PageHeader title="Leave" />
      <LeaveTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </Button>
        <span className="w-40 text-center font-medium" data-testid="calendar-month">
          {label}
        </span>
        <Button
          size="sm"
          variant="outline"
          aria-label="Next month"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </Button>
        <select
          aria-label="Department"
          className={`${selectClass} w-48`}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          <option value="">All departments</option>
          {depts.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {cal.error && <ErrorAlert error={cal.error} />}
      {!cal.data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-sm"
            role="grid"
            aria-label={`Leave in ${label}`}
          >
            {WEEK.map((d) => (
              <div
                key={d}
                className="bg-muted px-2 py-1 text-xs font-medium uppercase"
                role="columnheader"
              >
                {d}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`pad-${i}`} className="bg-background min-h-24" />
            ))}
            {days.map((d) => {
              const holiday = cal.data.holidays.find((h) => h.date === d);
              const entries = cal.data.entries.filter((e) => e.date === d);
              return (
                <div
                  key={d}
                  className={`min-h-24 p-1 ${holiday ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-background'}`}
                  role="gridcell"
                >
                  <div className="text-muted-foreground text-xs">{Number(d.slice(8))}</div>
                  {holiday && (
                    <div className="truncate text-xs text-amber-700 dark:text-amber-400">
                      {holiday.name}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {entries.map((e) => (
                      <li
                        key={`${e.requestId}-${d}`}
                        className={`truncate rounded px-1 text-xs text-white ${e.status === 'pending' ? 'opacity-60' : ''}`}
                        style={{ background: e.color }}
                        title={`${e.employeeName} · ${e.leaveTypeCode}${e.portion < 1 ? ` (${e.half === 'first' ? 'AM' : 'PM'})` : ''} · ${e.status}`}
                      >
                        {e.employeeName}
                        {e.portion < 1 ? ' ½' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Faded entries are still waiting for approval.
          </p>
        </div>
      )}
    </RequirePermission>
  );
}
