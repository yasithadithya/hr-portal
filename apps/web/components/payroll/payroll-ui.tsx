'use client';

import { FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { PayrollRun } from '@hr/shared';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function PayrollTabs() {
  const pathname = usePathname();
  const { can } = useAuth();
  const tabs = [
    { href: '/payroll', label: 'Runs', show: can('payroll.read', 'all') },
    { href: '/payroll/employees', label: 'Employee pay', show: can('payroll.read', 'all') },
    { href: '/payroll/reports', label: 'Reports', show: can('payroll.read', 'all') },
    { href: '/payroll/settings', label: 'Settings', show: can('payroll.read', 'all') },
  ].filter((t) => t.show);
  return (
    <nav aria-label="Payroll" className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => {
        const active =
          t.href === '/payroll'
            ? pathname === '/payroll' || pathname.startsWith('/payroll/runs')
            : pathname.startsWith(t.href);
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

const RUN_STYLE: Record<PayrollRun['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  calculated: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  approved: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  locked: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  paid: 'bg-emerald-600 text-white',
};

export function RunStatusBadge({ status }: { status: PayrollRun['status'] }) {
  return (
    <Badge variant="outline" className={cn('border-transparent capitalize', RUN_STYLE[status])}>
      {status}
    </Badge>
  );
}

/** Shown wherever SAMPLE statutory data could influence real numbers. */
export function SampleDataBanner({ className }: { className?: string }) {
  return (
    <Alert className={cn('border-amber-400 bg-amber-50 dark:bg-amber-950/30', className)}>
      <FlaskConical className="size-4" />
      <AlertTitle>Sample payroll data</AlertTitle>
      <AlertDescription>
        Statutory rates, the APIT table, bank layouts and report formats are placeholders. Replace
        them with the client’s confirmed figures (Payroll → Settings) and have an accountant check a
        parallel run before paying real salaries.
      </AlertDescription>
    </Alert>
  );
}

export const runLabel = (r: Pick<PayrollRun, 'month' | 'type'>) => {
  const month = new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
  return r.type === 'regular' ? month : `${month} · ${r.type.replace('_', '-')}`;
};
