'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  auditPageSchema,
  employeePageSchema,
  roleSchema,
  userSchema,
  type CreateRoleInput,
  type InviteUserInput,
  type UpdateRoleInput,
  type UpdateUserInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api } from '@/lib/api';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => api.get('/api/v1/users', z.array(userSchema), { signal }),
  });
}

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => api.get('/api/v1/roles', z.array(roleSchema), { signal }),
    enabled,
  });
}

export function useEmployeeOptions(enabled = true) {
  return useQuery({
    queryKey: ['employees', 'options'],
    queryFn: ({ signal }) =>
      api
        .get('/api/v1/employees?pageSize=1000&sort=name', employeePageSchema, { signal })
        .then((p) => p.items),
    enabled,
  });
}

function useAdminMutation<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  opts: { success: string; invalidate: string[][] },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(opts.success);
      await Promise.all(opts.invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export const useInviteUser = () =>
  useAdminMutation(
    (input: InviteUserInput) => api.post('/api/v1/users/invite', userSchema, input),
    {
      success: 'Invite sent',
      invalidate: [['users'], ['audit']],
    },
  );

export const useUpdateUser = () =>
  useAdminMutation(
    ({ id, ...input }: UpdateUserInput & { id: string }) =>
      api.patch(`/api/v1/users/${id}`, userSchema, input),
    { success: 'User updated', invalidate: [['users'], ['roles'], ['audit']] },
  );

export const useResendInvite = () =>
  useAdminMutation((id: string) => api.post(`/api/v1/users/${id}/resend-invite`, userSchema), {
    success: 'Invite re-sent',
    invalidate: [['users']],
  });

export const useCreateRole = () =>
  useAdminMutation((input: CreateRoleInput) => api.post('/api/v1/roles', roleSchema, input), {
    success: 'Role created',
    invalidate: [['roles'], ['audit']],
  });

export const useUpdateRole = () =>
  useAdminMutation(
    ({ id, ...input }: UpdateRoleInput & { id: string }) =>
      api.patch(`/api/v1/roles/${id}`, roleSchema, input),
    { success: 'Role saved', invalidate: [['roles'], ['audit']] },
  );

export const useDeleteRole = () =>
  useAdminMutation(
    (id: string) => api.delete(`/api/v1/roles/${id}`, z.object({ id: z.string() })),
    { success: 'Role deleted', invalidate: [['roles'], ['audit']] },
  );

export function useAuditLog(filter: { entity?: string | undefined }) {
  return useInfiniteQuery({
    queryKey: ['audit', filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({ limit: '50' });
      if (filter.entity) qs.set('entity', filter.entity);
      if (pageParam) qs.set('cursor', pageParam);
      return api.get(`/api/v1/audit-log?${qs}`, auditPageSchema, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
