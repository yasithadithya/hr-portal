import { useState, useEffect, type ReactNode } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { LoadingBlock, ErrorState, Section, StatCard, StatGrid } from '@/ui';
import { Badge, formatMoney, formatDate } from './hrShared';
import s from './hr.module.css';

/** 4825000 -> "4.83M": keeps large amounts inside a stat tile; the exact figure goes in the hint. */
const compactNumber = (v?: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v ?? 0);

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title} padding="md" className={s.infoCard}>
      {children}
    </Section>
  );
}

export default function HRDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hrService.getDashboardStats().then(res => {
      if (res.success) setStats(res.data);
    }).catch((err: any) => {
      toast.error(err.message || 'Error loading dashboard');
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock label="Loading HR overview…" />;
  if (!stats) return <ErrorState title="HR overview unavailable" message="The dashboard figures could not be loaded. Try again in a moment." />;

  const presentToday = stats.attendanceToday?.Present || 0;
  const maxDeptCount = Math.max(1, ...(stats.departmentDistribution || []).map((d: any) => d.count));

  return (
    <div>
      <div className={s.spacedLg}>
      <StatGrid>
        <StatCard label="Headcount" value={stats.headcount?.total ?? 0} hint={`${stats.headcount?.byStatus?.Active ?? 0} active · ${stats.headcount?.byStatus?.OnProbation ?? 0} on probation`} />
        <StatCard label="Present today" value={presentToday} hint={`${stats.attendanceToday?.OnLeave || 0} on leave · ${stats.attendanceToday?.Absent || 0} absent`} />
        <StatCard label="Pending leaves" tone={(stats.pendingLeaves?.count ?? 0) > 0 ? 'warning' : 'neutral'} value={stats.pendingLeaves?.count ?? 0} hint="awaiting approval" />
        <StatCard label="Payroll this month" value={`Rs. ${compactNumber(stats.payrollSummary?.totalNetSalary)}`} hint={`${formatMoney(stats.payrollSummary?.totalNetSalary)} · ${stats.payrollSummary?.totalEmployees ?? 0} records`} />
      </StatGrid>
      </div>

      <div className={s.infoGrid}>
        <InfoCard title="Department distribution">
          {(stats.departmentDistribution || []).map((d: any) => (
            <div key={d.department} className={s.distRow}>
              <div className={s.distHead}>
                <span>{d.department}</span>
                <span className={s.cellStrong}>{d.count}</span>
              </div>
              <div className={s.progressTrack}>
                <div className={s.progressFill} style={{ width: `${(d.count / maxDeptCount) * 100}%` }} />
              </div>
            </div>
          ))}
          {(!stats.departmentDistribution || stats.departmentDistribution.length === 0) && <p className={s.mutedNote}>No data.</p>}
        </InfoCard>

        <InfoCard title="Pending leave requests">
          {(stats.pendingLeaves?.latest || []).map((req: any) => (
            <div key={req._id} className={s.infoRow}>
              <div>
                <div className={s.cellStrong}>{req.employee?.firstName} {req.employee?.lastName}</div>
                <div className={`${s.entityMeta} ${s.flush}`}>{req.leaveType?.name} · {formatDate(req.startDate)} → {formatDate(req.endDate)} ({req.totalDays}d)</div>
              </div>
              <Badge status="Pending" />
            </div>
          ))}
          {(!stats.pendingLeaves?.latest || stats.pendingLeaves.latest.length === 0) && <p className={s.mutedNote}>No pending requests.</p>}
        </InfoCard>

        <InfoCard title="Announcements">
          {(stats.announcements || []).map((a: any) => (
            <div key={a._id} className={`${s.infoRow} ${s.infoRowStack}`}>
              <div className={s.distHead}>
                <span className={s.cellStrong}>{a.title}</span>
                {a.priority !== 'Normal' && <Badge status={a.priority} />}
              </div>
              <p className={`${s.entityMeta} ${s.flush}`}>{a.body?.length > 120 ? `${a.body.slice(0, 120)}…` : a.body}</p>
            </div>
          ))}
          {(!stats.announcements || stats.announcements.length === 0) && <p className={s.mutedNote}>No active announcements.</p>}
        </InfoCard>

        <InfoCard title="Birthdays · next 30 days">
          {(stats.upcomingBirthdays || []).map((b: any) => (
            <div key={b._id} className={s.infoRow}>
              <span>{b.firstName} {b.lastName}</span>
              <span className={s.mutedNote}>{b.inDays === 0 ? 'Today' : `in ${b.inDays}d (${formatDate(b.date)})`}</span>
            </div>
          ))}
          {(!stats.upcomingBirthdays || stats.upcomingBirthdays.length === 0) && <p className={s.mutedNote}>None in the next 30 days.</p>}
        </InfoCard>

        <InfoCard title="Work anniversaries · next 30 days">
          {(stats.upcomingAnniversaries || []).map((a: any) => (
            <div key={a._id} className={s.infoRow}>
              <span>{a.firstName} {a.lastName}</span>
              <span className={s.mutedNote}>{a.years} yr{a.years === 1 ? '' : 's'} · {a.inDays === 0 ? 'Today' : `in ${a.inDays}d`}</span>
            </div>
          ))}
          {(!stats.upcomingAnniversaries || stats.upcomingAnniversaries.length === 0) && <p className={s.mutedNote}>None in the next 30 days.</p>}
        </InfoCard>

        <InfoCard title="Documents expiring · next 60 days">
          {(stats.expiringDocuments || []).map((doc: any) => (
            <div key={doc._id} className={s.infoRow}>
              <span>
                {doc.title}
                <span className={`${s.entityMeta} ${s.flush} ${s.block}`}>{doc.employee?.firstName} {doc.employee?.lastName} · {doc.category}</span>
              </span>
              <span className={s.textDanger}>{formatDate(doc.expiryDate)}</span>
            </div>
          ))}
          {(!stats.expiringDocuments || stats.expiringDocuments.length === 0) && <p className={s.mutedNote}>No documents expiring soon.</p>}
        </InfoCard>
      </div>
    </div>
  );
}
