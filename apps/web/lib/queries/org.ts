'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  branchSchema,
  companyProfileDtoSchema,
  costCenterSchema,
  departmentSchema,
  designationSchema,
  gradeSchema,
  holidayImportResultSchema,
  holidaySchema,
  numberSequenceSchema,
  settingsMapSchema,
  workCalendarSchema,
  type CompanyProfileInput,
  type HolidayInput,
  type NumberSequenceUpdate,
  type SettingKey,
  type WorkCalendarInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api, ApiError } from '@/lib/api';

function useWrite<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string; invalidate: unknown[][] },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      if (opts.success) toast.success(opts.success);
      await Promise.all(opts.invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ── Company & settings ───────────────────────────────────────────────────────
export const useCompany = () =>
  useQuery({
    queryKey: ['company'],
    queryFn: ({ signal }) => api.get('/api/v1/company', companyProfileDtoSchema, { signal }),
  });

export const useSaveCompany = () =>
  useWrite(
    (input: CompanyProfileInput) => api.put('/api/v1/company', companyProfileDtoSchema, input),
    {
      success: 'Company details saved',
      invalidate: [['company'], ['public-tenant']],
    },
  );

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) =>
      api.put('/api/v1/company/logo', companyProfileDtoSchema, file, {
        headers: { 'content-type': file.type },
      }),
    onSuccess: async () => {
      toast.success('Logo updated');
      await qc.invalidateQueries({ queryKey: ['company'] });
      await qc.invalidateQueries({ queryKey: ['public-tenant'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => api.get('/api/v1/settings', settingsMapSchema, { signal }),
  });

export const useSaveSetting = () =>
  useWrite(
    ({ key, value }: { key: SettingKey; value: unknown }) =>
      api.put(`/api/v1/settings/${key}`, settingsMapSchema, { value }),
    { success: 'Setting saved', invalidate: [['settings'], ['public-tenant']] },
  );

export const useSequences = () =>
  useQuery({
    queryKey: ['number-sequences'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/number-sequences', z.array(numberSequenceSchema), { signal }),
  });

export const useSaveSequence = () =>
  useWrite(
    ({ key, ...input }: NumberSequenceUpdate & { key: string }) =>
      api.put(`/api/v1/number-sequences/${key}`, numberSequenceSchema, input),
    { success: 'Numbering saved', invalidate: [['number-sequences']] },
  );

// ── Calendars & holidays ─────────────────────────────────────────────────────
export const useCalendars = () =>
  useQuery({
    queryKey: ['work-calendars'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/work-calendars', z.array(workCalendarSchema), { signal }),
  });

export const useSaveCalendar = () =>
  useWrite(
    ({ id, ...input }: WorkCalendarInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/work-calendars/${id}`, z.array(workCalendarSchema), input)
        : api.post('/api/v1/work-calendars', z.array(workCalendarSchema), input),
    { success: 'Calendar saved', invalidate: [['work-calendars']] },
  );

export const useDeleteCalendar = () =>
  useWrite(
    (id: string) => api.delete(`/api/v1/work-calendars/${id}`, z.array(workCalendarSchema)),
    {
      success: 'Calendar deleted',
      invalidate: [['work-calendars']],
    },
  );

export const useHolidays = (calendarId: string | undefined, year: number) =>
  useQuery({
    queryKey: ['holidays', calendarId, year],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/work-calendars/${calendarId}/holidays?year=${year}`,
        z.array(holidaySchema),
        {
          signal,
        },
      ),
    enabled: !!calendarId,
  });

export const useSaveHoliday = (calendarId: string) =>
  useWrite(
    ({ id, ...input }: HolidayInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/holidays/${id}`, holidaySchema, input)
        : api.post(`/api/v1/work-calendars/${calendarId}/holidays`, holidaySchema, input),
    { success: 'Holiday saved', invalidate: [['holidays'], ['work-calendars']] },
  );

export const useDeleteHoliday = () =>
  useWrite((id: string) => api.delete(`/api/v1/holidays/${id}`, z.object({ id: z.string() })), {
    success: 'Holiday removed',
    invalidate: [['holidays'], ['work-calendars']],
  });

export function useImportHolidays(calendarId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { csv: string; dryRun: boolean }) =>
      api.post(
        `/api/v1/work-calendars/${calendarId}/holidays/import`,
        holidayImportResultSchema,
        input,
      ),
    onSuccess: async (res, vars) => {
      if (!vars.dryRun) {
        toast.success(`Imported ${res.imported} holiday(s)`);
        await qc.invalidateQueries({ queryKey: ['holidays'] });
        await qc.invalidateQueries({ queryKey: ['work-calendars'] });
      }
    },
    onError: (err) => {
      if (!(err instanceof ApiError && err.code === 'VALIDATION_ERROR'))
        toast.error(errorMessage(err));
    },
  });
}

export const useCopyHolidays = (calendarId: string) =>
  useWrite(
    (input: { fromYear: number; toYear: number }) =>
      api.post(
        `/api/v1/work-calendars/${calendarId}/holidays/copy`,
        z.object({ copied: z.number() }),
        input,
      ),
    {
      success: 'Holidays copied — verify the dates',
      invalidate: [['holidays'], ['work-calendars']],
    },
  );

// ── Reference data ───────────────────────────────────────────────────────────
export const REF_SCHEMAS = {
  branches: branchSchema,
  departments: departmentSchema,
  grades: gradeSchema,
  designations: designationSchema,
  'cost-centers': costCenterSchema,
} as const;
export type RefPath = keyof typeof REF_SCHEMAS;
export type RefRow<P extends RefPath> = z.infer<(typeof REF_SCHEMAS)[P]>;

export function useRefList<P extends RefPath>(path: P, includeArchived = false) {
  return useQuery({
    queryKey: ['ref', path, includeArchived],
    queryFn: ({ signal }) =>
      api.get(
        `/api/v1/${path}${includeArchived ? '?includeArchived=true' : ''}`,
        z.array(REF_SCHEMAS[path]) as z.ZodType<RefRow<P>[]>,
        { signal },
      ),
  });
}

export function useSaveRef(path: RefPath) {
  return useWrite(
    ({ id, ...input }: Record<string, unknown> & { id?: string }) =>
      id
        ? api.put(`/api/v1/${path}/${id}`, REF_SCHEMAS[path], input)
        : api.post(`/api/v1/${path}`, REF_SCHEMAS[path], input),
    { success: 'Saved', invalidate: [['ref', path]] },
  );
}

export function useArchiveRef(path: RefPath) {
  return useWrite(
    ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch(`/api/v1/${path}/${id}/archive`, REF_SCHEMAS[path], { archived }),
    { invalidate: [['ref', path]] },
  );
}
