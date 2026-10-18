'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  approvalsSummarySchema,
  hrDashboardSchema,
  notificationListSchema,
  payrollDashboardSchema,
  pendingOtSchema,
  preferenceSchema,
  profileChangeSchema,
  reportInfoSchema,
  reportResultSchema,
  type ProfileChangeInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api } from '@/lib/api';

export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => api.get('/api/v1/notifications', notificationListSchema, { signal }),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      id === 'all'
        ? api.post('/api/v1/notifications/read-all', z.unknown())
        : api.post(`/api/v1/notifications/${id}/read`, z.unknown()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export const usePreferences = () =>
  useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/notifications/preferences', z.array(preferenceSchema), { signal }),
  });

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: { event: string; email: boolean; push: boolean }[]) =>
      api.put('/api/v1/notifications/preferences', z.unknown(), { preferences }),
    onSuccess: async () => {
      toast.success('Notification settings saved');
      await qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

// ── Web push ────────────────────────────────────────────────────────────────
function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg)
    throw new Error(
      'Notifications on this device need the installed app (service worker not active)',
    );
  return reg;
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error('Notifications are blocked for this site in the browser settings');
  const { publicKey } = await api.get(
    '/api/v1/push/public-key',
    z.object({ publicKey: z.string() }),
  );
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/api/v1/push/subscriptions', z.unknown(), {
    endpoint: json.endpoint,
    keys: json.keys,
  });
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await api.post('/api/v1/push/unsubscribe', z.unknown(), { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// ── Approvals ───────────────────────────────────────────────────────────────
export const useApprovalsSummary = (enabled = true) =>
  useQuery({
    queryKey: ['approvals', 'summary'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/approvals/summary', approvalsSummarySchema, { signal }),
    enabled,
    refetchInterval: 60_000,
  });

export const usePendingOt = (enabled: boolean) =>
  useQuery({
    queryKey: ['approvals', 'overtime'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/approvals/overtime', z.array(pendingOtSchema), { signal }),
    enabled,
  });

// ── Profile changes ─────────────────────────────────────────────────────────
export const useMyProfileChanges = () =>
  useQuery({
    queryKey: ['profile-changes', 'mine'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/me/profile-changes', z.array(profileChangeSchema), { signal }),
  });

export const usePendingProfileChanges = (enabled: boolean) =>
  useQuery({
    queryKey: ['profile-changes', 'pending'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/profile-changes?status=pending', z.array(profileChangeSchema), { signal }),
    enabled,
  });

function useInvalidating<V>(fn: (v: V) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(success);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['profile-changes'] }),
        qc.invalidateQueries({ queryKey: ['approvals'] }),
        qc.invalidateQueries({ queryKey: ['employees'] }),
      ]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export const useRequestProfileChange = () =>
  useInvalidating(
    (body: ProfileChangeInput) => api.post('/api/v1/me/profile-changes', profileChangeSchema, body),
    'Change sent to HR',
  );

export const useDecideProfileChange = () =>
  useInvalidating(
    ({ id, action }: { id: string; action: 'approve' | 'reject' | 'withdraw' }) =>
      action === 'withdraw'
        ? api.post(`/api/v1/me/profile-changes/${id}/withdraw`, profileChangeSchema)
        : api.post(`/api/v1/profile-changes/${id}/${action}`, profileChangeSchema, {}),
    'Done',
  );

// ── Dashboards & reports (Phase 9) ──────────────────────────────────────────
export const useHrDashboard = (enabled: boolean) =>
  useQuery({
    queryKey: ['dashboard', 'hr'],
    queryFn: ({ signal }) => api.get('/api/v1/dashboard/hr', hrDashboardSchema, { signal }),
    enabled,
    refetchInterval: 5 * 60_000,
  });

export const usePayrollDashboard = (enabled: boolean) =>
  useQuery({
    queryKey: ['dashboard', 'payroll'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/dashboard/payroll', payrollDashboardSchema, { signal }),
    enabled,
  });

export const useReportCatalog = () =>
  useQuery({
    queryKey: ['reports'],
    queryFn: ({ signal }) => api.get('/api/v1/reports', z.array(reportInfoSchema), { signal }),
  });

export const useReport = (key: string | null, params: Record<string, string>) =>
  useQuery({
    queryKey: ['reports', key, params],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/reports/${key}?${new URLSearchParams(params).toString()}`,
        reportResultSchema,
        {
          signal,
        },
      ),
    enabled: !!key,
  });
