'use client';

import { History, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import type { PermissionKey } from '@hr/shared';

const SECTIONS: {
  href: string;
  title: string;
  description: string;
  icon: typeof Users;
  perm: PermissionKey;
}[] = [
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
