'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { AttendanceDay } from '@hr/shared';

import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { usePublicTenant } from '@/lib/tenant';
import { cn } from '@/lib/utils';

/** Sub-navigation for the Attendance area; tabs follow permissions. */
export function AttendanceTabs() {
  const pathname = usePathname();
  const { can } = useAuth();
  const tabs = [
    { href: '/attendance', label: 'My attendance', show: can('attendance.clock') },
    { href: '/attendance/board', label: 'Daily board', show: can('attendance.read', 'team') },
    { href: '/attendance/approvals', label: 'Approvals', show: can('attendance.approve', 'team') },
    { href: '/attendance/monthly', label: 'Monthly', show: can('attendance.read', 'team') },
    { href: '/attendance/roster', label: 'Roster', show: can('attendance.read', 'team') },
    { href: '/attendance/shifts', label: 'Shifts', show: can('attendance.manage', 'all') },
    { href: '/attendance/devices', label: 'Device import', show: can('attendance.manage', 'all') },
  ].filter((t) => t.show);
  if (tabs.length <= 1) return null;
  return (
    <nav aria-label="Attendance" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active =
          t.href === '/attendance' ? pathname === '/attendance' : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
              active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const STATUS_LABEL: Record<AttendanceDay['status'], string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  on_leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Rest day',
  incomplete: 'Missing punch',
};

const STATUS_CLASS: Record<AttendanceDay['status'], string> = {
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  half_day: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  on_leave: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  holiday: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  weekend: 'bg-muted text-muted-foreground',
  incomplete: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
};

export function StatusBadge({ status }: { status: AttendanceDay['status'] }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Exceptions first on the board: missing punch, absent, late, half day, then the rest. */
export function exceptionRank(d: AttendanceDay): number {
  if (d.status === 'incomplete') return 0;
  if (d.status === 'absent') return 1;
  if (d.lateMinutes > 0) return 2;
  if (d.status === 'half_day') return 3;
  if (d.earlyMinutes > 0) return 4;
  return 5;
}

/** Company timezone (times are always shown as the office clock, not the viewer's). */
export function useTenantTz(): string {
  return usePublicTenant().data?.timezone ?? 'Asia/Colombo';
}

export function fmtTime(iso: string | null, tz: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtMinutes(m: number): string {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts,
  });
}

/** Current `YYYY-MM` / `YYYY-MM-DD` in the company timezone. */
export function todayIn(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}
