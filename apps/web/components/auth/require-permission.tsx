'use client';

import type { ReactNode } from 'react';

import type { PermissionKey, Scope } from '@hr/shared';

import { useAuth } from '@/lib/auth';

import { Forbidden } from './forbidden';

/** Page-level guard. The API enforces the same rule; this only avoids showing a broken page. */
export function RequirePermission({
  permission,
  scope = 'self',
  children,
}: {
  permission: PermissionKey | PermissionKey[];
  scope?: Scope;
  children: ReactNode;
}) {
  const { can } = useAuth();
  const keys = Array.isArray(permission) ? permission : [permission];
  return keys.some((k) => can(k, scope)) ? <>{children}</> : <Forbidden />;
}
