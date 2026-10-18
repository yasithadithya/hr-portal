'use client';

import { Check, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { fmtDate, fmtMinutes, fmtTime, useTenantTz } from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { formatRange, unitLabel } from '@/components/leave/leave-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useApproveOt, useDecideCorrection, useRegInbox } from '@/lib/queries/attendance';
import { useDecide, useInbox } from '@/lib/queries/leave';
import {
  useApprovalsSummary,
  useDecideProfileChange,
  usePendingOt,
  usePendingProfileChanges,
} from '@/lib/queries/notifications';

function Item({
  title,
  meta,
  children,
  onApprove,
  onReject,
  busy,
  testId,
}: {
  title: ReactNode;
  meta: ReactNode;
  children?: ReactNode;
  onApprove: () => void;
  onReject?: () => void;
  busy: boolean;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1">
          <div className="font-medium">{title}</div>
          <div className="text-muted-foreground text-sm">{meta}</div>
          {children}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={onApprove}>
            <Check /> Approve
          </Button>
          {onReject && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              <X /> Reject
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        {title} <Badge variant="secondary">{count}</Badge>
      </h2>
      {children}
    </section>
  );
}

function OtItem({
  d,
}: {
  d: { dayId: string; employeeName: string; date: string; otMinutes: number };
}) {
  const approve = useApproveOt();
  const [mins, setMins] = useState(String(d.otMinutes));
  return (
    <Item
      title={d.employeeName}
      meta={`${fmtDate(d.date)} · ${fmtMinutes(d.otMinutes)} overtime`}
      busy={approve.isPending}
      onApprove={() => approve.mutate({ id: d.dayId, approvedMinutes: Number(mins) })}
      onReject={() => approve.mutate({ id: d.dayId, approvedMinutes: 0 })}
    >
      <label className="flex items-center gap-2 text-sm">
        Approve
        <Input
          aria-label={`Minutes for ${d.employeeName}`}
          className="h-8 w-20"
          type="number"
          min={0}
          max={d.otMinutes}
          value={mins}
          onChange={(e) => setMins(e.target.value)}
        />
        minutes
      </label>
    </Item>
  );
}

export default function ApprovalsPage() {
  const tz = useTenantTz();
  const { can } = useAuth();
  const canLeave = can('leave.approve', 'team');
  const canAtt = can('attendance.approve', 'team');
  const canProfile = can('employees.update', 'all');
  const summary = useApprovalsSummary();
  const leave = useInbox(canLeave);
  const regs = useRegInbox();
  const ot = usePendingOt(canAtt && (summary.data?.overtime ?? 0) > 0);
  const profiles = usePendingProfileChanges(canProfile);
  const decideLeave = useDecide();
  const decideReg = useDecideCorrection();
  const decideProfile = useDecideProfileChange();
  const s = summary.data;

  return (
    <RequirePermission
      permission={['leave.approve', 'attendance.approve', 'employees.update']}
      scope="team"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Approvals" description="Everything waiting for your decision." />
        {s && s.total === 0 && (
          <p className="text-muted-foreground" data-testid="approvals-empty">
            Nothing waiting for you.
          </p>
        )}

        <Section title="Leave" count={canLeave ? (leave.data?.length ?? 0) : 0}>
          {leave.data?.map((r) => (
            <Item
              key={r.id}
              testId={`approval-leave-${r.employeeNo}`}
              title={`${r.employeeName} · ${r.leaveType.name}`}
              meta={`${formatRange(r)} · ${unitLabel(r.leaveType.unit, r.amount)}${r.reason ? ` · ${r.reason}` : ''}`}
              busy={decideLeave.isPending}
              onApprove={() => decideLeave.mutate({ id: r.id, action: 'approve' })}
              onReject={() => decideLeave.mutate({ id: r.id, action: 'reject' })}
            />
          ))}
        </Section>

        <Section title="Attendance corrections" count={canAtt ? (regs.data?.length ?? 0) : 0}>
          {regs.data?.map((r) => (
            <Item
              key={r.id}
              testId={`approval-reg-${r.employeeNo}`}
              title={`${r.employeeName} · ${fmtDate(r.date)}`}
              meta={`${r.requestedIn ? `In ${fmtTime(r.requestedIn, tz)} ` : ''}${r.requestedOut ? `Out ${fmtTime(r.requestedOut, tz)}` : ''} · ${r.reason}`}
              busy={decideReg.isPending}
              onApprove={() => decideReg.mutate({ id: r.id, action: 'approve' })}
              onReject={() => decideReg.mutate({ id: r.id, action: 'reject' })}
            />
          ))}
        </Section>

        <Section title="Overtime" count={ot.data?.length ?? 0}>
          {ot.data?.map((d) => (
            <OtItem key={d.dayId} d={d} />
          ))}
        </Section>

        <Section title="Profile changes" count={canProfile ? (profiles.data?.length ?? 0) : 0}>
          {profiles.data?.map((c) => (
            <Item
              key={c.id}
              testId={`approval-profile-${c.employeeNo}`}
              title={`${c.employeeName} · ${c.section}`}
              meta={Object.entries(c.changes)
                .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
                .join('; ')}
              busy={decideProfile.isPending}
              onApprove={() => decideProfile.mutate({ id: c.id, action: 'approve' })}
              onReject={() => decideProfile.mutate({ id: c.id, action: 'reject' })}
            />
          ))}
        </Section>
      </div>
    </RequirePermission>
  );
}
