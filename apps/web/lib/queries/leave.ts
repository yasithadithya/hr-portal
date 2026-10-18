'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  balanceReportRowSchema,
  balanceSchema,
  bulkDecisionResultSchema,
  leaveCalendarSchema,
  leavePolicySchema,
  leaveQuoteSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  yearEndPreviewSchema,
  type ApplyLeaveInput,
  type LeavePolicyInput,
  type LeaveTypeInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api } from '@/lib/api';
import { withOfflineCache } from '@/lib/offline';

const invalidateLeave = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['leave'] });

function useLeaveMutation<V, R>(fn: (v: V) => Promise<R>, success?: string | ((r: R) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
      await invalidateLeave(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export const useLeaveTypes = () =>
  useQuery({
    queryKey: ['leave', 'types'],
    queryFn: ({ signal }) => api.get('/api/v1/leave/types', z.array(leaveTypeSchema), { signal }),
  });

export const useBalances = (year: number, employeeId?: string) =>
  useQuery({
    queryKey: ['leave', 'balances', year, employeeId ?? 'me'],
    queryFn: ({ signal }) => {
      const path = `/api/v1/leave/balances?year=${year}${employeeId ? `&employeeId=${employeeId}` : ''}`;
      const load = () => api.get(path, z.array(balanceSchema), { signal });
      // My own balances stay viewable offline (last known copy).
      return employeeId ? load() : withOfflineCache(`balances:${year}`, load);
    },
  });

export const useMyRequests = (year: number) =>
  useQuery({
    queryKey: ['leave', 'requests', 'mine', year],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/leave/requests?mine=true&year=${year}`, z.array(leaveRequestSchema), {
        signal,
      }),
  });

export const useInbox = (enabled: boolean) =>
  useQuery({
    queryKey: ['leave', 'inbox'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/leave/inbox', z.array(leaveRequestSchema), { signal }),
    enabled,
  });

export const useLeaveCalendar = (month: string, departmentId?: string) =>
  useQuery({
    queryKey: ['leave', 'calendar', month, departmentId],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/leave/calendar?month=${month}${departmentId ? `&departmentId=${departmentId}` : ''}`,
        leaveCalendarSchema,
        { signal },
      ),
  });

export const useQuote = () =>
  useMutation({
    mutationFn: (input: ApplyLeaveInput) =>
      api.post('/api/v1/leave/quote', leaveQuoteSchema, input),
  });

export const useApplyLeave = () =>
  useLeaveMutation(
    (input: ApplyLeaveInput) => api.post('/api/v1/leave/requests', leaveRequestSchema, input),
    'Leave requested',
  );

export const useDecide = () =>
  useLeaveMutation(
    ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note?: string }) =>
      api.post(`/api/v1/leave/requests/${id}/${action}`, leaveRequestSchema, {
        note: note ?? null,
      }),
    (r) => `Request ${r.status}`,
  );

export const useBulkDecide = () =>
  useLeaveMutation(
    (input: { ids: string[]; action: 'approve' | 'reject'; note?: string }) =>
      api.post('/api/v1/leave/requests/bulk-decide', bulkDecisionResultSchema, input),
    (r) =>
      `${r.done.length} done${r.failed.length ? `, ${r.failed.length} could not be processed` : ''}`,
  );

export const useCancelLeave = () =>
  useLeaveMutation(
    ({ id, note }: { id: string; note?: string }) =>
      api.post(`/api/v1/leave/requests/${id}/cancel`, leaveRequestSchema, { note: note ?? null }),
    (r) => (r.status === 'withdrawn' ? 'Request withdrawn' : 'Leave cancelled'),
  );

export const useAttachLeave = () =>
  useLeaveMutation(
    ({ id, file }: { id: string; file: File }) =>
      api.put(`/api/v1/leave/requests/${id}/attachment`, leaveRequestSchema, file, {
        headers: { 'content-type': file.type },
      }),
    'Document attached',
  );

export async function openLeaveAttachment(id: string) {
  const { url } = await api.get(
    `/api/v1/leave/requests/${id}/attachment`,
    z.object({ url: z.string() }),
  );
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Admin ────────────────────────────────────────────────────────────────────
export const usePolicies = (enabled = true) =>
  useQuery({
    queryKey: ['leave', 'policies'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/leave/policies', z.array(leavePolicySchema), { signal }),
    enabled,
  });

export const useSaveLeaveType = () =>
  useLeaveMutation(
    ({ id, ...input }: LeaveTypeInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/leave/types/${id}`, leaveTypeSchema, input)
        : api.post('/api/v1/leave/types', leaveTypeSchema, input),
    'Leave type saved',
  );

export const useSavePolicy = () =>
  useLeaveMutation(
    ({ id, ...input }: LeavePolicyInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/leave/policies/${id}`, leavePolicySchema, input)
        : api.post('/api/v1/leave/policies', leavePolicySchema, input),
    'Policy saved',
  );

export const useAdjust = () =>
  useLeaveMutation(
    (input: {
      employeeId: string;
      leaveTypeId: string;
      year: number;
      amount: number;
      note: string;
    }) =>
      api.post('/api/v1/leave/adjustments', z.object({ balance: z.number() }).passthrough(), input),
    'Balance adjusted',
  );

export const useBalanceReport = (year: number, enabled: boolean) =>
  useQuery({
    queryKey: ['leave', 'report', year],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/leave/report/balances?year=${year}`,
        z.object({ year: z.number(), rows: z.array(balanceReportRowSchema) }),
        { signal },
      ),
    enabled,
  });

export const useYearEnd = () =>
  useLeaveMutation(
    (input: { fromYear: number; dryRun: boolean }) =>
      api.post('/api/v1/leave/year-end', yearEndPreviewSchema, input),
    (r) => (r.alreadyRun ? `Year-end for ${r.fromYear} completed` : 'Preview ready'),
  );
