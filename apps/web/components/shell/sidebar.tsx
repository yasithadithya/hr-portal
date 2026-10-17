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
    <div className="flex h-14 items-center gap-2 px-6">
      {tenant?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={tenant.logoUrl} alt="" className="size-7 rounded object-contain" />
      )}
      <span className="truncate text-base font-semibold tracking-tight" data-testid="tenant-name">
        {tenant?.name ?? 'HR Portal'}
      </span>
    </div>
  );
}

/** Applies the tenant's brand colour (Settings → Preferences) to the primary theme token. */
export function BrandColor() {
  const { data: tenant } = usePublicTenant();
  const color = tenant?.theme.primaryColor;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  return <style>{`:root, .dark { --primary: ${color}; --ring: ${color}; }`}</style>;
}
