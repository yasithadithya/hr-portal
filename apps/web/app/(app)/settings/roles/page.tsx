'use client';

import { Copy, Lock, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from '@/lib/queries/admin';
import {
  PERMISSION_KEYS,
  PERMISSIONS,
  type PermissionKey,
  type Role,
  type RolePermission,
  type Scope,
} from '@hr/shared';

const NONE = 'none';
const SCOPE_LABEL: Record<Scope, string> = { self: 'Own', team: 'Team', all: 'Everyone' };

/** Permission keys grouped by module for the matrix. */
const GROUPS = PERMISSION_KEYS.reduce<Record<string, PermissionKey[]>>((acc, key) => {
  const mod = key.split('.')[0]!;
  (acc[mod] ??= []).push(key);
  return acc;
}, {});

function PermissionMatrix({
  value,
  onChange,
  readOnly,
}: {
  value: RolePermission[];
  onChange?: (v: RolePermission[]) => void;
  readOnly?: boolean;
}) {
  const scopeOf = (key: PermissionKey) => value.find((p) => p.key === key)?.scope;
  function set(key: PermissionKey, scope: Scope | typeof NONE) {
    const rest = value.filter((p) => p.key !== key);
    onChange?.(scope === NONE ? rest : [...rest, { key, scope }]);
  }
  return (
    <div className="space-y-4">
      {Object.entries(GROUPS).map(([mod, keys]) => (
        <div key={mod}>
          <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
            {mod}
          </h3>
          <div className="divide-y rounded-md border">
            {keys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{PERMISSIONS[key].label}</span>
                {readOnly ? (
                  <span className="text-muted-foreground">
                    {scopeOf(key) ? SCOPE_LABEL[scopeOf(key)!] : '—'}
                  </span>
                ) : (
                  <Select value={scopeOf(key) ?? NONE} onValueChange={(v) => set(key, v as Scope)}>
                    <SelectTrigger className="w-32" aria-label={PERMISSIONS[key].label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No access</SelectItem>
                      {PERMISSIONS[key].scopes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SCOPE_LABEL[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleDialog({
  mode,
  role,
  onClose,
}: {
  mode: 'copy' | 'edit' | 'view';
  role: Role | null;
  onClose: () => void;
}) {
  const create = useCreateRole();
  const update = useUpdateRole();
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<RolePermission[]>([]);
  const [prev, setPrev] = useState<{ role: Role | null; mode: string } | null>(null);
  if (prev?.role !== role || prev?.mode !== mode) {
    setPrev({ role, mode });
    setName(role ? (mode === 'copy' ? `${role.name} (copy)` : role.name) : '');
    setPerms(role?.permissions ?? []);
  }
  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={!!role} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'copy' ? 'New role from copy' : mode === 'edit' ? 'Edit role' : role?.name}
          </DialogTitle>
          <DialogDescription>
            {mode === 'view'
              ? 'System roles are read-only. Copy one to customise it.'
              : 'You can only grant permissions you hold yourself.'}
          </DialogDescription>
        </DialogHeader>
        {mode !== 'view' && (
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <PermissionMatrix value={perms} onChange={setPerms} readOnly={mode === 'view'} />
        {mode !== 'view' && (
          <DialogFooter>
            <Button
              disabled={busy || name.trim().length < 2}
              onClick={() =>
                mode === 'copy'
                  ? create.mutate({ name, permissions: perms }, { onSuccess: onClose })
                  : update.mutate(
                      { id: role!.id, name, permissions: perms },
                      { onSuccess: onClose },
                    )
              }
            >
              {mode === 'copy' ? 'Create role' : 'Save'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function RolesPage() {
  const roles = useRoles();
  const del = useDeleteRole();
  const [dialog, setDialog] = useState<{ mode: 'copy' | 'edit' | 'view'; role: Role } | null>(null);

  return (
    <RequirePermission permission="users.manage" scope="all">
      <PageHeader title="Roles & permissions" description="What each role can see and do" />
      {roles.error && <ErrorAlert error={roles.error} />}
      {!roles.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.data.map((r) => (
            <Card key={r.id} data-testid={`role-${r.key}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {r.name}
                      {r.isSystem && (
                        <Lock className="text-muted-foreground size-3.5" aria-label="System role" />
                      )}
                    </CardTitle>
                    <CardDescription>{r.description ?? 'Custom role'}</CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {r.userCount} {r.userCount === 1 ? 'user' : 'users'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ mode: r.isSystem ? 'view' : 'edit', role: r })}
                >
                  <Pencil /> {r.isSystem ? 'View' : 'Edit'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog({ mode: 'copy', role: r })}
                >
                  <Copy /> Copy
                </Button>
                {!r.isSystem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={r.userCount > 0 || del.isPending}
                    title={r.userCount > 0 ? 'Remove this role from all users first' : undefined}
                    onClick={() => del.mutate(r.id)}
                  >
                    <Trash2 /> Delete
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <RoleDialog
        mode={dialog?.mode ?? 'view'}
        role={dialog?.role ?? null}
        onClose={() => setDialog(null)}
      />
    </RequirePermission>
  );
}
