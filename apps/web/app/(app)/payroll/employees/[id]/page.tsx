'use client';

import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { PayrollTabs } from '@/components/payroll/payroll-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useEmployee } from '@/lib/queries/employees';
import {
  lkr,
  useComponents,
  usePaySetup,
  useSetupAction,
  useTaxTables,
} from '@/lib/queries/payroll';

const today = () => new Date().toISOString().slice(0, 10);

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default function PaySetupPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const edit = can('payroll.run', 'all');
  const employee = useEmployee(id);
  const setup = usePaySetup(id);
  const comps = useComponents();
  const tables = useTaxTables();
  const act = useSetupAction(id);
  const s = setup.data;

  const [sal, setSal] = useState({
    effectiveFrom: today(),
    basic: '',
    otEligible: false,
    nopayFromAbsence: false,
    reason: '',
  });
  const [rec, setRec] = useState({ componentId: '', amount: '', effectiveFrom: today() });
  const [tax, setTax] = useState<{ tableCode: string; effectiveFrom: string } | null>(null);
  const [codes, setCodes] = useState<{ bankCode: string; branchCode: string } | null>(null);
  const [loan, setLoan] = useState({
    type: 'loan',
    principal: '',
    installmentAmount: '',
    startPeriod: today().slice(0, 7),
    note: '',
  });

  const recurringChoices = (comps.data ?? []).filter(
    (c) =>
      c.isActive &&
      !c.isSystem &&
      c.calc !== 'variable' &&
      (c.kind === 'earning' || c.kind === 'deduction'),
  );
  const tableCodes = [...new Set((tables.data ?? []).map((t) => t.code))];
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    fn();
  };
  const name = employee.data ? `${employee.data.firstName} ${employee.data.lastName}` : '…';

  return (
    <RequirePermission permission="payroll.read" scope="all">
      <PageHeader title={`Pay · ${name}`} description={employee.data?.employeeNo} />
      <PayrollTabs />
      {setup.error && <ErrorAlert error={setup.error} />}
      {!s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section
            title="Salary"
            description="Changes start on a date; the previous salary ends the day before."
          >
            <ul className="space-y-1 text-sm" data-testid="salary-history">
              {s.salaries.map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <span>
                    {x.effectiveFrom} → {x.effectiveTo ?? 'now'}
                    {x.reason && <span className="text-muted-foreground"> · {x.reason}</span>}
                    {x.otEligible && (
                      <Badge variant="outline" className="ml-2">
                        OT
                      </Badge>
                    )}
                    {x.nopayFromAbsence && (
                      <Badge variant="outline" className="ml-1">
                        absence = no-pay
                      </Badge>
                    )}
                  </span>
                  <span className="font-medium">{lkr(x.basic)}</span>
                </li>
              ))}
              {!s.salaries.length && <li className="text-amber-600">No salary yet.</li>}
            </ul>
            {edit && (
              <form
                className="grid gap-3 border-t pt-3 sm:grid-cols-2"
                onSubmit={submit(() =>
                  act.mutate(
                    { kind: 'salary', body: { ...sal, reason: sal.reason || null } },
                    { onSuccess: () => setSal({ ...sal, basic: '', reason: '' }) },
                  ),
                )}
              >
                <FormField id="sal-from" label="From">
                  <Input
                    id="sal-from"
                    type="date"
                    required
                    value={sal.effectiveFrom}
                    onChange={(e) => setSal({ ...sal, effectiveFrom: e.target.value })}
                  />
                </FormField>
                <FormField id="sal-basic" label="Basic salary (LKR / month)">
                  <Input
                    id="sal-basic"
                    required
                    inputMode="decimal"
                    value={sal.basic}
                    onChange={(e) => setSal({ ...sal, basic: e.target.value })}
                  />
                </FormField>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sal.otEligible}
                    onCheckedChange={(v) => setSal({ ...sal, otEligible: !!v })}
                  />
                  Paid overtime from attendance
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sal.nopayFromAbsence}
                    onCheckedChange={(v) => setSal({ ...sal, nopayFromAbsence: !!v })}
                  />
                  Unexcused absence is no-pay
                </label>
                <FormField id="sal-reason" label="Reason (optional)">
                  <Input
                    id="sal-reason"
                    value={sal.reason}
                    onChange={(e) => setSal({ ...sal, reason: e.target.value })}
                  />
                </FormField>
                <div className="flex items-end">
                  <Button type="submit" disabled={act.isPending}>
                    Save salary
                  </Button>
                </div>
              </form>
            )}
          </Section>

          <Section title="Recurring allowances & deductions">
            <ul className="space-y-1 text-sm">
              {s.recurring.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span>
                    {x.name} · {x.effectiveFrom} → {x.effectiveTo ?? 'ongoing'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={x.kind === 'deduction' ? 'text-red-600' : ''}>
                      {lkr(x.amount)}
                    </span>
                    {edit && !x.effectiveTo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act.mutate({ kind: 'end-recurring', id: x.id, effectiveTo: today() })
                        }
                      >
                        End today
                      </Button>
                    )}
                  </span>
                </li>
              ))}
              {!s.recurring.length && <li className="text-muted-foreground">None.</li>}
            </ul>
            {edit && (
              <form
                className="grid gap-3 border-t pt-3 sm:grid-cols-[1fr_8rem_10rem_auto]"
                onSubmit={submit(() =>
                  act.mutate(
                    { kind: 'recurring', body: rec },
                    { onSuccess: () => setRec({ ...rec, amount: '' }) },
                  ),
                )}
              >
                <select
                  aria-label="Component"
                  required
                  className={selectClass}
                  value={rec.componentId}
                  onChange={(e) => setRec({ ...rec, componentId: e.target.value })}
                >
                  <option value="">Item…</option>
                  {recurringChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Amount"
                  required
                  inputMode="decimal"
                  placeholder="Amount"
                  value={rec.amount}
                  onChange={(e) => setRec({ ...rec, amount: e.target.value })}
                />
                <Input
                  aria-label="From"
                  type="date"
                  required
                  value={rec.effectiveFrom}
                  onChange={(e) => setRec({ ...rec, effectiveFrom: e.target.value })}
                />
                <Button type="submit" disabled={act.isPending}>
                  Add
                </Button>
              </form>
            )}
          </Section>

          <Section title="Tax (APIT)">
            <p className="text-sm">
              Current:{' '}
              {s.taxProfiles[0] ? (
                <span className="font-medium">
                  {s.taxProfiles[0].tableCode ?? 'Not liable'} from {s.taxProfiles[0].effectiveFrom}
                </span>
              ) : (
                <span className="text-amber-600">no tax profile — no APIT is deducted</span>
              )}
            </p>
            {edit && (
              <form
                className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]"
                onSubmit={submit(() => {
                  const t = tax ?? { tableCode: tableCodes[0] ?? '', effectiveFrom: today() };
                  act.mutate({
                    kind: 'tax-profile',
                    body: {
                      tableCode: t.tableCode || null,
                      isResident: true,
                      hasSecondaryEmployment: false,
                      effectiveFrom: t.effectiveFrom,
                    },
                  });
                })}
              >
                <select
                  aria-label="Tax table"
                  className={selectClass}
                  value={tax?.tableCode ?? s.taxProfiles[0]?.tableCode ?? tableCodes[0] ?? ''}
                  onChange={(e) =>
                    setTax({
                      tableCode: e.target.value,
                      effectiveFrom: tax?.effectiveFrom ?? today(),
                    })
                  }
                >
                  {tableCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="">Not liable</option>
                </select>
                <Input
                  aria-label="Tax profile from"
                  type="date"
                  value={tax?.effectiveFrom ?? today()}
                  onChange={(e) =>
                    setTax({
                      tableCode: tax?.tableCode ?? tableCodes[0] ?? '',
                      effectiveFrom: e.target.value,
                    })
                  }
                />
                <Button type="submit" disabled={act.isPending}>
                  Save
                </Button>
              </form>
            )}
          </Section>

          <Section
            title="Bank"
            description="Account details are edited on the employee record; transfer files also need bank and branch codes."
          >
            <p className="text-sm">
              {s.bank.accountNo ? (
                <>
                  {s.bank.bankName ?? 'Bank'} · {s.bank.branch ?? ''} ·{' '}
                  <span className="font-mono">{s.bank.accountNo}</span>
                </>
              ) : (
                <span className="text-amber-600">No bank account on the employee record</span>
              )}
            </p>
            {edit && (
              <form
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={submit(() => {
                  const c = codes ?? {
                    bankCode: s.bank.bankCode ?? '',
                    branchCode: s.bank.branchCode ?? '',
                  };
                  act.mutate({
                    kind: 'bank-codes',
                    body: { bankCode: c.bankCode || null, branchCode: c.branchCode || null },
                  });
                })}
              >
                <Input
                  aria-label="Bank code"
                  placeholder="Bank code"
                  value={codes?.bankCode ?? s.bank.bankCode ?? ''}
                  onChange={(e) =>
                    setCodes({
                      bankCode: e.target.value,
                      branchCode: codes?.branchCode ?? s.bank.branchCode ?? '',
                    })
                  }
                />
                <Input
                  aria-label="Branch code"
                  placeholder="Branch code"
                  value={codes?.branchCode ?? s.bank.branchCode ?? ''}
                  onChange={(e) =>
                    setCodes({
                      bankCode: codes?.bankCode ?? s.bank.bankCode ?? '',
                      branchCode: e.target.value,
                    })
                  }
                />
                <Button type="submit" disabled={act.isPending}>
                  Save
                </Button>
              </form>
            )}
          </Section>

          <Section
            title="Loans & advances"
            description="Instalments are deducted in each regular payroll until recovered."
          >
            <ul className="space-y-1 text-sm">
              {s.loans.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2">
                  <span>
                    {l.type === 'loan' ? 'Loan' : 'Advance'} {lkr(l.principal)} ·{' '}
                    {lkr(l.installmentAmount)}/month from {l.startPeriod}
                    <Badge variant="outline" className="ml-2">
                      {l.status}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    recovered {lkr(l.recovered)}
                    {edit && l.status === 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act.mutate({ kind: 'cancel-loan', id: l.id })}
                      >
                        Cancel
                      </Button>
                    )}
                  </span>
                </li>
              ))}
              {!s.loans.length && <li className="text-muted-foreground">None.</li>}
            </ul>
            {edit && (
              <form
                className="grid gap-3 border-t pt-3 sm:grid-cols-2"
                onSubmit={submit(() =>
                  act.mutate(
                    { kind: 'loan', body: { ...loan, note: loan.note || null } },
                    {
                      onSuccess: () =>
                        setLoan({ ...loan, principal: '', installmentAmount: '', note: '' }),
                    },
                  ),
                )}
              >
                <select
                  aria-label="Loan type"
                  className={selectClass}
                  value={loan.type}
                  onChange={(e) => setLoan({ ...loan, type: e.target.value })}
                >
                  <option value="loan">Loan</option>
                  <option value="advance">Salary advance</option>
                </select>
                <Input
                  aria-label="First deduction month"
                  type="month"
                  required
                  value={loan.startPeriod}
                  onChange={(e) => setLoan({ ...loan, startPeriod: e.target.value })}
                />
                <Input
                  aria-label="Amount"
                  required
                  inputMode="decimal"
                  placeholder="Amount"
                  value={loan.principal}
                  onChange={(e) => setLoan({ ...loan, principal: e.target.value })}
                />
                <Input
                  aria-label="Monthly instalment"
                  required
                  inputMode="decimal"
                  placeholder="Monthly instalment"
                  value={loan.installmentAmount}
                  onChange={(e) => setLoan({ ...loan, installmentAmount: e.target.value })}
                />
                <Input
                  aria-label="Loan note"
                  placeholder="Note (optional)"
                  value={loan.note}
                  onChange={(e) => setLoan({ ...loan, note: e.target.value })}
                />
                <Button type="submit" disabled={act.isPending}>
                  Add
                </Button>
              </form>
            )}
          </Section>
        </div>
      )}
    </RequirePermission>
  );
}
