'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** Sub-navigation for the Leave area; tabs follow permissions. */
export function LeaveTabs() {
  const pathname = usePathname();
  const { can } = useAuth();
  const tabs = [
    { href: '/leave', label: 'My leave', show: can('leave.apply') },
    { href: '/leave/approvals', label: 'Approvals', show: can('leave.approve', 'team') },
    { href: '/leave/calendar', label: 'Team calendar', show: can('leave.read', 'team') },
    { href: '/leave/admin', label: 'Leave settings', show: can('leave.manage', 'all') },
  ].filter((t) => t.show);
  if (tabs.length <= 1) return null;
  return (
    <nav aria-label="Leave" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active = t.href === '/leave' ? pathname === '/leave' : pathname.startsWith(t.href);
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

export const STATUS_STYLE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  rejected: 'destructive',
  cancelled: 'outline',
  withdrawn: 'outline',
};

export function formatRange(r: {
  startDate: string;
  endDate: string;
  startHalf: string;
  endHalf: string;
}) {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
    });
  const half = (h: string) => (h === 'first' ? ' (AM)' : h === 'second' ? ' (PM)' : '');
  return r.startDate === r.endDate
    ? `${fmt(r.startDate)}${half(r.startHalf)}`
    : `${fmt(r.startDate)}${half(r.startHalf)} – ${fmt(r.endDate)}${half(r.endHalf)}`;
}

export function unitLabel(unit: string, amount: number) {
  if (unit === 'hour') return `${amount} h`;
  return `${amount} ${amount === 1 ? 'day' : 'days'}`;
}
