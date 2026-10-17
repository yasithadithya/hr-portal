import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, Badge, Modal, EmptyRow, Field, formatDate } from './hrShared';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select, Textarea } from '@/ui';
export default function TrainingView() {
  const [programs, setPrograms] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [programFilter, setProgramFilter] = useState('');

  const [programForm, setProgramForm] = useState<{ open: boolean; editing: any | null; name: string; description: string; category: string; provider: string; durationHours: number }>({ open: false, editing: null, name: '', description: '', category: '', provider: '', durationHours: 0 });
  const [sessionForm, setSessionForm] = useState<{ open: boolean; editing: any | null; program: string; startDate: string; endDate: string; trainer: string; location: string; capacity: number; status: string }>({ open: false, editing: null, program: '', startDate: '', endDate: '', trainer: '', location: '', capacity: 0, status: 'Scheduled' });
  const [deleteProgramId, setDeleteProgramId] = useState<string | null>(null);

  // Enrollment drawer state
  const [enrollSession, setEnrollSession] = useState<any | null>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [enrollEmployeeId, setEnrollEmployeeId] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [progRes, sessRes, empRes] = await Promise.all([
        hrService.getTrainingPrograms(),
        hrService.getTrainingSessions({ programId: programFilter || undefined }),
        hrService.getEmployees({ limit: 100, status: 'Active' }),
      ]);
      if (progRes.success) setPrograms(progRes.data || []);
      if (sessRes.success) setSessions(sessRes.data || []);
      if (empRes.success) setEmployees(empRes.data?.employees || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading training data');
    } finally {
      setLoading(false);
    }
  }, [programFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchEnrollments = useCallback(async (sessionId: string) => {
    try {
      const res = await hrService.getSessionEnrollments(sessionId);
      if (res.success) setEnrollments(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading enrollments');
    }
  }, []);

  useEffect(() => {
    if (enrollSession) fetchEnrollments(enrollSession._id);
  }, [enrollSession, fetchEnrollments]);

  const saveProgram = async () => {
    const f = programForm;
    if (!f.name.trim()) return toast.warn('Program name is required');
    const payload = { name: f.name.trim(), description: f.description, category: f.category, provider: f.provider, durationHours: f.durationHours || undefined };
    try {
      if (f.editing) {
        await hrService.updateTrainingProgram(f.editing._id, payload);
        toast.success('Program updated');
      } else {
        await hrService.createTrainingProgram(payload);
        toast.success('Program created');
      }
      setProgramForm({ ...f, open: false });
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Error saving program');
    }
  };

  const deleteProgram = async () => {
    if (!deleteProgramId) return;
    try {
      await hrService.deleteTrainingProgram(deleteProgramId);
      toast.success('Program deleted');
      setDeleteProgramId(null);
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
      setDeleteProgramId(null);
    }
  };

  const saveSession = async () => {
    const f = sessionForm;
    if (!f.program || !f.startDate) return toast.warn('Program and start date are required');
    const payload: any = { program: f.program, startDate: f.startDate, trainer: f.trainer, location: f.location, status: f.status };
    if (f.endDate) payload.endDate = f.endDate;
    if (f.capacity > 0) payload.capacity = f.capacity;
    try {
      if (f.editing) {
        await hrService.updateTrainingSession(f.editing._id, payload);
        toast.success('Session updated');
      } else {
        await hrService.createTrainingSession(payload);
        toast.success('Session scheduled');
      }
      setSessionForm({ ...f, open: false });
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Error saving session');
    }
  };

  const enroll = async () => {
    if (!enrollSession || !enrollEmployeeId) return toast.warn('Select an employee');
    try {
      await hrService.enrollInSession(enrollSession._id, enrollEmployeeId);
      toast.success('Employee enrolled');
      setEnrollEmployeeId('');
      fetchEnrollments(enrollSession._id);
    } catch (err: any) {
      toast.error(err.message || 'Error enrolling employee');
    }
  };

  const setEnrollmentStatus = async (enrollment: any, status: string) => {
    try {
      await hrService.updateEnrollment(enrollment._id, { status });
      toast.success('Enrollment updated');
      fetchEnrollments(enrollSession!._id);
    } catch (err: any) {
      toast.error(err.message || 'Error updating enrollment');
    }
  };

  const removeEnrollment = async (id: string) => {
    try {
      await hrService.deleteEnrollment(id);
      toast.success('Enrollment removed');
      fetchEnrollments(enrollSession!._id);
    } catch (err: any) {
      toast.error(err.message || 'Error removing enrollment');
    }
  };

  return (
    <div>
      <PageHeader
        title="Training"
        subtitle="Programs, sessions, and enrollments"
        action={<button className={s.addBtn} onClick={() => setProgramForm({ open: true, editing: null, name: '', description: '', category: '', provider: '', durationHours: 0 })}>+ New Program</button>}
      />

      {loading ? <p className={s.mutedNote}>Loading training data...</p> : (
        <>
          <div className={s.gridAuto}>
            {programs.map(p => (
              <div key={p._id} className={`${s.entityCard} ${p.isActive ? '' : s.inactive}`}>
                <div className={s.entityCardHead}>
                  <div className={s.entityTitle}>{p.name}</div>
                  {!p.isActive && <Badge status="Cancelled" label="Inactive" />}
                </div>
                <p className={s.entityMeta}>
                  {[p.category, p.provider, p.durationHours ? `${p.durationHours}h` : null].filter(Boolean).join(' · ') || '—'}
                </p>
                {p.description && <p className={s.entityDesc}>{p.description}</p>}
                <div className={s.cardActions}>
                  <button className={s.actionBtn} onClick={() => setProgramForm({ open: true, editing: p, name: p.name, description: p.description || '', category: p.category || '', provider: p.provider || '', durationHours: p.durationHours || 0 })}>Edit</button>
                  <button className={s.actionBtn} onClick={() => setSessionForm({ open: true, editing: null, program: p._id, startDate: '', endDate: '', trainer: '', location: '', capacity: 0, status: 'Scheduled' })}>+ Session</button>
                  <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteProgramId(p._id)}>Delete</button>
                </div>
              </div>
            ))}
            {programs.length === 0 && <p className={s.mutedNote}>No training programs yet.</p>}
          </div>

          <div className={s.topBar}>
            <h3 className={s.sectionTitle}>Sessions</h3>
            <Select className={s.inlineControl} value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </Select>
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Dates</th>
                  <th>Trainer</th>
                  <th>Location</th>
                  <th>Capacity</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(sess => (
                  <tr key={sess._id}>
                    <td className={s.cellStrong}>{sess.program?.name}</td>
                    <td>{formatDate(sess.startDate)}{sess.endDate ? ` → ${formatDate(sess.endDate)}` : ''}</td>
                    <td>{sess.trainer || '—'}</td>
                    <td>{sess.location || '—'}</td>
                    <td>{sess.capacity || 'Unlimited'}</td>
                    <td><Badge status={sess.status} /></td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        <button className={s.actionBtn} onClick={() => setEnrollSession(sess)}>Enrollments</button>
                        <button className={s.actionBtn} onClick={() => setSessionForm({ open: true, editing: sess, program: sess.program?._id || sess.program, startDate: sess.startDate?.split('T')[0] || '', endDate: sess.endDate?.split('T')[0] || '', trainer: sess.trainer || '', location: sess.location || '', capacity: sess.capacity || 0, status: sess.status })}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && <EmptyRow colSpan={7} text="No sessions scheduled." />}
              </tbody>
            </table>
          </div>
        </>
      )}

      {programForm.open && (
        <Modal
          title={programForm.editing ? 'Edit Program' : 'New Training Program'}
          onClose={() => setProgramForm({ ...programForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setProgramForm({ ...programForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveProgram}>Save</Button>
            </>
          }
        >
          <Field label="Name" required>
            <Input type="text" value={programForm.name} onChange={e => setProgramForm({ ...programForm, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={programForm.description} onChange={e => setProgramForm({ ...programForm, description: e.target.value })} />
          </Field>
          <div className={`${s.modalGrid} ${s.modalGrid3}`}>
            <Field label="Category">
              <Input type="text" value={programForm.category} onChange={e => setProgramForm({ ...programForm, category: e.target.value })} placeholder="e.g. Safety" />
            </Field>
            <Field label="Provider">
              <Input type="text" value={programForm.provider} onChange={e => setProgramForm({ ...programForm, provider: e.target.value })} />
            </Field>
            <Field label="Hours">
              <Input type="number" min={0} value={programForm.durationHours || ''} onChange={e => setProgramForm({ ...programForm, durationHours: Number(e.target.value) })} />
            </Field>
          </div>
        </Modal>
      )}

      {sessionForm.open && (
        <Modal
          title={sessionForm.editing ? 'Edit Session' : 'Schedule Session'}
          onClose={() => setSessionForm({ ...sessionForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSessionForm({ ...sessionForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveSession}>Save</Button>
            </>
          }
        >
          <Field label="Program" required>
            <Select value={sessionForm.program} onChange={e => setSessionForm({ ...sessionForm, program: e.target.value })}>
              <option value="">Select</option>
              {programs.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
            </Select>
          </Field>
          <div className={s.modalGrid}>
            <Field label="Start Date" required>
              <Input type="date" value={sessionForm.startDate} onChange={e => setSessionForm({ ...sessionForm, startDate: e.target.value })} />
            </Field>
            <Field label="End Date">
              <Input type="date" value={sessionForm.endDate} onChange={e => setSessionForm({ ...sessionForm, endDate: e.target.value })} />
            </Field>
            <Field label="Trainer">
              <Input type="text" value={sessionForm.trainer} onChange={e => setSessionForm({ ...sessionForm, trainer: e.target.value })} />
            </Field>
            <Field label="Location">
              <Input type="text" value={sessionForm.location} onChange={e => setSessionForm({ ...sessionForm, location: e.target.value })} />
            </Field>
            <Field label="Capacity (0 = unlimited)">
              <Input type="number" min={0} value={sessionForm.capacity} onChange={e => setSessionForm({ ...sessionForm, capacity: Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <Select value={sessionForm.status} onChange={e => setSessionForm({ ...sessionForm, status: e.target.value })}>
                {['Scheduled', 'Completed', 'Cancelled'].map(st => <option key={st} value={st}>{st}</option>)}
              </Select>
            </Field>
          </div>
        </Modal>
      )}

      {enrollSession && (
        <Modal title={`Enrollments — ${enrollSession.program?.name} (${formatDate(enrollSession.startDate)})`} onClose={() => { setEnrollSession(null); setEnrollments([]); }} size="wide">
          {enrollSession.status === 'Scheduled' && (
            <div className={`${s.inlineGroup} ${s.spaced}`}>
              <Select className={`${s.inlineControl} ${s.grow}`} value={enrollEmployeeId} onChange={e => setEnrollEmployeeId(e.target.value)}>
                <option value="">-- Select employee to enroll --</option>
                {employees
                  .filter(emp => !enrollments.some(en => en.employee?._id === emp._id && en.status !== 'Cancelled'))
                  .map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</option>)}
              </Select>
              <Button variant="primary"  onClick={enroll}>Enroll</Button>
            </div>
          )}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map(en => (
                  <tr key={en._id}>
                    <td className={s.cellStrong}>
                      {en.employee?.firstName} {en.employee?.lastName}
                      <span className={s.cellSub}>{en.employee?.employeeId}</span>
                    </td>
                    <td>
                      <Badge status={en.status} />
                      {en.completedAt && <span className={s.cellSubInline}>{formatDate(en.completedAt)}</span>}
                    </td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        {en.status === 'Enrolled' && (
                          <>
                            <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => setEnrollmentStatus(en, 'Completed')}>Complete</button>
                            <button className={s.actionBtn} onClick={() => setEnrollmentStatus(en, 'NoShow')}>No-show</button>
                          </>
                        )}
                        <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => removeEnrollment(en._id)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {enrollments.length === 0 && <EmptyRow colSpan={3} text="No enrollments yet." />}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteProgramId}
        title="Delete Training Program"
        message="Delete this program? This is blocked if it has any sessions."
        confirmText="Delete"
        destructive
        onCancel={() => setDeleteProgramId(null)}
        onConfirm={deleteProgram}
      />
    </div>
  );
}
