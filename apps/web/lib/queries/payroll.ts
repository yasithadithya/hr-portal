'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  bankTemplateSchema,
  paySetupSchema,
  payComponentSchema,
  payslipDetailSchema,
  payslipSummarySchema,
  readinessSchema,
  runInputDtoSchema,
  runSchema,
  statutorySchema,
  taxTableSchema,
  type BankTemplateInput,
  type ExportKind,
  type PayComponentInput,
  type StatutoryInput,
  type TaxTableInput,
} from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { api, apiDownload } from '@/lib/api';
import { withOfflineCache } from '@/lib/offline';

function usePayrollMutation<V, R>(fn: (v: V) => Promise<R>, success?: string | ((r: R) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
      await qc.invalidateQueries({ queryKey: ['payroll'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
export const useComponents = (enabled = true) =>
  useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/payroll/components', z.array(payComponentSchema), { signal }),
    enabled,
  });

export const useSaveComponent = () =>
  usePayrollMutation(
    ({ id, ...body }: PayComponentInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/payroll/components/${id}`, payComponentSchema, body)
        : api.post('/api/v1/payroll/components', payComponentSchema, body),
    'Component saved',
  );

export const useStatutory = () =>
  useQuery({
    queryKey: ['payroll', 'statutory'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/payroll/statutory', z.array(statutorySchema), { signal }),
  });

export const useSaveStatutory = () =>
  usePayrollMutation(
    ({ id, ...body }: StatutoryInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/payroll/statutory/${id}`, statutorySchema, body)
        : api.post('/api/v1/payroll/statutory', statutorySchema, body),
    'Statutory settings saved',
  );

export const useTaxTables = () =>
  useQuery({
    queryKey: ['payroll', 'tax-tables'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/payroll/tax-tables', z.array(taxTableSchema), { signal }),
  });

export const useSaveTaxTable = () =>
  usePayrollMutation(
    ({ id, ...body }: TaxTableInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/payroll/tax-tables/${id}`, z.array(taxTableSchema), body)
        : api.post('/api/v1/payroll/tax-tables', z.array(taxTableSchema), body),
    'Tax table saved',
  );

export const useBankTemplates = () =>
  useQuery({
    queryKey: ['payroll', 'bank-templates'],
    queryFn: ({ signal }) =>
      api.get('/api/v1/payroll/bank-templates', z.array(bankTemplateSchema), { signal }),
  });

export const useSaveBankTemplate = () =>
  usePayrollMutation(
    ({ id, ...body }: BankTemplateInput & { id?: string }) =>
      id
        ? api.put(`/api/v1/payroll/bank-templates/${id}`, bankTemplateSchema, body)
        : api.post('/api/v1/payroll/bank-templates', bankTemplateSchema, body),
    'Bank template saved',
  );

// ── Employee pay setup ──────────────────────────────────────────────────────
const overviewSchema = z.array(
  z.object({
    employeeId: z.uuid(),
    employeeNo: z.string(),
    name: z.string(),
    basic: z.string().nullable(),
    taxTable: z.string().nullable(),
    hasTaxProfile: z.boolean(),
    hasBank: z.boolean(),
  }),
);

export const usePayOverview = () =>
  useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: ({ signal }) => api.get('/api/v1/payroll/employees', overviewSchema, { signal }),
  });

export const usePaySetup = (id: string) =>
  useQuery({
    queryKey: ['payroll', 'setup', id],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/payroll/employees/${id}/setup`, paySetupSchema, { signal }),
  });

type SetupAction =
  | { kind: 'salary'; body: object }
  | { kind: 'recurring'; body: object }
  | { kind: 'end-recurring'; id: string; effectiveTo: string }
  | { kind: 'tax-profile'; body: object }
  | { kind: 'bank-codes'; body: object }
  | { kind: 'loan'; body: object }
  | { kind: 'cancel-loan'; id: string };

export const useSetupAction = (employeeId: string) =>
  usePayrollMutation((a: SetupAction) => {
    const base = `/api/v1/payroll/employees/${employeeId}`;
    switch (a.kind) {
      case 'salary':
        return api.post(`${base}/salary`, paySetupSchema, a.body);
      case 'recurring':
        return api.post(`${base}/recurring`, paySetupSchema, a.body);
      case 'end-recurring':
        return api.post(`/api/v1/payroll/recurring/${a.id}/end`, paySetupSchema, {
          effectiveTo: a.effectiveTo,
        });
      case 'tax-profile':
        return api.put(`${base}/tax-profile`, paySetupSchema, a.body);
      case 'bank-codes':
        return api.put(`${base}/bank-codes`, paySetupSchema, a.body);
      case 'loan':
        return api.post(`${base}/loans`, paySetupSchema, a.body);
      case 'cancel-loan':
        return api.post(`/api/v1/payroll/loans/${a.id}/cancel`, paySetupSchema, {});
    }
  }, 'Saved');

// ── Runs ────────────────────────────────────────────────────────────────────
export const useRuns = () =>
  useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: ({ signal }) => api.get('/api/v1/payroll/runs', z.array(runSchema), { signal }),
  });

export const useRun = (id: string) =>
  useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: ({ signal }) => api.get(`/api/v1/payroll/runs/${id}`, runSchema, { signal }),
  });

export const useReadiness = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['payroll', 'run', id, 'readiness'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/payroll/runs/${id}/readiness`, readinessSchema, { signal }),
    enabled,
  });

export const useRunPayslips = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ['payroll', 'run', id, 'payslips'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/payroll/runs/${id}/payslips`, z.array(payslipSummarySchema), { signal }),
    enabled,
  });

export const useRunInputs = (id: string) =>
  useQuery({
    queryKey: ['payroll', 'run', id, 'inputs'],
    queryFn: ({ signal }) =>
      api.get(`/api/v1/payroll/runs/${id}/inputs`, z.array(runInputDtoSchema), { signal }),
  });

export const useOpenPeriod = () =>
  usePayrollMutation(
    (body: { month: string; payDate: string }) =>
      api.post('/api/v1/payroll/periods', runSchema, body),
    (r) => `Payroll for ${r.month} opened`,
  );

export const useCreateRun = () =>
  usePayrollMutation(
    (body: { periodId: string; type: 'off_cycle' | 'adjustment'; notes?: string | null }) =>
      api.post('/api/v1/payroll/runs', runSchema, body),
    'Run created',
  );

export const useRunAction = (id: string) =>
  usePayrollMutation(
    (action: 'calculate' | 'approve' | 'reopen' | 'lock' | 'paid') =>
      api.post(`/api/v1/payroll/runs/${id}/${action}`, runSchema),
    (r) => `Payroll ${r.status}`,
  );

export const useAddInput = (runId: string) =>
  usePayrollMutation(
    (body: { employeeId: string; componentId: string; amount: string; note?: string | null }) =>
      api.post(`/api/v1/payroll/runs/${runId}/inputs`, z.array(runInputDtoSchema), body),
    'Input added — recalculate to apply it',
  );

export const useDeleteInput = (runId: string) =>
  usePayrollMutation(
    (inputId: string) =>
      api.delete(`/api/v1/payroll/runs/${runId}/inputs/${inputId}`, z.array(runInputDtoSchema)),
    'Input removed',
  );

// ── Payslips ────────────────────────────────────────────────────────────────
export const usePayslip = (id: string | null) =>
  useQuery({
    queryKey: ['payroll', 'payslip', id],
    queryFn: ({ signal }) => api.get(`/api/v1/payslips/${id}`, payslipDetailSchema, { signal }),
    enabled: !!id,
  });

export const useMyPayslips = () =>
  useQuery({
    queryKey: ['payroll', 'payslips', 'mine'],
    queryFn: ({ signal }) =>
      withOfflineCache('payslips', () =>
        api.get('/api/v1/payslips', z.array(payslipSummarySchema), { signal }),
      ),
  });

export const downloadPayslip = (id: string, name: string) =>
  apiDownload(`/api/v1/payslips/${id}/pdf`, name);

export const downloadExport = (runId: string, kind: ExportKind, templateId?: string) =>
  apiDownload(
    `/api/v1/payroll/runs/${runId}/export/${kind}${templateId ? `?templateId=${templateId}` : ''}`,
    `payroll-${kind}.csv`,
  );

export const downloadT10 = (year: number) =>
  apiDownload(`/api/v1/payroll/reports/t10?year=${year}`, `t10-${year}.csv`);

/** "12,345.67" — string formatting only (money never goes through JS numbers). */
export function lkr(v: string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const neg = v.startsWith('-');
  const [i = '0', d = ''] = v.replace('-', '').split('.');
  return `${neg ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${`${d}00`.slice(0, 2)}`;
}
