'use client';

import { AlertTriangle, Pencil } from 'lucide-react';
import { useState } from 'react';

import {
  ACCRUALS,
  EMPLOYMENT_TYPES,
  LEAVE_ROUNDINGS,
  PRORATIONS,
  type LeavePolicy,
  type LeaveType,
  type YearEndPreview,
} from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { ImportWizard } from '@/components/imports/import-wizard';
import { LeaveTabs } from '@/components/leave/leave-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useEmployeeOptions } from '@/lib/queries/admin';
import {
  useAdjust,
  useBalanceReport,
  useLeaveTypes,
  usePolicies,
  useSaveLeaveType,
  useSavePolicy,
  useYearEnd,
} from '@/lib/queries/leave';

const THIS_YEAR = new Date().getUTCFullYear();
const LABEL: Record<string, string> = {
  upfront_yearly: 'Full year upfront',
  monthly: 'Monthly',
  none: 'Not allocated (adjustments only)',
  daily: 'By days remaining',
  nearest_half: 'Nearest ½ day',
  floor_half: 'Down to ½ day',
  floor_day: 'Down to whole day',
  nearest_day: 'Nearest whole day',
};
const lbl = (v: string) => LABEL[v] ?? v.replace('_', ' ');

function TypeDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const save = useSaveLeaveType();
  const [f, setF] = useState<LeaveType | null>(null);
  const [prev, setPrev] = useState<LeaveType | null>(null);
  if (type !== prev) {
    setPrev(type);
    setF(type);
  }
  if (!f) return null;
  const numField = (k: 'requiresAttachmentAfterDays' | 'maxConsecutiveDays', label: string) => (
    <FormField id={`t-${k}`} label={label}>
      <Input
        id={`t-${k}`}
        type="number"
        step="0.5"
        min="0"
        value={f[k] ?? ''}
        onChange={(e) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) })}
      />
    </FormField>
  );
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{f.name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(f, { onSuccess: onClose });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="t-name" label="Name">
              <Input
                id="t-name"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </FormField>
            <FormField id="t-color" label="Colour">
              <input
                id="t-color"
                type="color"
                className="h-9 w-full rounded border"
                value={f.color}
                onChange={(e) => setF({ ...f, color: e.target.value })}
              />
            </FormField>
            {numField('maxConsecutiveDays', 'Max days in one request')}
            {numField('requiresAttachmentAfterDays', 'Document needed above (days)')}
            <FormField id="t-notice" label="Minimum notice (days)">
              <Input
                id="t-notice"
                type="number"
                min="0"
                max="365"
                value={f.minNoticeDays}
                onChange={(e) => setF({ ...f, minNoticeDays: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.isPaid}
              onCheckedChange={(v) => setF({ ...f, isPaid: v })}
              aria-label="Paid leave"
            />{' '}
            Paid leave
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.allowNegative}
              onCheckedChange={(v) => setF({ ...f, allowNegative: v })}
              aria-label="Allow without balance"
            />{' '}
            Can be taken without a balance
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.isActive}
              onCheckedChange={(v) => setF({ ...f, isActive: v })}
              aria-label="Active"
            />{' '}
            Active
          </label>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyDialog({
  policy,
  types,
  onClose,
}: {
  policy: LeavePolicy | null;
  types: LeaveType[];
  onClose: () => void;
}) {
  const save = useSavePolicy();
  const [f, setF] = useState<LeavePolicy | null>(null);
  const [prev, setPrev] = useState<LeavePolicy | null>(null);
  if (policy !== prev) {
    setPrev(policy);
    setF(policy);
  }
  if (!f) return null;
  const type = types.find((t) => t.id === f.leaveTypeId);
  const choose = <K extends 'accrual' | 'prorationOnJoin' | 'rounding'>(
    k: K,
    label: string,
    opts: readonly string[],
  ) => (
    <FormField id={`p-${k}`} label={label}>
      <select
        id={`p-${k}`}
        className={selectClass}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {lbl(o)}
          </option>
        ))}
      </select>
    </FormField>
  );
  const types_ = f.appliesTo.employmentTypes ?? [];
  return (
    <Dialog open={!!policy} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type?.name} policy</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { id, needsReview: _n, ...input } = f;
            save.mutate({ id, ...input }, { onSuccess: onClose });
          }}
        >
          <p className="text-muted-foreground rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
            Enter your company&apos;s entitlement. Check it meets the statutory minimum for your
            sector — saving marks the policy as reviewed.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="p-name" label="Name">
              <Input
                id="p-name"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </FormField>
            <FormField
              id="p-ent"
              label={`Entitlement per year (${type?.unit === 'hour' ? 'hours' : 'days'})`}
            >
              <Input
                id="p-ent"
                type="number"
                step="0.5"
                min="0"
                value={f.entitlement}
                onChange={(e) => setF({ ...f, entitlement: Number(e.target.value) })}
              />
            </FormField>
            {choose('accrual', 'How it is given', ACCRUALS)}
            {choose('prorationOnJoin', 'Joiners get', PRORATIONS)}
            {choose('rounding', 'Rounding', LEAVE_ROUNDINGS)}
            <FormField id="p-elig" label="Eligible after (months of service)">
              <Input
                id="p-elig"
                type="number"
                min="0"
                value={f.eligibleAfterMonths}
                onChange={(e) => setF({ ...f, eligibleAfterMonths: Number(e.target.value) })}
              />
            </FormField>
            <FormField id="p-cf" label="Carry forward up to">
              <Input
                id="p-cf"
                type="number"
                step="0.5"
                min="0"
                value={f.carryForwardMax}
                onChange={(e) => setF({ ...f, carryForwardMax: Number(e.target.value) })}
              />
            </FormField>
            <FormField id="p-cfe" label="Carried leave expires after (months, blank = never)">
              <Input
                id="p-cfe"
                type="number"
                min="1"
                max="12"
                value={f.carryForwardExpiryMonths ?? ''}
                onChange={(e) =>
                  setF({
                    ...f,
                    carryForwardExpiryMonths: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </FormField>
            <FormField id="p-from" label="Effective from">
              <Input
                id="p-from"
                type="date"
                value={f.effectiveFrom}
                onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
              />
            </FormField>
            <FormField id="p-prio" label="Priority (lower wins)">
              <Input
                id="p-prio"
                type="number"
                min="0"
                value={f.priority}
                onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}
              />
            </FormField>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Applies to employment types (none ticked = everyone)
            </legend>
            <div className="flex flex-wrap gap-3">
              {EMPLOYMENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={types_.includes(t)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        appliesTo: {
                          ...f.appliesTo,
                          employmentTypes: e.target.checked
                            ? [...types_, t]
                            : types_.filter((x) => x !== t),
                        },
                      })
                    }
                  />
                  {t.replace('_', ' ')}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.encashable}
              onCheckedChange={(v) => setF({ ...f, encashable: v })}
              aria-label="Encashable"
            />{' '}
            Unused balance can be paid out
          </label>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save policy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TypesAndPolicies() {
  const types = useLeaveTypes();
  const policies = usePolicies();
  const [editType, setEditType] = useState<LeaveType | null>(null);
  const [editPolicy, setEditPolicy] = useState<LeavePolicy | null>(null);
  if (types.error || policies.error) return <ErrorAlert error={types.error ?? policies.error} />;
  if (!types.data || !policies.data) return <Skeleton className="h-64" />;
  const review = policies.data.filter((p) => p.needsReview).length;
  return (
    <div className="space-y-4">
      {review > 0 && (
        <p
          className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30"
          data-testid="policies-need-review"
        >
          <AlertTriangle className="size-4 text-amber-600" />
          {review} leave {review === 1 ? 'policy needs' : 'policies need'} your entitlements before
          staff can apply.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Leave type</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Entitlement</TableHead>
              <TableHead>Given</TableHead>
              <TableHead>Carry forward</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.data.map((t) => {
              const ps = policies.data.filter((p) => p.leaveTypeId === t.id);
              return ps.map((p, i) => (
                <TableRow key={p.id} data-testid={`policy-${t.code}`}>
                  <TableCell>
                    {i === 0 && (
                      <button
                        type="button"
                        className="flex items-center gap-2 font-medium hover:underline"
                        onClick={() => setEditType(t)}
                      >
                        <span className="size-2 rounded-full" style={{ background: t.color }} />
                        {t.name}
                        {!t.isPaid && <Badge variant="outline">unpaid</Badge>}
                        {!t.isActive && <Badge variant="outline">inactive</Badge>}
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.name}
                    {p.needsReview && (
                      <Badge variant="destructive" className="ml-2">
                        needs review
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.entitlement}
                    {t.unit === 'hour' ? ' h' : ' days'}
                  </TableCell>
                  <TableCell>{lbl(p.accrual)}</TableCell>
                  <TableCell>
                    {p.carryForwardMax > 0
                      ? `up to ${p.carryForwardMax}${p.carryForwardExpiryMonths ? `, ${p.carryForwardExpiryMonths} mo` : ''}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${t.name} policy`}
                      onClick={() => setEditPolicy(p)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </div>
      <TypeDialog type={editType} onClose={() => setEditType(null)} />
      <PolicyDialog policy={editPolicy} types={types.data} onClose={() => setEditPolicy(null)} />
    </div>
  );
}

function Adjustments() {
  const people = useEmployeeOptions();
  const types = useLeaveTypes();
  const adjust = useAdjust();
  const [f, setF] = useState({
    employeeId: '',
    leaveTypeId: '',
    year: THIS_YEAR,
    amount: '',
    note: '',
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adjust a balance</CardTitle>
        <CardDescription>
          Grant lieu leave, correct a mistake, or record leave taken before go-live. Recorded in the
          ledger.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid items-end gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            adjust.mutate(
              { ...f, amount: Number(f.amount) },
              { onSuccess: () => setF({ ...f, amount: '', note: '' }) },
            );
          }}
        >
          <FormField id="a-emp" label="Employee">
            <select
              id="a-emp"
              required
              className={selectClass}
              value={f.employeeId}
              onChange={(e) => setF({ ...f, employeeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.employeeNo})
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="a-type" label="Leave type">
            <select
              id="a-type"
              required
              className={selectClass}
              value={f.leaveTypeId}
              onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {types.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="a-year" label="Year">
            <Input
              id="a-year"
              type="number"
              value={f.year}
              onChange={(e) => setF({ ...f, year: Number(e.target.value) })}
            />
          </FormField>
          <FormField id="a-amount" label="Amount (+ adds, − removes)">
            <Input
              id="a-amount"
              type="number"
              step="0.5"
              required
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </FormField>
          <FormField id="a-note" label="Reason">
            <Input
              id="a-note"
              required
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </FormField>
          <Button type="submit" disabled={adjust.isPending}>
            Record adjustment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function YearEnd() {
  const yearEnd = useYearEnd();
  const [year, setYear] = useState(THIS_YEAR - 1);
  const [preview, setPreview] = useState<YearEndPreview | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Year-end processing</CardTitle>
        <CardDescription>
          Carries unused leave into the next year up to each policy&apos;s limit. Preview first; it
          can only run once per year.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <FormField id="ye-year" label="Close leave year">
            <Input
              id="ye-year"
              type="number"
              className="w-28"
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setPreview(null);
              }}
            />
          </FormField>
          <Button
            variant="outline"
            disabled={yearEnd.isPending}
            onClick={() =>
              yearEnd.mutate({ fromYear: year, dryRun: true }, { onSuccess: setPreview })
            }
          >
            Preview
          </Button>
          <Button
            disabled={yearEnd.isPending || !preview || preview.alreadyRun}
            onClick={() =>
              yearEnd.mutate({ fromYear: year, dryRun: false }, { onSuccess: setPreview })
            }
          >
            Run year-end for {year}
          </Button>
        </div>
        {preview && (
          <div data-testid="year-end-preview">
            {preview.alreadyRun && (
              <p className="mb-2 text-sm text-green-700">
                Year-end for {preview.fromYear} has been run.
              </p>
            )}
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Closing</TableHead>
                    <TableHead>Carried</TableHead>
                    <TableHead>Lapses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                        No balances to carry
                      </TableCell>
                    </TableRow>
                  )}
                  {preview.rows.map((r) => (
                    <TableRow key={`${r.employeeNo}-${r.leaveTypeCode}`}>
                      <TableCell>
                        {r.name}{' '}
                        <span className="text-muted-foreground font-mono text-xs">
                          {r.employeeNo}
                        </span>
                      </TableCell>
                      <TableCell>{r.leaveTypeCode}</TableCell>
                      <TableCell>{r.closingBalance}</TableCell>
                      <TableCell>{r.carryForward}</TableCell>
                      <TableCell>{r.lapsed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceReport() {
  const [year, setYear] = useState(THIS_YEAR);
  const report = useBalanceReport(year, true);
  const types = useLeaveTypes();
  const codes = types.data?.filter((t) => t.isActive).map((t) => t.code) ?? [];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Balances</CardTitle>
        <Input
          aria-label="Report year"
          type="number"
          className="w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </CardHeader>
      <CardContent>
        {report.error && <ErrorAlert error={report.error} />}
        {!report.data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  {codes.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>
                      {r.name}{' '}
                      <span className="text-muted-foreground font-mono text-xs">
                        {r.employeeNo}
                      </span>
                    </TableCell>
                    <TableCell>{r.department ?? '—'}</TableCell>
                    {codes.map((c) => (
                      <TableCell
                        key={c}
                        title={
                          r.balances[c]
                            ? `${r.balances[c].taken} taken, ${r.balances[c].pending} pending`
                            : ''
                        }
                      >
                        {r.balances[c]?.balance ?? '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeaveAdminPage() {
  return (
    <RequirePermission permission="leave.manage" scope="all">
      <PageHeader title="Leave" />
      <LeaveTabs />
      <Tabs defaultValue="policies">
        <TabsList className="flex-wrap">
          <TabsTrigger value="policies">Types & policies</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="adjust">Adjustments</TabsTrigger>
          <TabsTrigger value="opening">Opening balances</TabsTrigger>
          <TabsTrigger value="year-end">Year-end</TabsTrigger>
        </TabsList>
        <TabsContent value="policies" className="pt-4">
          <TypesAndPolicies />
        </TabsContent>
        <TabsContent value="balances" className="pt-4">
          <BalanceReport />
        </TabsContent>
        <TabsContent value="adjust" className="pt-4">
          <Adjustments />
        </TabsContent>
        <TabsContent value="opening" className="pt-4">
          <ImportWizard kind="leave-balances" />
        </TabsContent>
        <TabsContent value="year-end" className="pt-4">
          <YearEnd />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}
