'use client';

import Link from 'next/link';

import { ErrorAlert } from '@/components/common/error-alert';
import { BarList, ColumnTrend, StatTile } from '@/components/dashboard/charts';
import { SampleDataBanner } from '@/components/payroll/payroll-ui';
import { HealthBadge } from '@/components/shell/health-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useHrDashboard, usePayrollDashboard } from '@/lib/queries/notifications';
import { lkr } from '@/lib/queries/payroll';

/** Whole rupees for chart heights only (display; amounts stay strings everywhere else). */
const approx = (v: string) => Number(v.split('.')[0]);

export default function DashboardPage() {
  const { me, can } = useAuth();
  const isHr = can('employees.read', 'team');
  const isPayroll = can('payroll.read', 'all');
  const hr = useHrDashboard(isHr);
  const pay = usePayrollDashboard(isPayroll);
  const d = hr.data;
  const p = pay.data;

  if (me && !isHr && !isPayroll)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <HealthBadge />
        <p className="text-muted-foreground">
          Your self-service home is in{' '}
          <Link className="text-primary underline" href="/me">
            My HR
          </Link>
          .
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <HealthBadge />
        {d && (
          <span className="text-muted-foreground text-sm">
            {d.scope === 'team' ? 'Your team' : 'Whole company'} · {d.asOf}
          </span>
        )}
      </div>

      {isHr && (
        <>
          {hr.error && <ErrorAlert error={hr.error} />}
          {!d ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Headcount" value={d.headcount.total} testId="stat-headcount" />
                <StatTile
                  label="Joiners / leavers this month"
                  value={`${d.joinersThisMonth} / ${d.leaversThisMonth}`}
                />
                <StatTile
                  label="Turnover (12 months)"
                  value={d.turnover12m.percent === null ? '—' : `${d.turnover12m.percent}%`}
                  hint={`${d.turnover12m.leavers} leaver(s), avg headcount ${d.turnover12m.averageHeadcount}`}
                />
                <StatTile
                  label="Waiting for approval"
                  value={
                    d.approvals.total ? (
                      <Link href="/approvals" className="text-primary hover:underline">
                        {d.approvals.total}
                      </Link>
                    ) : (
                      0
                    )
                  }
                />
              </div>

              {d.attendanceToday && (
                <div
                  className="grid grid-cols-3 gap-3 sm:grid-cols-6"
                  data-testid="attendance-today"
                >
                  {(
                    [
                      ['Present', d.attendanceToday.present],
                      ['Late', d.attendanceToday.late],
                      ['On leave', d.attendanceToday.onLeave],
                      ['Not in / absent', d.attendanceToday.absent],
                      ['Missing punch', d.attendanceToday.incomplete],
                      ['Rest day', d.attendanceToday.restDay],
                    ] as const
                  ).map(([label, n]) => (
                    <Link
                      key={label}
                      href="/attendance/board"
                      className="hover:bg-accent rounded-lg border p-3"
                    >
                      <div className="text-muted-foreground text-xs">{label}</div>
                      <div className="text-xl font-semibold tabular-nums">{n}</div>
                    </Link>
                  ))}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-3">
                <BarList
                  title="Headcount by department"
                  valueLabel="Employees"
                  data={d.headcount.byDepartment.map((x) => ({ label: x.label, value: x.count }))}
                />
                <BarList
                  title="Headcount by branch"
                  valueLabel="Employees"
                  data={d.headcount.byBranch.map((x) => ({ label: x.label, value: x.count }))}
                />
                <section className="bg-card rounded-xl border p-4">
                  <h2 className="mb-3 text-sm font-semibold">Coming up (30 days)</h2>
                  {d.expiringDocuments !== null && d.expiringDocuments > 0 && (
                    <p className="mb-2 text-sm text-amber-600">
                      {d.expiringDocuments} document(s) expire in the next 30 days
                    </p>
                  )}
                  {d.upcoming.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nothing due.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.upcoming.map((u) => (
                        <li
                          key={`${u.employeeId}-${u.kind}`}
                          className="flex justify-between gap-2"
                        >
                          <Link href={`/employees/${u.employeeId}`} className="hover:underline">
                            {u.name}
                          </Link>
                          <span className="text-muted-foreground">
                            {u.kind === 'probation_end' ? 'Probation ends' : 'Contract ends'}{' '}
                            {u.date}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}

      {isPayroll && (
        <>
          <h2 className="pt-2 text-lg font-semibold">Payroll</h2>
          {pay.error && <ErrorAlert error={pay.error} />}
          {p?.configNeedsReview && <SampleDataBanner />}
          {!p ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ColumnTrend
                  title="Employer cost by month"
                  valueLabel="Employer cost (LKR)"
                  data={p.trend.map((t) => ({
                    label: t.month,
                    value: approx(t.employerCost),
                    display: lkr(t.employerCost),
                  }))}
                />
              </div>
              <div className="grid content-start gap-3">
                {p.latest ? (
                  <>
                    <StatTile
                      label={`EPF (${p.latest.month})`}
                      value={lkr(p.latest.statutory.epfEmployee)}
                      hint={`Employer ${lkr(p.latest.statutory.epfEmployer)}`}
                    />
                    <StatTile label="ETF" value={lkr(p.latest.statutory.etf)} />
                    <StatTile label="APIT" value={lkr(p.latest.statutory.apit)} />
                  </>
                ) : (
                  <StatTile
                    label="Statutory totals"
                    value="—"
                    hint="After the first approved payroll"
                  />
                )}
              </div>
              {p.latest && (
                <div className="lg:col-span-3">
                  <BarList
                    title={`Employer cost by department (${p.latest.month})`}
                    valueLabel="Employer cost (LKR)"
                    data={p.latest.byDepartment.map((x) => ({
                      label: x.department,
                      value: approx(x.employerCost),
                      display: lkr(x.employerCost),
                    }))}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
