'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  attendanceDaySchema,
  clockResultSchema,
  deviceUserSchema,
  monthlySummarySchema,
  periodSchema,
  punchSchema,
  regularizationSchema,
  rosterWeekSchema,
  shiftAssignmentSchema,
  shiftSchema,
  todaySchema,
  type ClockInput,
  type RegularizationInput,
  type ShiftInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api } from '@/lib/api';

function useAttendanceMutation<V, R>(
  fn: (v: V) => Promise<R>,
  success?: string | ((r: R) => string),
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
      await qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

// ── Self-service ────────────────────────────────────────────────────────────
export const useToday = (enabled = true) =>
  useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: ({ signal }) => api.get('/api/v1/attendance/today', todaySchema, { signal }),
    enabled,
    refetchInterval: 60_000,
  });

/** Clock results are shown by the caller (a rejection is a normal, explained outcome). */
export function useClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClockInput) => api.post('/api/v1/attendance/clock', clockResultSchema, body),
    onSettled: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });
}

export const useMonthDays = (month: string, employeeId: string | null | undefined) =>
  useQuery({
    queryKey: ['attendance', 'days', 'month', month, employeeId],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/attendance/days?${qs({ month, employeeId: employeeId ?? undefined })}`,
        z.array(attendanceDaySchema),
        { signal },
      ),
    enabled: !!employeeId,
  });

export const useDayPunches = (employeeId: string, date: string, enabled: boolean) =>
  useQuery({
    queryKey: ['attendance', 'punches', employeeId, date],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/attendance/punches?${qs({ employeeId, from: date, to: date })}`,
        z.array(punchSchema),
        { signal },
      ),
    enabled,
  });

// ── Board ───────────────────────────────────────────────────────────────────
export const useBoard = (date: string, departmentId?: string) =>
  useQuery({
    queryKey: ['attendance', 'days', 'board', date, departmentId],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/attendance/days?${qs({ date, departmentId })}`,
        z.array(attendanceDaySchema),
        {
          signal,
        },
      ),
  });

export const useApproveOt = () =>
  useAttendanceMutation(
    ({ id, approvedMinutes }: { id: string; approvedMinutes: number }) =>
      api.post(`/api/v1/attendance/days/${id}/ot`, attendanceDaySchema, { approvedMinutes }),
    'Overtime saved',
  );

// ── Regularisation ──────────────────────────────────────────────────────────
export const useMyRegularizations = () =>
  useQuery({
    queryKey: ['attendance', 'regularizations', 'mine'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/attendance/regularizations?mine=true', z.array(regularizationSchema), {
        signal,
      }),
  });

export const useRegInbox = () =>
  useQuery({
    queryKey: ['attendance', 'inbox'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/attendance/inbox', z.array(regularizationSchema), { signal }),
  });

export const useRequestCorrection = () =>
  useAttendanceMutation(
    (body: RegularizationInput) =>
      api.post('/api/v1/attendance/regularizations', regularizationSchema, body),
    'Correction requested',
  );

export const useDecideCorrection = () =>
  useAttendanceMutation(
    ({
      id,
      action,
      note,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'cancel';
      note?: string;
    }) =>
      api.post(`/api/v1/attendance/regularizations/${id}/${action}`, regularizationSchema, {
        note: note ?? null,
      }),
    (r) => `Request ${r.status}`,
  );

// ── Shifts, assignments, roster ─────────────────────────────────────────────
export const useShifts = () =>
  useQuery({
    queryKey: ['attendance', 'shifts'],
    queryFn: ({ signal }) => api.get('/api/v1/attendance/shifts', z.array(shiftSchema), { signal }),
  });

export const useSaveShift = () =>
  useAttendanceMutation(
    ({ id, ...body }: ShiftInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/attendance/shifts/${id}`, shiftSchema, body)
        : api.post('/api/v1/attendance/shifts', shiftSchema, body),
    'Shift saved',
  );

export const useAssignments = () =>
  useQuery({
    queryKey: ['attendance', 'assignments'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/attendance/assignments', z.array(shiftAssignmentSchema), { signal }),
  });

export const useAssignShift = () =>
  useAttendanceMutation(
    (body: { employeeIds: string[]; shiftId: string; effectiveFrom: string }) =>
      api.post('/api/v1/attendance/assignments', z.object({ assigned: z.number() }), body),
    (r) => `Shift assigned to ${r.assigned} employee(s)`,
  );

export const useRoster = (weekStart: string, departmentId?: string) =>
  useQuery({
    queryKey: ['attendance', 'roster', weekStart, departmentId],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/attendance/roster?${qs({ weekStart, departmentId })}`, rosterWeekSchema, {
        signal,
      }),
  });

export const useSaveRoster = () =>
  useAttendanceMutation(
    (entries: { employeeId: string; date: string; shiftId: string | null | 'clear' }[]) =>
      api.put('/api/v1/attendance/roster', z.object({ updated: z.number() }), { entries }),
    'Roster saved',
  );

// ── Device users ────────────────────────────────────────────────────────────
export const useDeviceUsers = () =>
  useQuery({
    queryKey: ['attendance', 'device-users'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/attendance/device-users', z.array(deviceUserSchema), { signal }),
  });

export const useSaveDeviceUser = () =>
  useAttendanceMutation(
    (body: { deviceUserId: string; employeeId: string }) =>
      api.post('/api/v1/attendance/device-users', z.object({ id: z.uuid() }), body),
    'Device user mapped',
  );

export const useDeleteDeviceUser = () =>
  useAttendanceMutation(
    (id: string) =>
      api.delete(`/api/v1/attendance/device-users/${id}`, z.object({ deleted: z.boolean() })),
    'Mapping removed',
  );

// ── Monthly summary & periods ───────────────────────────────────────────────
export const useMonthlySummary = (month: string, departmentId?: string) =>
  useQuery({
    queryKey: ['attendance', 'summary', month, departmentId],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/attendance/summary?${qs({ month, departmentId })}`, monthlySummarySchema, {
        signal,
      }),
  });

export const useProcess = () =>
  useAttendanceMutation(
    (body: { from: string; to: string }) =>
      api.post(
        '/api/v1/attendance/process',
        z.object({ processed: z.number(), skippedLocked: z.number() }),
        body,
      ),
    (r) => `Recalculated ${r.processed} day(s)`,
  );

/** Lock errors (incomplete days) are shown by the caller so it can offer "lock anyway". */
export function useLockPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, force }: { month: string; force: boolean }) =>
      api.post(`/api/v1/attendance/periods/${month}/lock`, periodSchema, { force }),
    onSuccess: async () => {
      toast.success('Month locked');
      await qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export const useUnlockPeriod = () =>
  useAttendanceMutation(
    ({ month, reason }: { month: string; reason: string }) =>
      api.post(`/api/v1/attendance/periods/${month}/unlock`, periodSchema, { reason }),
    'Month unlocked',
  );
