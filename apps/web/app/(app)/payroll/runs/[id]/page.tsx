'use client';

import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  Info,
  Lock,
  Trash2,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { ExportKind, PayrollRun } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { selectClass } from '@/components/employees/fields';
import {
  PayrollTabs,
  runLabel,
  RunStatusBadge,
  SampleDataBanner,
} from '@/components/payroll/payroll-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { useEmployeeOptions } from '@/lib/queries/admin';
import { useSettings } from '@/lib/queries/org';
import {
  downloadExport,
  downloadPayslip,
  lkr,
  useAddInput,
  useBankTemplates,
  useComponents,
  useDeleteInput,
  usePayslip,
  useReadiness,
  useRun,
  useRunAction,
  useRunInputs,
  useRunPayslips,
} from '@/lib/queries/payroll';

const STEPS: PayrollRun['status'][] = ['draft', 'calculated', 'approved', 'locked', 'paid'];
const STEP_LABEL: Record<PayrollRun['status'], string> = {
  draft: 'Prepare',
  calculated: 'Calculated',
  approved: 'Approved',
  locked: 'Locked',
  paid: 'Paid',
};

function Steps({ status }: { status: PayrollRun['status'] }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Payroll progress">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? 'step' : undefined}
          className={`rounded-full px-3 py-1 ${
            i < at
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : i === at
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          {i + 1}. {STEP_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

function ReadinessPanel({ runId }: { runId: string }) {
  const r = useReadiness(runId, true);
  if (!r.data) return <Skeleton className="h-24" />;
  if (!r.data.issues.length)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="size-4" /> Everything looks ready.
      </p>
    );
  return (
    <ul className="space-y-2" data-testid="readiness">
      {r.data.issues.map((i) => (
        <li key={i.code} className="flex gap-2 text-sm">
          {i.level === 'error' ? (
            <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          ) : i.level === 'warning' ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          ) : (
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {i.message}
            {i.employees.length > 0 && (
              <span className="text-muted-foreground">
                {' '}
                —{' '}
                {i.employees
                  .slice(0, 6)
                  .map((e) => e.name)
                  .join(', ')}
                {i.employees.length > 6 && ` +${i.employees.length - 6} more`}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function InputsCard({ runId, editable }: { runId: string; editable: boolean }) {
  const inputs = useRunInputs(runId);
  const comps = useComponents();
  const people = useEmployeeOptions(editable);
  const add = useAddInput(runId);
  const del = useDeleteInput(runId);
  const [f, setF] = useState({ employeeId: '', componentId: '', amount: '', note: '' });
  const choices = (comps.data ?? []).filter(
    (c) => c.isActive && !c.isSystem && (c.kind === 'earning' || c.kind === 'deduction'),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">One-off items</CardTitle>
        <CardDescription>
          Bonus, arrears, commissions or ad-hoc deductions for this run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {inputs.data?.map((i) => (
          <div
            key={i.id}
            className="flex items-center gap-3 text-sm"
            data-testid={`input-${i.employeeNo}-${i.code}`}
          >
            <span className="w-24 font-mono text-xs">{i.employeeNo}</span>
            <span className="flex-1">
              {i.employeeName} · {i.name}
              {i.note && <span className="text-muted-foreground"> — {i.note}</span>}
            </span>
            <span className={i.kind === 'deduction' ? 'text-red-600' : ''}>
              {i.kind === 'deduction' ? '−' : '+'}
              {lkr(i.amount)}
            </span>
            {editable && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove item"
                onClick={() => del.mutate(i.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {inputs.data?.length === 0 && <p className="text-muted-foreground text-sm">None.</p>}
        {editable && (
          <form
            className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr_8rem_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate(
                { ...f, note: f.note || null },
                { onSuccess: () => setF({ ...f, amount: '', note: '' }) },
              );
            }}
          >
            <select
              aria-label="Employee"
              required
              className={selectClass}
              value={f.employeeId}
              onChange={(e) => setF({ ...f, employeeId: e.target.value })}
            >
              <option value="">Employee…</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employeeNo} · {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Item"
              required
              className={selectClass}
              value={f.componentId}
              onChange={(e) => setF({ ...f, componentId: e.target.value })}
            >
              <option value="">Item…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind})
                </option>
              ))}
            </select>
            <Input
              aria-label="Amount"
              required
              inputMode="decimal"
              placeholder="Amount"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
            <Input
              aria-label="Note"
              placeholder="Note (optional)"
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
            <Button type="submit" disabled={add.isPending}>
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PayslipSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const p = usePayslip(id);
  const d = p.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{d ? `${d.employeeName} · ${d.month}` : 'Payslip'}</SheetTitle>
        </SheetHeader>
        {p.error && <ErrorAlert error={p.error} />}
        {!d ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-6 p-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Gross</div>
                <div className="font-semibold">{lkr(d.gross)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Deductions</div>
                <div className="font-semibold">{lkr(d.deductions)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Net</div>
                <div className="font-semibold" data-testid="payslip-net">
                  {lkr(d.net)}
                </div>
              </div>
            </div>
            <Table>
              <TableBody>
                {d.lines.map((l, i) => (
                  <TableRow key={`${l.code}-${i}`}>
                    <TableCell>
                      {l.name}
                      {l.quantity && l.rate && (
                        <span className="text-muted-foreground text-xs">
                          {' '}
                          ({l.quantity} × {lkr(l.rate)})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {l.kind.replace('_', ' ')}
                    </TableCell>
                    <TableCell
                      className={`text-right ${l.kind === 'deduction' ? 'text-red-600' : ''}`}
                    >
                      {lkr(l.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {d.warnings.length > 0 && (
              <ul className="space-y-1 text-sm text-amber-700">
                {d.warnings.map((w, i) => (
                  <li key={i}>⚠ {w.message}</li>
                ))}
              </ul>
            )}
            {d.trace && (
              <div>
                <h3 className="mb-2 font-semibold">Why is this number?</h3>
                <ol className="space-y-3 text-sm">
                  {d.trace.map((t, i) => (
                    <li key={i} className="border-l-2 pl-3">
                      <div className="flex justify-between gap-2">
                        <span>{t.description}</span>
                        <span className="font-mono">{lkr(t.output)}</span>
                      </div>
                      {t.formula && (
                        <div className="text-muted-foreground font-mono text-xs">{t.formula}</div>
                      )}
                      {t.inputs && Object.keys(t.inputs).length > 0 && (
                        <div className="text-muted-foreground text-xs">
                          {Object.entries(t.inputs)
                            .map(([k, v]) => `${k} = ${v}`)
                            .join(' · ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() =>
                downloadPayslip(d.id, `payslip-${d.month}-${d.employeeNo}.pdf`).catch((e) =>
                  toast.error(errorMessage(e)),
                )
              }
            >
              <Download /> Payslip PDF
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Exports({ run }: { run: PayrollRun }) {
  const templates = useBankTemplates();
  const [templateId, setTemplateId] = useState('');
  const dl = (kind: ExportKind, t?: string) =>
    downloadExport(run.id, kind, t).catch((e) => toast.error(errorMessage(e)));
  const statutory = ['approved', 'locked', 'paid'].includes(run.status);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reports & files</CardTitle>
        <CardDescription>
          Layouts are samples until confirmed with the client’s accountant and bank.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => dl('register')}>
          <Download /> Payroll register
        </Button>
        {(['epf', 'etf', 'apit', 'gl'] as const).map((k) => (
          <Button key={k} variant="outline" size="sm" disabled={!statutory} onClick={() => dl(k)}>
            <Download /> {k === 'gl' ? 'GL journal' : `${k.toUpperCase()} schedule`}
          </Button>
        ))}
        <span className="flex items-center gap-2">
          <select
            aria-label="Bank file template"
            className={`${selectClass} h-8 w-56 text-xs`}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Bank template…</option>
            {templates.data
              ?.filter((t) => t.isActive)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={!statutory || !templateId}
            onClick={() => dl('bank', templateId)}
          >
            <Download /> Bank file
          </Button>
        </span>
        {!statutory && (
          <p className="text-muted-foreground w-full text-xs">
            Statutory, bank and GL files are available once the payroll is approved.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const run = useRun(id);
  const { can, me } = useAuth();
  const action = useRunAction(id);
  const r = run.data;
  const hasResults = !!r && r.status !== 'draft';
  const slips = useRunPayslips(id, hasResults);
  const settings = useSettings();
  const threshold = Number(settings.data?.['payroll.variance_threshold_percent'] ?? 10);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const editable = !!r && (r.status === 'draft' || r.status === 'calculated');
  const rows = useMemo(
    () =>
      (slips.data ?? []).filter(
        (s) =>
          filter === 'all' ||
          s.warnings.length > 0 ||
          (s.variancePercent !== null && Math.abs(s.variancePercent) > threshold),
      ),
    [slips.data, filter, threshold],
  );
  const selfApproval = !!settings.data?.['payroll.allow_self_approval'];
  const preparedByMe = !!r?.calculatedBy && r.calculatedBy === me?.user.id;

  return (
    <RequirePermission permission="payroll.read" scope="all">
      {run.error && <ErrorAlert error={run.error} />}
      {!r ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <PageHeader
            title={`Payroll · ${runLabel(r)}`}
            description={`Pay date ${r.payDate}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <RunStatusBadge status={r.status} />
                {editable && can('payroll.run', 'all') && (
                  <Button disabled={action.isPending} onClick={() => action.mutate('calculate')}>
                    <Calculator /> {r.status === 'draft' ? 'Calculate' : 'Recalculate'}
                  </Button>
                )}
                {r.status === 'calculated' && can('payroll.approve', 'all') && (
                  <Button
                    disabled={action.isPending || (preparedByMe && !selfApproval)}
                    title={
                      preparedByMe && !selfApproval
                        ? 'Someone else must approve a payroll you calculated'
                        : undefined
                    }
                    onClick={() => action.mutate('approve')}
                  >
                    <CheckCircle2 /> Approve
                  </Button>
                )}
                {r.status === 'approved' && can('payroll.approve', 'all') && (
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => action.mutate('reopen')}
                  >
                    <Undo2 /> Send back
                  </Button>
                )}
                {r.status === 'approved' && can('payroll.lock', 'all') && (
                  <Button disabled={action.isPending} onClick={() => action.mutate('lock')}>
                    <Lock /> Lock
                  </Button>
                )}
                {r.status === 'locked' && can('payroll.lock', 'all') && (
                  <Button disabled={action.isPending} onClick={() => action.mutate('paid')}>
                    <Wallet /> Mark paid
                  </Button>
                )}
              </div>
            }
          />
          <PayrollTabs />
          <Steps status={r.status} />
          {r.configNeedsReview && <SampleDataBanner className="mb-4" />}
          {r.status === 'calculated' && preparedByMe && !selfApproval && (
            <p className="text-muted-foreground mb-4 text-sm">
              You calculated this payroll, so a different person with approval rights must approve
              it.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {editable && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Before you calculate</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReadinessPanel runId={id} />
                </CardContent>
              </Card>
            )}
            <InputsCard runId={id} editable={editable && can('payroll.run', 'all')} />
          </div>

          {r.totals && (
            <div className="my-6 grid gap-3 sm:grid-cols-4" data-testid="run-totals">
              {[
                ['Employees', String(r.totals.employees)],
                ['Gross', lkr(r.totals.gross)],
                ['Net pay', lkr(r.totals.net)],
                ['Employer cost', lkr(r.totals.employerCost)],
              ].map(([k, v]) => (
                <Card key={k}>
                  <CardContent className="pt-4">
                    <div className="text-muted-foreground text-sm">{k}</div>
                    <div className="text-xl font-semibold">{v}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {hasResults && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Review</h2>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={filter === 'all' ? 'default' : 'outline'}
                    onClick={() => setFilter('all')}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === 'flagged' ? 'default' : 'outline'}
                    onClick={() => setFilter('flagged')}
                  >
                    Changed &gt;{threshold}% or warnings
                  </Button>
                </div>
              </div>
              {slips.error && <ErrorAlert error={slips.error} />}
              {!slips.data ? (
                <Skeleton className="h-48" />
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">vs last month</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((s) => {
                        const big =
                          s.variancePercent !== null && Math.abs(s.variancePercent) > threshold;
                        return (
                          <TableRow
                            key={s.id}
                            className="cursor-pointer"
                            onClick={() => setOpen(s.id)}
                            data-testid={`slip-${s.employeeNo}`}
                          >
                            <TableCell>
                              <div className="font-medium">{s.employeeName}</div>
                              <div className="text-muted-foreground text-xs">
                                {s.employeeNo}
                                {s.department && ` · ${s.department}`}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{lkr(s.gross)}</TableCell>
                            <TableCell className="text-right">{lkr(s.deductions)}</TableCell>
                            <TableCell className="text-right font-medium">{lkr(s.net)}</TableCell>
                            <TableCell
                              className={`text-right ${big ? 'font-semibold text-amber-600' : 'text-muted-foreground'}`}
                            >
                              {s.variancePercent === null
                                ? 'new'
                                : `${s.variancePercent > 0 ? '+' : ''}${s.variancePercent}%`}
                            </TableCell>
                            <TableCell>
                              {s.warnings.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500 text-amber-600"
                                >
                                  {s.warnings.length} warning{s.warnings.length > 1 ? 's' : ''}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <Exports run={r} />
            </div>
          )}
          <PayslipSheet id={open} onClose={() => setOpen(null)} />
        </>
      )}
    </RequirePermission>
  );
}
