'use client';

import {
  Bell,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  Receipt,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { ClockCard } from '@/components/attendance/clock-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useBalances } from '@/lib/queries/leave';
import { useApprovalsSummary } from '@/lib/queries/notifications';
import { lkr, useMyPayslips } from '@/lib/queries/payroll';

const THIS_YEAR = new Date().getUTCFullYear();

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 text-center text-sm font-medium"
    >
      <Icon className="text-primary size-6" />
      {label}
    </Link>
  );
}

export default function MeHome() {
  const { me, can } = useAuth();
  const linked = !!me?.employee;
  const balances = useBalances(THIS_YEAR);
  const payslips = useMyPayslips();
  const approver = can('leave.approve', 'team') || can('attendance.approve', 'team');
  const approvals = useApprovalsSummary(approver);
  const latest = payslips.data?.[0];
  const first = me?.employee?.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">{first ? `Hi, ${first}` : 'My HR'}</h1>

      {approver && (approvals.data?.total ?? 0) > 0 && (
        <Link
          href="/approvals"
          className="bg-primary text-primary-foreground flex items-center justify-between rounded-lg px-4 py-3"
          data-testid="me-approvals"
        >
          <span className="flex items-center gap-2">
            <Inbox className="size-5" /> {approvals.data!.total} waiting for your approval
          </span>
          <ChevronRight className="size-5" />
        </Link>
      )}

      {linked && can('attendance.clock') && <ClockCard />}

      <div className="grid gap-5 sm:grid-cols-2">
        {can('leave.apply') && linked && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Leave {THIS_YEAR}</CardTitle>
              <Link href="/leave" className="text-primary text-sm hover:underline">
                Apply
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {!balances.data ? (
                <Skeleton className="h-16" />
              ) : (
                balances.data
                  .filter((b) => b.hasPolicy && (b.entitled > 0 || b.taken > 0))
                  .slice(0, 4)
                  .map((b) => (
                    <div
                      key={b.leaveType.id}
                      className="flex justify-between text-sm"
                      data-testid={`me-balance-${b.leaveType.code}`}
                    >
                      <span>{b.leaveType.name}</span>
                      <span className="font-medium">
                        {b.available} {b.leaveType.unit === 'hour' ? 'h' : 'days'}
                      </span>
                    </div>
                  ))
              )}
              {balances.data?.every((b) => !(b.hasPolicy && (b.entitled > 0 || b.taken > 0))) && (
                <p className="text-muted-foreground text-sm">No leave entitlements set up yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        {can('payslips.read') && linked && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Latest payslip</CardTitle>
              <Link href="/me/payslips" className="text-primary text-sm hover:underline">
                All
              </Link>
            </CardHeader>
            <CardContent>
              {!payslips.data ? (
                <Skeleton className="h-16" />
              ) : latest ? (
                <Link href="/me/payslips" className="block">
                  <div className="text-muted-foreground text-sm">{latest.month}</div>
                  <div className="text-2xl font-semibold">LKR {lkr(latest.net)}</div>
                </Link>
              ) : (
                <p className="text-muted-foreground text-sm">No payslips yet.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {can('leave.apply') && <QuickLink href="/leave" icon={CalendarDays} label="Leave" />}
        {can('attendance.clock') && (
          <QuickLink href="/attendance" icon={Clock} label="Attendance" />
        )}
        {can('payslips.read') && <QuickLink href="/me/payslips" icon={Receipt} label="Payslips" />}
        {linked && <QuickLink href="/me/profile" icon={UserRound} label="Profile" />}
        {linked && can('documents.read') && (
          <QuickLink href="/me/documents" icon={FileText} label="Documents" />
        )}
        <QuickLink href="/me/notifications" icon={Bell} label="Notifications" />
      </div>

      {!linked && (
        <p className="text-muted-foreground text-sm">
          Your account isn’t linked to an employee record, so self-service features are hidden.
        </p>
      )}
    </div>
  );
}
