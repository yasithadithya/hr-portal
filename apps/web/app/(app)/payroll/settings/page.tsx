'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import {
  bankTemplateInputSchema,
  type BankTemplate,
  type PayComponent,
  type PayComponentInput,
  type Statutory,
  type TaxTableDto,
} from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { PayrollTabs, SampleDataBanner } from '@/components/payroll/payroll-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { useSaveSetting, useSettings } from '@/lib/queries/org';
import {
  useBankTemplates,
  useComponents,
  useSaveBankTemplate,
  useSaveComponent,
  useSaveStatutory,
  useSaveTaxTable,
  useStatutory,
  useTaxTables,
} from '@/lib/queries/payroll';

const ReviewBadge = ({ show }: { show: boolean }) =>
  show ? (
    <Badge variant="outline" className="ml-2 border-amber-500 text-amber-600">
      sample — review
    </Badge>
  ) : null;

// ── General ─────────────────────────────────────────────────────────────────
function General() {
  const settings = useSettings();
  const save = useSaveSetting();
  const s = settings.data;
  const [threshold, setThreshold] = useState<string | null>(null);
  if (!s) return <Skeleton className="h-48" />;
  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Use only locked attendance months</span>
            <span className="text-muted-foreground text-sm">
              OT and absences come from attendance after the month is locked.
            </span>
          </span>
          <Switch
            aria-label="Use only locked attendance"
            checked={s['payroll.require_locked_attendance']}
            onCheckedChange={(v) =>
              save.mutate({ key: 'payroll.require_locked_attendance', value: v })
            }
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Allow the preparer to approve</span>
            <span className="text-muted-foreground text-sm">
              Only for very small teams. Normally a second person approves.
            </span>
          </span>
          <Switch
            aria-label="Allow self approval"
            checked={s['payroll.allow_self_approval']}
            onCheckedChange={(v) => save.mutate({ key: 'payroll.allow_self_approval', value: v })}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Payslip PDF password</span>
            <span className="text-muted-foreground text-sm">
              Employees open the PDF with their NIC or date of birth (YYYYMMDD).
            </span>
          </span>
          <select
            aria-label="Payslip password"
            className={`${selectClass} w-40`}
            value={s['payroll.payslip_password']}
            onChange={(e) =>
              save.mutate({ key: 'payroll.payslip_password', value: e.target.value })
            }
          >
            <option value="none">No password</option>
            <option value="nic">NIC</option>
            <option value="dob">Date of birth</option>
          </select>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <span>
            <span className="block font-medium">Highlight net-pay changes above (%)</span>
          </span>
          <span className="flex gap-2">
            <Input
              aria-label="Variance threshold"
              type="number"
              className="w-24"
              value={threshold ?? String(s['payroll.variance_threshold_percent'])}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <Button
              size="sm"
              disabled={threshold === null}
              onClick={() =>
                save.mutate(
                  { key: 'payroll.variance_threshold_percent', value: Number(threshold) },
                  { onSuccess: () => setThreshold(null) },
                )
              }
            >
              Save
            </Button>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Components ──────────────────────────────────────────────────────────────
const EMPTY_COMPONENT: PayComponentInput = {
  code: '',
  name: '',
  kind: 'earning',
  calc: 'fixed',
  formula: null,
  isEpfApplicable: false,
  isEtfApplicable: false,
  isApitApplicable: true,
  isProrated: true,
  showOnPayslip: true,
  glCode: null,
  sortOrder: 50,
  isActive: true,
};

function ComponentDialog({
  value,
  onClose,
}: {
  value: (PayComponentInput & { id?: string; isSystem?: boolean }) | null;
  onClose: () => void;
}) {
  const save = useSaveComponent();
  const [f, setF] = useState(value ?? EMPTY_COMPONENT);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setF(value ?? EMPTY_COMPONENT);
  }
  const sys = !!value?.isSystem;
  const flag = (k: keyof PayComponentInput, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={!!f[k]} onCheckedChange={(v) => setF({ ...f, [k]: !!v })} />
      {label}
    </label>
  );
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{value?.id ? `Edit ${value.code}` : 'New pay component'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { isSystem, ...body } = f as typeof f & { isSystem?: boolean };
            void isSystem;
            save.mutate(
              {
                ...body,
                calc: (sys ? 'fixed' : body.calc) as 'fixed',
                formula: body.calc === 'formula' ? body.formula : null,
              },
              { onSuccess: onClose },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="pc-code" label="Code">
              <Input
                id="pc-code"
                required
                disabled={!!value?.id}
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
              />
            </FormField>
            <FormField id="pc-name" label="Name">
              <Input
                id="pc-name"
                required
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </FormField>
            <FormField id="pc-kind" label="Kind">
              <select
                id="pc-kind"
                disabled={sys}
                className={selectClass}
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value as 'earning' })}
              >
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
                <option value="employer_contribution">Employer contribution</option>
                <option value="info">Information only</option>
              </select>
            </FormField>
            <FormField id="pc-calc" label="Amount">
              <select
                id="pc-calc"
                disabled={sys}
                className={selectClass}
                value={sys ? 'system' : f.calc}
                onChange={(e) => setF({ ...f, calc: e.target.value as 'fixed' })}
              >
                {sys && <option value="system">Calculated by the system</option>}
                <option value="fixed">Fixed (recurring amount)</option>
                <option value="variable">Variable (entered per run)</option>
                <option value="formula">Formula</option>
              </select>
            </FormField>
          </div>
          {f.calc === 'formula' && !sys && (
            <FormField id="pc-formula" label="Formula">
              <Input
                id="pc-formula"
                required
                placeholder="max(0, 2000 - NOPAY_DAYS * 500)"
                value={f.formula ?? ''}
                onChange={(e) => setF({ ...f, formula: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                Use BASIC, BASIC_EARNED, WORKING_DAYS, EMPLOYED_DAYS, NOPAY_DAYS, PAID_DAYS,
                OT_NORMAL_HOURS, OT_HOLIDAY_HOURS, + − × ÷, min(), max().
              </p>
            </FormField>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {flag('isEpfApplicable', 'Counts for EPF')}
            {flag('isEtfApplicable', 'Counts for ETF')}
            {flag('isApitApplicable', 'Counts for APIT')}
            {flag('isProrated', 'Prorate for part months')}
            {flag('showOnPayslip', 'Show on payslip')}
            {!sys && flag('isActive', 'Active')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="pc-gl" label="GL code">
              <Input
                id="pc-gl"
                value={f.glCode ?? ''}
                onChange={(e) => setF({ ...f, glCode: e.target.value || null })}
              />
            </FormField>
            <FormField id="pc-sort" label="Order">
              <Input
                id="pc-sort"
                type="number"
                value={f.sortOrder}
                onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save component
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Components({ canEdit }: { canEdit: boolean }) {
  const comps = useComponents();
  const [edit, setEdit] = useState<
    (PayComponentInput & { id?: string; isSystem?: boolean }) | null
  >(null);
  const yes = (b: boolean) => (b ? '✓' : '');
  const open = (c: PayComponent) => setEdit({ ...c, calc: c.calc === 'system' ? 'fixed' : c.calc });
  return (
    <div className="space-y-3">
      {canEdit && (
        <Button size="sm" onClick={() => setEdit({ ...EMPTY_COMPONENT })}>
          <Plus /> New component
        </Button>
      )}
      {!comps.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>EPF</TableHead>
                <TableHead>ETF</TableHead>
                <TableHead>APIT</TableHead>
                <TableHead>Prorated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {comps.data.map((c) => (
                <TableRow
                  key={c.id}
                  className={c.isActive ? '' : 'opacity-50'}
                  data-testid={`component-${c.code}`}
                >
                  <TableCell>
                    <span className="font-medium">{c.name}</span>{' '}
                    <span className="text-muted-foreground font-mono text-xs">{c.code}</span>
                    <ReviewBadge show={c.needsReview} />
                  </TableCell>
                  <TableCell className="capitalize">{c.kind.replace('_', ' ')}</TableCell>
                  <TableCell>
                    {c.calc === 'formula' ? <code className="text-xs">{c.formula}</code> : c.calc}
                  </TableCell>
                  <TableCell>{yes(c.isEpfApplicable)}</TableCell>
                  <TableCell>{yes(c.isEtfApplicable)}</TableCell>
                  <TableCell>{yes(c.isApitApplicable)}</TableCell>
                  <TableCell>{yes(c.isProrated)}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => open(c)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ComponentDialog value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

// ── Statutory ───────────────────────────────────────────────────────────────
type StatForm = Omit<Statutory, 'id' | 'needsReview'> & { id?: string };

function StatutoryTab({ canEdit }: { canEdit: boolean }) {
  const rows = useStatutory();
  const save = useSaveStatutory();
  const [f, setF] = useState<StatForm | null>(null);
  const field = (k: keyof StatForm, label: string, hint?: string) => (
    <FormField id={`st-${k}`} label={label}>
      <Input
        id={`st-${k}`}
        value={String(f?.[k] ?? '')}
        onChange={(e) => setF({ ...f!, [k]: e.target.value })}
      />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </FormField>
  );
  return (
    <div className="space-y-4">
      {!rows.data ? (
        <Skeleton className="h-48" />
      ) : (
        rows.data.map((s) => (
          <Card key={s.id} data-testid={`statutory-${s.effectiveFrom}`}>
            <CardHeader>
              <CardTitle className="text-base">
                From {s.effectiveFrom}
                <ReviewBadge show={s.needsReview} />
              </CardTitle>
              {s.notes && <CardDescription>{s.notes}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
              <span>EPF employee {s.epfEmployeeRate}%</span>
              <span>EPF employer {s.epfEmployerRate}%</span>
              <span>ETF {s.etfRate}%</span>
              <span>
                OT: {s.otRateBase === 'basic' ? 'basic' : 'basic + EPF allowances'} ÷ {s.otDivisor}
              </span>
              <span>
                × {s.otMultiplierNormal} normal, × {s.otMultiplierHoliday} holiday
              </span>
              <span>Rest-day OT at {s.restDayOtAsHoliday ? 'holiday' : 'normal'} rate</span>
              <span>
                No-pay ÷ {s.nopayDivisorMode === 'fixed' ? s.nopayFixedDivisor : 'working days'}
              </span>
              <span>
                Rounding {s.roundingMode.replace('_', ' ')} to {s.roundingScale} dp
              </span>
              {canEdit && (
                <span className="flex gap-2 sm:col-span-3">
                  <Button size="sm" variant="outline" onClick={() => setF({ ...s })}>
                    Edit / confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setF({
                        ...s,
                        id: undefined,
                        effectiveFrom: new Date().toISOString().slice(0, 10),
                      })
                    }
                  >
                    New version from a date
                  </Button>
                </span>
              )}
            </CardContent>
          </Card>
        ))
      )}
      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {f?.id ? 'Edit statutory settings' : 'New statutory settings'}
            </DialogTitle>
          </DialogHeader>
          {f && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const { id, ...body } = f;
                save.mutate({ ...body, ...(id ? { id } : {}) }, { onSuccess: () => setF(null) });
              }}
            >
              <p className="text-muted-foreground text-sm">
                Settings used by a locked payroll cannot be edited — add a new version instead.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="st-from" label="Effective from">
                  <Input
                    id="st-from"
                    type="date"
                    disabled={!!f.id}
                    value={f.effectiveFrom}
                    onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
                  />
                </FormField>
                {field('epfEmployeeRate', 'EPF employee %')}
                {field('epfEmployerRate', 'EPF employer %')}
                {field('etfRate', 'ETF %')}
                {field('otDivisor', 'OT divisor', 'Hourly rate = base ÷ this')}
                {field('otMultiplierNormal', 'OT × normal')}
                {field('otMultiplierHoliday', 'OT × holiday')}
                <FormField id="st-otbase" label="OT base">
                  <select
                    id="st-otbase"
                    className={selectClass}
                    value={f.otRateBase}
                    onChange={(e) => setF({ ...f, otRateBase: e.target.value as 'basic' })}
                  >
                    <option value="basic">Basic</option>
                    <option value="basic_plus_epf_components">Basic + EPF allowances</option>
                  </select>
                </FormField>
                <FormField id="st-npbase" label="No-pay base">
                  <select
                    id="st-npbase"
                    className={selectClass}
                    value={f.nopayBase}
                    onChange={(e) => setF({ ...f, nopayBase: e.target.value as 'basic' })}
                  >
                    <option value="basic">Basic</option>
                    <option value="basic_plus_epf_components">Basic + EPF allowances</option>
                  </select>
                </FormField>
                <FormField id="st-npmode" label="No-pay divisor">
                  <select
                    id="st-npmode"
                    className={selectClass}
                    value={f.nopayDivisorMode}
                    onChange={(e) => setF({ ...f, nopayDivisorMode: e.target.value as 'fixed' })}
                  >
                    <option value="working_days">Working days in month</option>
                    <option value="fixed">Fixed number</option>
                  </select>
                </FormField>
                {f.nopayDivisorMode === 'fixed' && field('nopayFixedDivisor', 'Fixed divisor')}
                <FormField id="st-round" label="Rounding">
                  <select
                    id="st-round"
                    className={selectClass}
                    value={f.roundingMode}
                    onChange={(e) => setF({ ...f, roundingMode: e.target.value as 'half_up' })}
                  >
                    {['half_up', 'half_even', 'half_down', 'up', 'down'].map((m) => (
                      <option key={m} value={m}>
                        {m.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={f.restDayOtAsHoliday}
                  onCheckedChange={(v) => setF({ ...f, restDayOtAsHoliday: !!v })}
                />
                Pay rest-day overtime at the holiday rate
              </label>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tax tables ──────────────────────────────────────────────────────────────
type TableForm = Omit<TaxTableDto, 'id' | 'needsReview' | 'effectiveTo'> & { id?: string };

function TaxTablesTab({ canEdit }: { canEdit: boolean }) {
  const tables = useTaxTables();
  const save = useSaveTaxTable();
  const [f, setF] = useState<TableForm | null>(null);
  const setSlab = (i: number, k: string, v: string) =>
    setF({
      ...f!,
      slabs: f!.slabs.map((s, j) =>
        j === i ? { ...s, [k]: k === 'to' && v === '' ? null : v } : s,
      ),
    });
  return (
    <div className="space-y-4">
      {tables.data?.map((t) => (
        <Card key={t.id} data-testid={`tax-${t.code}-${t.effectiveFrom}`}>
          <CardHeader>
            <CardTitle className="text-base">
              {t.name} <span className="text-muted-foreground font-mono text-xs">{t.code}</span>
              <ReviewBadge show={t.needsReview} />
            </CardTitle>
            <CardDescription>
              {t.effectiveFrom} → {t.effectiveTo ?? 'now'} ·{' '}
              {t.method === 'slab_monthly' ? 'monthly slabs' : 'annual cumulative'}
              {t.source && ` · ${t.source}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Over</TableHead>
                  <TableHead>Up to</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Less</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.slabs.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{s.from}</TableCell>
                    <TableCell>{s.to ?? '—'}</TableCell>
                    <TableCell>{s.rate}%</TableCell>
                    <TableCell>{s.deduct}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {canEdit && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setF({ ...t })}>
                  Edit / confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setF({
                      ...t,
                      id: undefined,
                      effectiveFrom: new Date().toISOString().slice(0, 10),
                    })
                  }
                >
                  New version from a date
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{f?.id ? `Edit ${f.code}` : 'New tax table version'}</DialogTitle>
          </DialogHeader>
          {f && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const { id, ...body } = f;
                save.mutate({ ...body, ...(id ? { id } : {}) }, { onSuccess: () => setF(null) });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="tt-name" label="Name">
                  <Input
                    id="tt-name"
                    value={f.name}
                    onChange={(e) => setF({ ...f, name: e.target.value })}
                  />
                </FormField>
                <FormField id="tt-from" label="Effective from">
                  <Input
                    id="tt-from"
                    type="date"
                    disabled={!!f.id}
                    value={f.effectiveFrom}
                    onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
                  />
                </FormField>
                <FormField id="tt-source" label="Source">
                  <Input
                    id="tt-source"
                    value={f.source ?? ''}
                    onChange={(e) => setF({ ...f, source: e.target.value })}
                  />
                </FormField>
              </div>
              <div className="space-y-2">
                {f.slabs.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_5rem_1fr_auto] gap-2">
                    <Input
                      aria-label={`Slab ${i + 1} over`}
                      value={s.from}
                      onChange={(e) => setSlab(i, 'from', e.target.value)}
                    />
                    <Input
                      aria-label={`Slab ${i + 1} up to`}
                      placeholder="no limit"
                      value={s.to ?? ''}
                      onChange={(e) => setSlab(i, 'to', e.target.value)}
                    />
                    <Input
                      aria-label={`Slab ${i + 1} rate`}
                      value={s.rate}
                      onChange={(e) => setSlab(i, 'rate', e.target.value)}
                    />
                    <Input
                      aria-label={`Slab ${i + 1} less`}
                      value={s.deduct}
                      onChange={(e) => setSlab(i, 'deduct', e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setF({ ...f, slabs: f.slabs.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setF({
                      ...f,
                      slabs: [...f.slabs, { from: '', to: null, rate: '0', deduct: '0' }],
                    })
                  }
                >
                  Add slab
                </Button>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Save table
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Bank templates ──────────────────────────────────────────────────────────
function BankTab({ canEdit }: { canEdit: boolean }) {
  const list = useBankTemplates();
  const save = useSaveBankTemplate();
  const [edit, setEdit] = useState<{ id?: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toText = (b?: BankTemplate) =>
    JSON.stringify(
      b
        ? { name: b.name, bank: b.bank, format: b.format, spec: b.spec, isActive: b.isActive }
        : {
            name: '',
            bank: '',
            format: 'csv',
            spec: {
              includeHeader: true,
              columns: [
                { header: 'Account No', field: 'accountNo' },
                { header: 'Amount', field: 'amount', format: 'amount_2dp' },
              ],
            },
            isActive: true,
          },
      null,
      2,
    );
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Layouts are data. Fields: employeeNo, name, accountName, accountNo, bankName, bankCode,
        branchCode, amount, reference, payDate, nic. Formats: amount_2dp, amount_cents, upper,
        date:YYYYMMDD, date:YYMMDD, date:DDMMYYYY.
      </p>
      {canEdit && (
        <Button size="sm" onClick={() => setEdit({ text: toText() })}>
          <Plus /> New template
        </Button>
      )}
      {list.data?.map((b) => (
        <Card key={b.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {b.name}
              <ReviewBadge show={b.needsReview} />
            </CardTitle>
            <CardDescription>
              {b.bank} · {b.format === 'csv' ? 'CSV' : 'fixed width'} · {b.spec.columns.length}{' '}
              columns
            </CardDescription>
          </CardHeader>
          {canEdit && (
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEdit({ id: b.id, text: toText(b) })}
              >
                Edit layout
              </Button>
            </CardContent>
          )}
        </Card>
      ))}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bank file layout</DialogTitle>
          </DialogHeader>
          {edit && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setErr(null);
                let json: unknown;
                try {
                  json = JSON.parse(edit.text);
                } catch {
                  setErr('That is not valid JSON');
                  return;
                }
                const p = bankTemplateInputSchema.safeParse(json);
                if (!p.success) {
                  setErr(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
                  return;
                }
                save.mutate(
                  { ...p.data, ...(edit.id ? { id: edit.id } : {}) },
                  { onSuccess: () => setEdit(null) },
                );
              }}
            >
              <Textarea
                aria-label="Layout JSON"
                className="h-96 font-mono text-xs"
                value={edit.text}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
              {err && <p className="text-destructive text-sm">{err}</p>}
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Save layout
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayrollSettingsPage() {
  const { can } = useAuth();
  const canEdit = can('payroll.configure', 'all');
  const comps = useComponents();
  return (
    <RequirePermission permission="payroll.read" scope="all">
      <PageHeader title="Payroll" />
      <PayrollTabs />
      <SampleDataBanner className="mb-4" />
      {comps.error && <ErrorAlert error={comps.error} />}
      <Tabs defaultValue="statutory">
        <TabsList className="flex-wrap">
          <TabsTrigger value="statutory">Statutory rates</TabsTrigger>
          <TabsTrigger value="tax">Tax tables</TabsTrigger>
          <TabsTrigger value="components">Pay components</TabsTrigger>
          <TabsTrigger value="bank">Bank files</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>
        <TabsContent value="statutory" className="pt-4">
          <StatutoryTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="tax" className="pt-4">
          <TaxTablesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="components" className="pt-4">
          <Components canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="bank" className="pt-4">
          <BankTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="general" className="pt-4">
          {can('settings.manage', 'all') ? (
            <General />
          ) : (
            <p className="text-muted-foreground text-sm">An owner or HR admin changes these.</p>
          )}
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}
