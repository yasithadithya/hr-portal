'use client';

import {
  Building2,
  CalendarDays,
  History,
  Lock,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import type { PermissionKey } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

const SECTIONS: {
  href: string;
  title: string;
  description: string;
  icon: typeof Users;
  perm: PermissionKey;
}[] = [
  {
    href: '/settings/company',
    title: 'Company',
    description: 'Legal details, EPF/ETF numbers, logo, timezone',
    icon: Building2,
    perm: 'settings.manage',
  },
  {
    href: '/settings/organisation',
    title: 'Organisation',
    description: 'Branches, departments, grades, designations, cost centres',
    icon: Network,
    perm: 'org.manage',
  },
  {
    href: '/settings/calendars',
    title: 'Work week & holidays',
    description: 'Working days, half days and the holiday calendar',
    icon: CalendarDays,
    perm: 'settings.manage',
  },
  {
    href: '/settings/preferences',
    title: 'Preferences',
    description: 'Two-factor authentication, brand colour, numbering',
    icon: SlidersHorizontal,
    perm: 'settings.manage',
  },
  {
    href: '/settings/privacy',
    title: 'Privacy',
    description: 'Privacy notice, data retention and data requests (PDPA)',
    icon: Lock,
    perm: 'settings.manage',
  },
  {
    href: '/settings/users',
    title: 'Users',
    description: 'Invite people, assign roles, disable access',
    icon: Users,
    perm: 'users.manage',
  },
  {
    href: '/settings/roles',
    title: 'Roles & permissions',
    description: 'System roles and your custom copies',
    icon: ShieldCheck,
    perm: 'users.manage',
  },
  {
    href: '/settings/audit',
    title: 'Audit log',
    description: 'Every change to HR data, who and when',
    icon: History,
    perm: 'audit.read',
  },
];

export default function SettingsPage() {
  const { can } = useAuth();
  return (
    <RequirePermission permission={['settings.manage', 'users.manage', 'audit.read']}>
      <PageHeader title="Settings" description="Workspace administration" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.filter((s) => can(s.perm, 'all')).map(
          ({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card className="hover:bg-accent/40 h-full transition-colors">
                <CardHeader>
                  <Icon className="text-muted-foreground mb-2 size-5" />
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ),
        )}
      </div>
    </RequirePermission>
  );
}
