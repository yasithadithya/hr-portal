'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { usePublicTenant } from '@/lib/tenant';
import { cn } from '@/lib/utils';

import { NAV_ITEMS } from './nav';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useAuth();
  const items = NAV_ITEMS.filter((i) => !i.anyOf || i.anyOf.some((k) => can(k)));

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {items.map(({ href, label, icon: Icon, ready }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const classes = cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
          !ready && 'pointer-events-none opacity-50',
        );
        return ready ? (
          <Link
            key={href}
            href={href}
            className={classes}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ) : (
          <span key={href} className={classes} aria-disabled="true" title="Coming soon">
            <Icon className="size-4" />
            {label}
          </span>
        );
      })}
    </nav>
  );
}

export function Brand() {
  const { data: tenant } = usePublicTenant();
  return (
    <div
      className="flex h-14 items-center truncate px-6 text-base font-semibold tracking-tight"
      data-testid="tenant-name"
    >
      {tenant?.name ?? 'HR Portal'}
    </div>
  );
}
