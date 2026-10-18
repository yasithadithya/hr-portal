'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  contactSchema,
  documentSchema,
  employeeDetailSchema,
  employeePageSchema,
  expiringDocumentSchema,
  importPreviewSchema,
  importReportSchema,
  importTemplateSchema,
  jobHistoryItemSchema,
  orgChartNodeSchema,
  upcomingEventSchema,
  type BankStatutoryInput,
  type ContactInput,
  type EmployeeListQuery,
  type HireInput,
  type ImportKind,
  type ImportRequest,
  type JobChangeInput,
  type PersonalInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api, apiDownload } from '@/lib/api';

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export const useEmployees = (q: EmployeeListQuery) =>
  useQuery({
    queryKey: ['employees', 'list', q],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees?${qs(q as Record<string, string>)}`, employeePageSchema, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export function exportEmployees(q: EmployeeListQuery) {
  return apiDownload(
    `/api/v1/employees/export.csv?${qs(q as Record<string, string>)}`,
    'employees.csv',
  );
}

export const useEmployee = (id: string) =>
  useQuery({
    queryKey: ['employees', id],
    queryFn: ({ signal }) => api.get(`/api/v1/employees/${id}`, employeeDetailSchema, { signal }),
  });

export const useJobHistory = (id: string) =>
  useQuery({
    queryKey: ['employees', id, 'job-history'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees/${id}/job-history`, z.array(jobHistoryItemSchema), { signal }),
  });

export const useContacts = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['employees', id, 'contacts'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees/${id}/contacts`, z.array(contactSchema), { signal }),
    enabled,
  });

export const useDocuments = (id: string, enabled = true) =>
  useQuery({
    queryKey: ['employees', id, 'documents'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees/${id}/documents`, z.array(documentSchema), { signal }),
    enabled,
  });

export const useOrgChart = () =>
  useQuery({
    queryKey: ['org-chart'],
    queryFn: ({ signal }) => api.get('/api/v1/org-chart', z.array(orgChartNodeSchema), { signal }),
  });

export const useUpcoming = (days = 30) =>
  useQuery({
    queryKey: ['employees', 'upcoming', days],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees/upcoming?days=${days}`, z.array(upcomingEventSchema), { signal }),
  });

export const useExpiringDocuments = (enabled: boolean) =>
  useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/documents/expiring', z.array(expiringDocumentSchema), { signal }),
    enabled,
  });

function useEmployeeMutation<V, R = unknown>(fn: (v: V) => Promise<R>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(success);
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await qc.invalidateQueries({ queryKey: ['org-chart'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export const useHire = () =>
  useEmployeeMutation(
    (input: HireInput) => api.post('/api/v1/employees', employeeDetailSchema, input),
    'Employee added',
  );

export const useEmployeeAction = (id: string) =>
  useEmployeeMutation(
    ({ action, body }: { action: 'job-change' | 'confirm' | 'notice' | 'exit'; body: unknown }) =>
      api.post(`/api/v1/employees/${id}/${action}`, employeeDetailSchema, body),
    'Saved',
  );

export const useUpdatePersonal = (id: string) =>
  useEmployeeMutation(
    (input: PersonalInput) =>
      api.put(`/api/v1/employees/${id}/personal`, employeeDetailSchema, input),
    'Personal details saved',
  );

export const useUpdateBank = (id: string) =>
  useEmployeeMutation(
    (input: BankStatutoryInput) =>
      api.put(`/api/v1/employees/${id}/bank`, employeeDetailSchema, input),
    'Bank & statutory details saved',
  );

export const useJobChange = (id: string) =>
  useEmployeeMutation(
    (input: JobChangeInput) =>
      api.post(`/api/v1/employees/${id}/job-change`, employeeDetailSchema, input),
    'Job change saved',
  );

export const useAddContact = (id: string) =>
  useEmployeeMutation(
    (input: ContactInput) =>
      api.post(`/api/v1/employees/${id}/contacts`, z.object({ id: z.string() }), input),
    'Contact added',
  );

export const useDeleteContact = (id: string) =>
  useEmployeeMutation(
    (contactId: string) =>
      api.delete(`/api/v1/employees/${id}/contacts/${contactId}`, z.object({ id: z.string() })),
    'Contact removed',
  );

export const useUploadDocument = (id: string) =>
  useEmployeeMutation(
    ({
      file,
      category,
      title,
      expiryDate,
    }: {
      file: File;
      category: string;
      title: string;
      expiryDate?: string;
    }) =>
      api.post(
        `/api/v1/employees/${id}/documents?${qs({ category, title, expiryDate })}`,
        documentSchema,
        file,
        {
          headers: { 'content-type': file.type },
        },
      ),
    'Document uploaded',
  );

export const useDeleteDocument = (id: string) =>
  useEmployeeMutation(
    (docId: string) =>
      api.delete(`/api/v1/employees/${id}/documents/${docId}`, z.object({ id: z.string() })),
    'Document deleted',
  );

export async function openDocument(employeeId: string, docId: string) {
  const { url } = await api.get(
    `/api/v1/employees/${employeeId}/documents/${docId}/url`,
    z.object({ url: z.string(), expiresIn: z.number() }),
  );
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const useUploadPhoto = (id: string) =>
  useEmployeeMutation(
    (file: File) =>
      api.put(`/api/v1/employees/${id}/photo`, z.object({ id: z.string() }), file, {
        headers: { 'content-type': file.type },
      }),
    'Photo updated',
  );

export const usePhoto = (id: string, hasPhoto: boolean) =>
  useQuery({
    queryKey: ['employees', id, 'photo'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/employees/${id}/photo`, z.object({ url: z.string() }), { signal }),
    enabled: hasPhoto,
    staleTime: 4 * 60_000,
  });

// ── Imports ──────────────────────────────────────────────────────────────────
export const useImportTemplate = (kind: ImportKind) =>
  useQuery({
    queryKey: ['imports', kind, 'template'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/imports/${kind}/template`, importTemplateSchema, { signal }),
  });

export const usePreviewImport = (kind: ImportKind) =>
  useMutation({
    mutationFn: (body: ImportRequest) =>
      api.post(`/api/v1/imports/${kind}/preview`, importPreviewSchema, body),
    onError: (err) => toast.error(errorMessage(err)),
  });

export function useCommitImport(kind: ImportKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportRequest & { skipInvalid: boolean }) =>
      api.post(`/api/v1/imports/${kind}/commit`, importReportSchema, body),
    onSuccess: async (r) => {
      toast.success(`Imported ${r.imported} row(s)`);
      // Invalidate whatever the import feeds.
      const area = kind.startsWith('attendance')
        ? 'attendance'
        : kind.startsWith('leave')
          ? 'leave'
          : 'employees';
      await qc.invalidateQueries({ queryKey: [area] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
