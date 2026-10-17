import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { Badge, Modal, EmptyRow, FilterBar, Field, formatDate, formatMoney } from './hrShared';
import PayslipModal from './PayslipModal';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select, Textarea } from '@/ui';
type Section = 'profile' | 'attendance' | 'leaves' | 'payslips' | 'reviews' | 'trainings';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function MyHRView() {
  const now = new Date();
  const [section, setSection] = useState<Section>('profile');
  const [profile, setProfile] = useState<any>(null);
  const [notLinked, setNotLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<any[]>([]);

  // Attendance
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1);
  const [attYear, setAttYear] = useState(now.getFullYear());
  const [attendance, setAttendance] = useState<any[]>([]);
  const [clockLoading, setClockLoading] = useState(false);

  // Leaves
  const [balances, setBalances] = useState<any[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [cancelId, setCancelId] = useState<string | null>(null);

  // Payslips
  const [payslips, setPayslips] = useState<any[]>([]);
  const [viewPayslipId, setViewPayslipId] = useState<string | null>(null);

  // Reviews & trainings
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [ackId, setAckId] = useState<string | null>(null);
  const [ackComments, setAckComments] = useState('');
  const [viewAppraisal, setViewAppraisal] = useState<any | null>(null);

  useEffect(() => {
    hrService.getMyProfile().then(res => {
      if (res.success) setProfile(res.data);
    }).catch((err: any) => {
      if (/linked/i.test(err.message || '')) setNotLinked(true);
      else toast.error(err.message || 'Error loading profile');
    }).finally(() => setLoading(false));

    hrService.getMyAnnouncements().then(res => {
      if (res.success) setAnnouncements(res.data || []);
    }).catch(() => {});
  }, []);

  const fetchAttendance = useCallback(() => {
    hrService.getMyAttendance({ month: attMonth, year: attYear }).then(res => {
      if (res.success) setAttendance(res.data || []);
    }).catch(() => {});
  }, [attMonth, attYear]);

  const fetchLeaves = useCallback(() => {
    Promise.all([
      hrService.getMyLeaveBalance(),
      hrService.getMyLeaveRequests({ limit: 25 }),
      hrService.getLeaveTypes().catch(() => null),
    ]).then(([balRes, reqRes, typesRes]) => {
      if (balRes?.success) setBalances(balRes.data || []);
      if (reqRes?.success) setLeaveRequests(reqRes.data?.requests || []);
      if (typesRes?.success) setLeaveTypes(typesRes.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (notLinked || !profile) return;
    if (section === 'attendance') fetchAttendance();
    if (section === 'leaves') fetchLeaves();
    if (section === 'payslips') {
      hrService.getMyPayslips({ limit: 24 }).then(res => {
        if (res.success) setPayslips(res.data?.runs || []);
      }).catch(() => {});
    }
    if (section === 'reviews') {
      hrService.getMyAppraisals().then(res => {
        if (res.success) setAppraisals(res.data || []);
      }).catch(() => {});
    }
    if (section === 'trainings') {
      hrService.getMyTrainings().then(res => {
        if (res.success) setTrainings(res.data || []);
      }).catch(() => {});
    }
  }, [section, profile, notLinked, fetchAttendance, fetchLeaves]);

  const clock = async (dir: 'in' | 'out') => {
    setClockLoading(true);
    try {
      if (dir === 'in') await hrService.myClockIn();
      else await hrService.myClockOut();
      toast.success(dir === 'in' ? 'Clocked in' : 'Clocked out');
      fetchAttendance();
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setClockLoading(false);
    }
  };

  const applyLeave = async () => {
    const f = applyForm;
    if (!f.leaveType || !f.startDate || !f.endDate) return toast.warn('Leave type and dates are required');
    try {
      await hrService.submitMyLeaveRequest(f);
      toast.success('Leave request submitted');
      setApplyOpen(false);
      setApplyForm({ leaveType: '', startDate: '', endDate: '', reason: '' });
      fetchLeaves();
    } catch (err: any) {
      toast.error(err.message || 'Error submitting request');
    }
  };

  const cancelLeave = async () => {
    if (!cancelId) return;
    try {
      await hrService.cancelMyLeaveRequest(cancelId);
      toast.success('Request cancelled');
      setCancelId(null);
      fetchLeaves();
    } catch (err: any) {
      toast.error(err.message || 'Error cancelling request');
      setCancelId(null);
    }
  };

  const acknowledge = async () => {
    if (!ackId) return;
    try {
      await hrService.acknowledgeMyAppraisal(ackId, ackComments || undefined);
      toast.success('Appraisal acknowledged');
      setAckId(null);
      setAckComments('');
      const res = await hrService.getMyAppraisals();
      if (res.success) setAppraisals(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error');
    }
  };

  if (loading) return <p className={s.mutedNote}>Loading your HR profile...</p>;

  if (notLinked) {
    return (
      <div className={`${s.card} ${s.emptyState}`}>
        <h3 className={s.sectionTitle}>No employee profile linked</h3>
        <p className={s.mutedNote}>
          Your login account is not linked to an employee record yet. Ask your HR administrator to link your account from the employee form.
        </p>
      </div>
    );
  }

  if (!profile) return <p className={s.mutedNote}>Could not load your profile.</p>;

  const sections: [Section, string][] = [
    ['profile', 'My Profile'],
    ['attendance', 'My Attendance'],
    ['leaves', 'My Leaves'],
    ['payslips', 'My Payslips'],
    ['reviews', 'My Reviews'],
    ['trainings', 'My Trainings'],
  ];

  return (
    <div>
      {announcements.length > 0 && (
        <div className={s.announceStrip}>
          {announcements.slice(0, 3).map(a => (
            <div key={a._id} className={s.announceRow}>
              {a.priority !== 'Normal' && <Badge status={a.priority} />}
              <span className={s.cellStrong}>{a.title}</span>
              <span className={s.cellSubInline}>{a.body?.length > 100 ? `${a.body.slice(0, 100)}…` : a.body}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`${s.sectionSwitch} ${s.spacedLg}`}>
        {sections.map(([id, label]) => (
          <button key={id} className={`${s.sectionBtn} ${section === id ? s.sectionBtnActive : ''}`} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {section === 'profile' && (
        <div className={`${s.card} ${s.profileCard}`}>
          <div className={s.profileHead}>
            {profile.profilePhotoUrl ? (
              <img src={profile.profilePhotoUrl} alt="Profile" className={s.avatar} />
            ) : (
              <div className={s.avatar}>{profile.firstName?.[0]}{profile.lastName?.[0]}</div>
            )}
            <div>
              <h3 className={s.profileName}>{profile.firstName} {profile.lastName}</h3>
              <p className={s.mutedNote}>
                {profile.employeeId} · {profile.jobTitle?.title || 'No title'} · {profile.department?.name || 'No department'}
              </p>
            </div>
          </div>
          <div className={s.profileGrid}>
            <div><strong>Company Email:</strong> {profile.companyEmail}</div>
            <div><strong>Phone:</strong> {profile.phone || '—'}</div>
            <div><strong>Employment Type:</strong> {profile.employmentType || '—'}</div>
            <div><strong>Status:</strong> <Badge status={profile.employmentStatus} /></div>
            <div><strong>Joined:</strong> {formatDate(profile.joinedDate)}</div>
            <div><strong>Reports To:</strong> {profile.reportsTo ? `${profile.reportsTo.firstName} ${profile.reportsTo.lastName}` : '—'}</div>
          </div>
        </div>
      )}

      {section === 'attendance' && (
        <div>
          <FilterBar>
            <Button variant="primary"  onClick={() => clock('in')} disabled={clockLoading}>Clock In</Button>
            <Button variant="secondary"  onClick={() => clock('out')} disabled={clockLoading}>Clock Out</Button>
            <div className="spacer" />
            <Field label="Month" className={s.filterField}>
              <Select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Year" className={s.filterField}>
              <Select value={attYear} onChange={e => setAttYear(Number(e.target.value))}>
                {Array.from({ length: 3 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
          </FilterBar>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map(log => (
                  <tr key={log._id}>
                    <td className={s.cellStrong}>{formatDate(log.date)}</td>
                    <td>{log.clockIn ? new Date(log.clockIn).toLocaleTimeString() : '-'}</td>
                    <td>{log.clockOut ? new Date(log.clockOut).toLocaleTimeString() : '-'}</td>
                    <td>{log.workedHours ? log.workedHours.toFixed(2) : '-'}</td>
                    <td><Badge status={log.status} /></td>
                  </tr>
                ))}
                {attendance.length === 0 && <EmptyRow colSpan={5} text="No attendance records for this period." />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'leaves' && (
        <div>
          <div className={s.summaryCards}>
            {balances.map(b => {
              const remaining = (b.totalDays ?? 0) - (b.usedDays ?? 0) - (b.pendingDays ?? 0);
              return (
                <div key={b._id} className={s.summaryCard}>
                  <div className={`${s.summaryValue} ${remaining <= 0 ? s.textDanger : ''}`}>{remaining}</div>
                  <div className={s.summaryLabel}>{b.leaveType?.name} left</div>
                  <div className={`${s.entityMeta} ${s.flush}`}>{b.usedDays} used · {b.pendingDays} pending</div>
                </div>
              );
            })}
          </div>

          <div className={s.topBar}>
            <h4 className={s.sectionTitle}>My Leave Requests</h4>
            <button className={s.addBtn} onClick={() => setApplyOpen(true)}>+ Apply for Leave</button>
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leaveRequests.map(req => (
                  <tr key={req._id}>
                    <td className={s.cellStrong}>{req.leaveType?.name}</td>
                    <td>{formatDate(req.startDate)} → {formatDate(req.endDate)}</td>
                    <td>{req.totalDays}</td>
                    <td>
                      <Badge status={req.status} />
                      {req.status === 'Rejected' && req.rejectionReason && (
                        <span className={`${s.cellSub} ${s.textDanger}`}>{req.rejectionReason}</span>
                      )}
                    </td>
                    <td className={s.alignRight}>
                      {req.status === 'Pending' && (
                        <div className={s.actionRow}>
                          <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setCancelId(req._id)}>Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {leaveRequests.length === 0 && <EmptyRow colSpan={5} text="No leave requests yet." />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'payslips' && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Gross</th>
                <th>Deductions</th>
                <th>Net Pay</th>
                <th>Status</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map(run => (
                <tr key={run._id}>
                  <td className={s.cellStrong}>{MONTH_NAMES[run.month - 1]} {run.year}</td>
                  <td>{formatMoney(run.grossSalary)}</td>
                  <td>{formatMoney(run.totalDeductions)}</td>
                  <td className={s.cellStrong}>{formatMoney(run.netSalary)}</td>
                  <td><Badge status={run.status} /></td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => setViewPayslipId(run._id)}>View</button>
                    </div>
                  </td>
                </tr>
              ))}
              {payslips.length === 0 && <EmptyRow colSpan={6} text="No payslips available yet." />}
            </tbody>
          </table>
        </div>
      )}

      {section === 'reviews' && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Cycle</th>
                <th>Reviewer</th>
                <th>Overall</th>
                <th>Status</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appraisals.map(a => (
                <tr key={a._id}>
                  <td className={s.cellStrong}>{a.cycle?.name}</td>
                  <td>{a.reviewer?.firstName} {a.reviewer?.lastName}</td>
                  <td className={s.cellStrong}>{a.overallRating ? `${a.overallRating} / 5` : '—'}</td>
                  <td><Badge status={a.status} /></td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => setViewAppraisal(a)}>View</button>
                      {a.status === 'Submitted' && (
                        <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => setAckId(a._id)}>Acknowledge</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {appraisals.length === 0 && <EmptyRow colSpan={5} text="No published reviews yet." />}
            </tbody>
          </table>
        </div>
      )}

      {section === 'trainings' && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Program</th>
                <th>Session Date</th>
                <th>Trainer</th>
                <th>Status</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {trainings.map(en => (
                <tr key={en._id}>
                  <td className={s.cellStrong}>{en.session?.program?.name || '—'}</td>
                  <td>{formatDate(en.session?.startDate)}</td>
                  <td>{en.session?.trainer || '—'}</td>
                  <td><Badge status={en.status} /></td>
                  <td>{en.result || (en.score != null ? `Score: ${en.score}` : '—')}</td>
                </tr>
              ))}
              {trainings.length === 0 && <EmptyRow colSpan={5} text="No training enrollments." />}
            </tbody>
          </table>
        </div>
      )}

      {applyOpen && (
        <Modal
          title="Apply for Leave"
          size="narrow"
          onClose={() => setApplyOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setApplyOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={applyLeave}>Submit</Button>
            </>
          }
        >
          <Field label="Leave Type" required>
            <Select value={applyForm.leaveType} onChange={e => setApplyForm({ ...applyForm, leaveType: e.target.value })}>
              <option value="">Select</option>
              {(leaveTypes.length ? leaveTypes : balances.map(b => b.leaveType).filter(Boolean)).map((t: any) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <div className={s.modalGrid}>
            <Field label="Start Date" required>
              <Input type="date" value={applyForm.startDate} onChange={e => setApplyForm({ ...applyForm, startDate: e.target.value })} />
            </Field>
            <Field label="End Date" required>
              <Input type="date" value={applyForm.endDate} onChange={e => setApplyForm({ ...applyForm, endDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Reason">
            <Textarea rows={2} value={applyForm.reason} onChange={e => setApplyForm({ ...applyForm, reason: e.target.value })} />
          </Field>
        </Modal>
      )}

      {ackId && (
        <Modal
          title="Acknowledge Appraisal"
          size="narrow"
          onClose={() => setAckId(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAckId(null)}>Cancel</Button>
              <Button variant="primary" onClick={acknowledge}>Acknowledge</Button>
            </>
          }
        >
          <p className={`${s.mutedNote} ${s.spaced}`}>
            Acknowledging confirms you have read this review. You can optionally add your comments.
          </p>
          <Field label="Your Comments (optional)">
            <Textarea rows={3} value={ackComments} onChange={e => setAckComments(e.target.value)} />
          </Field>
        </Modal>
      )}

      {viewAppraisal && (
        <Modal title={`Review — ${viewAppraisal.cycle?.name}`} onClose={() => setViewAppraisal(null)}>
          <div className={`${s.tableWrap} ${s.spaced}`}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Criteria</th>
                  <th>Rating</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {(viewAppraisal.ratings || []).map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.criteria}</td>
                    <td className={s.cellStrong}>{r.rating} / 5</td>
                    <td>{r.comments || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {viewAppraisal.strengths && <p className={s.detailPara}><strong>Strengths:</strong> {viewAppraisal.strengths}</p>}
          {viewAppraisal.areasForImprovement && <p className={s.detailPara}><strong>Areas for improvement:</strong> {viewAppraisal.areasForImprovement}</p>}
          {viewAppraisal.reviewerComments && <p className={s.detailPara}><strong>Reviewer comments:</strong> {viewAppraisal.reviewerComments}</p>}
        </Modal>
      )}

      {viewPayslipId && <PayslipModal runId={viewPayslipId} selfService onClose={() => setViewPayslipId(null)} />}

      <ConfirmDialog
        open={!!cancelId}
        title="Cancel Leave Request"
        message="Cancel this pending leave request? Your pending balance will be restored."
        confirmText="Cancel Request"
        destructive
        onCancel={() => setCancelId(null)}
        onConfirm={cancelLeave}
      />
    </div>
  );
}
