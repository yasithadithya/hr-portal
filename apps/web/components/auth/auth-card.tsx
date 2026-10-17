'use client';

import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePublicTenant } from '@/lib/tenant';

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  const { data: tenant, error } = usePublicTenant();
  return (
    <Card>
      <CardHeader>
        <p className="text-muted-foreground min-h-5 text-sm font-medium" data-testid="tenant-name">
          {tenant?.name ?? (error ? 'Unknown workspace' : '')}
        </p>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
