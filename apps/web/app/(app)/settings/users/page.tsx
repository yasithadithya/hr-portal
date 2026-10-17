'use client';

import { MoreHorizontal, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import {
  useEmployeeOptions,
  useInviteUser,
  useResendInvite,
  useRoles,
  useUpdateUser,
  useUsers,
} from '@/lib/queries/admin';
import type { Role, User } from '@hr/shared';

const STATUS_VARIANT: Record<User['status'], 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  invited: 'secondary',
  disabled: 'outline',
};

function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: Role[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Roles</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((r) => (
          <label key={r.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              checked={value.includes(r.id)}
              onCheckedChange={(on) =>
                onChange(on ? [...value, r.id] : value.filter((id) => id !== r.id))
              }
              aria-label={r.name}
            />
            <span>
              <span className="font-medium">{r.name}</span>
              {r.description && (
                <span className="text-muted-foreground block text-xs">{r.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NO_EMPLOYEE = '__none__';

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const roles = useRoles(open);
  const employees = useEmployeeOptions(open);
  const invite = useInviteUser();
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState(NO_EMPLOYEE);

  function reset() {
    setEmail('');
    setRoleIds([]);
    setEmployeeId(NO_EMPLOYEE);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They get an email to set a password for this workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(
              {
                email,
                roleIds,
                employeeId: employeeId === NO_EMPLOYEE ? null : employeeId,
              },
              {
                onSuccess: () => {
                  reset();
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {roles.data ? (
            <RolePicker roles={roles.data} value={roleIds} onChange={setRoleIds} />
          ) : (
            <Skeleton className="h-24" />
          )}
          <div className="space-y-2">
            <Label>Linked employee (optional)</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-full" aria-label="Linked employee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_EMPLOYEE}>Not linked</SelectItem>
                {employees.data?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employeeNo} · {e.firstName} {e.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={invite.isPending || !email || roleIds.length === 0}>
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const roles = useRoles(!!user);
  const update = useUpdateUser();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [prevUser, setPrevUser] = useState<User | null>(null);
  if (user !== prevUser) {
    setPrevUser(user);
    setRoleIds(user?.roles.map((r) => r.id) ?? []);
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Roles for {user?.email}</DialogTitle>
        </DialogHeader>
        {roles.data ? (
          <RolePicker roles={roles.data} value={roleIds} onChange={setRoleIds} />
        ) : (
          <Skeleton className="h-24" />
        )}
        <DialogFooter>
          <Button
            disabled={update.isPending || roleIds.length === 0}
            onClick={() => update.mutate({ id: user!.id, roleIds }, { onSuccess: onClose })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTable() {
  const { me } = useAuth();
  const users = useUsers();
  const update = useUpdateUser();
  const resend = useResendInvite();
  const [editing, setEditing] = useState<User | null>(null);

  if (users.error) return <ErrorAlert error={users.error} />;
  if (!users.data) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.id} variant="secondary">
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[u.status]}>{u.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                </TableCell>
                <TableCell>
                  {u.id !== me?.user.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(u)}>
                          Edit roles
                        </DropdownMenuItem>
                        {u.status === 'invited' && (
                          <DropdownMenuItem onClick={() => resend.mutate(u.id)}>
                            Resend invite
                          </DropdownMenuItem>
                        )}
                        {u.status === 'active' && (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => update.mutate({ id: u.id, status: 'disabled' })}
                          >
                            Disable access
                          </DropdownMenuItem>
                        )}
                        {u.status === 'disabled' && (
                          <DropdownMenuItem
                            onClick={() => update.mutate({ id: u.id, status: 'active' })}
                          >
                            Re-enable access
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <EditRolesDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export default function UsersPage() {
  const [inviting, setInviting] = useState(false);
  return (
    <RequirePermission permission="users.manage" scope="all">
      <PageHeader
        title="Users"
        description="People who can sign in to this workspace"
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus /> Invite user
          </Button>
        }
      />
      <UsersTable />
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </RequirePermission>
  );
}
