import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { Badge, Modal, EmptyRow, Field, formatDate } from './hrShared';
import AppraisalForm from './AppraisalForm';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select } from '@/ui';
type Section = 'appraisals' | 'goals' | 'cycles';

export default function PerformanceView() {
  const [section, setSection] = useState<Section>('appraisals');
  const [employees, setEmployees] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cycleFilter, setCycleFilter] = useState('');

  const [cycleForm, setCycleForm] = useState<{ open: boolean; editing: any | null; name: string; type: string; periodStart: string; periodEnd: string; status: string }>({ open: false, editing: null, name: '', type: 'Annual', periodStart: '', periodEnd: '', status: 'Open' });
  const [goalForm, setGoalForm] = useState<{ open: boolean; editing: any | null; employee: string; cycle: string; title: string; kpi: string; targetValue: string; weight: number; progress: number; status: string; dueDate: string }>({ open: false, editing: null, employee: '', cycle: '', title: '', kpi: '', targetValue: '', weight: 0, progress: 0, status: 'NotStarted', dueDate: '' });
  const [appraisalForm, setAppraisalForm] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [viewAppraisal, setViewAppraisal] = useState<any | null>(null);
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);

  const fetchStatic = useCallback(async () => {
    try {
      const [empRes, cycleRes] = await Promise.all([
        hrService.getEmployees({ limit: 100, status: 'Active' }),
        hrService.getReviewCycles(),
      ]);
      if (empRes.success) setEmployees(empRes.data?.employees || []);
      if (cycleRes.success) setCycles(cycleRes.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading data');
    }
  }, []);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, apprRes] = await Promise.all([
        hrService.getGoals({ cycleId: cycleFilter || undefined, limit: 100 }),
        hrService.getAppraisals({ cycleId: cycleFilter || undefined, limit: 100 }),
      ]);
      if (goalsRes.success) setGoals(goalsRes.data?.goals || []);
      if (apprRes.success) setAppraisals(apprRes.data?.appraisals || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [cycleFilter]);

  useEffect(() => { fetchStatic(); }, [fetchStatic]);
  useEffect(() => { fetchLists(); }, [fetchLists]);

  const saveCycle = async () => {
    const { editing, name, type, periodStart, periodEnd, status } = cycleForm;
    if (!name || !periodStart || !periodEnd) return toast.warn('Name and period dates are required');
    try {
      if (editing) {
        await hrService.updateReviewCycle(editing._id, { name, type, periodStart, periodEnd, status });
        toast.success('Cycle updated');
      } else {
        await hrService.createReviewCycle({ name, type, periodStart, periodEnd });
        toast.success('Cycle created');
      }
      setCycleForm({ ...cycleForm, open: false });
      fetchStatic();
    } catch (err: any) {
      toast.error(err.message || 'Error saving cycle');
    }
  };

  const saveGoal = async () => {
    const f = goalForm;
    if (!f.employee || !f.title) return toast.warn('Employee and title are required');
    const payload: any = { employee: f.employee, title: f.title, kpi: f.kpi, targetValue: f.targetValue, weight: f.weight, progress: f.progress, status: f.status };
    if (f.cycle) payload.cycle = f.cycle;
    if (f.dueDate) payload.dueDate = f.dueDate;
    try {
      if (f.editing) {
        await hrService.updateGoal(f.editing._id, payload);
        toast.success('Goal updated');
      } else {
        await hrService.createGoal(payload);
        toast.success('Goal created');
      }
      setGoalForm({ ...f, open: false });
      fetchLists();
    } catch (err: any) {
      toast.error(err.message || 'Error saving goal');
    }
  };

  const deleteGoal = async () => {
    if (!deleteGoalId) return;
    try {
      await hrService.deleteGoal(deleteGoalId);
      toast.success('Goal deleted');
      setDeleteGoalId(null);
      fetchLists();
    } catch (err: any) {
      toast.error(err.message || 'Error deleting goal');
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await hrService.acknowledgeAppraisal(id);
      toast.success('Appraisal acknowledged');
      fetchLists();
    } catch (err: any) {
      toast.error(err.message || 'Error');
    }
  };

  const sections: [Section, string][] = [['appraisals', 'Appraisals'], ['goals', 'Goals & KPIs'], ['cycles', 'Review Cycles']];

  return (
    <div>
      <div className={s.topBar}>
        <div className={s.sectionSwitch}>
          {sections.map(([id, label]) => (
            <button key={id} className={`${s.sectionBtn} ${section === id ? s.sectionBtnActive : ''}`} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className={s.headerActions}>
          {section !== 'cycles' && (
            <Select className={s.inlineControl} value={cycleFilter} onChange={e => setCycleFilter(e.target.value)}>
              <option value="">All cycles</option>
              {cycles.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          )}
          {section === 'cycles' && <button className={s.addBtn} onClick={() => setCycleForm({ open: true, editing: null, name: '', type: 'Annual', periodStart: '', periodEnd: '', status: 'Open' })}>+ New Cycle</button>}
          {section === 'goals' && <button className={s.addBtn} onClick={() => setGoalForm({ open: true, editing: null, employee: '', cycle: cycleFilter, title: '', kpi: '', targetValue: '', weight: 0, progress: 0, status: 'NotStarted', dueDate: '' })}>+ New Goal</button>}
          {section === 'appraisals' && <button className={s.addBtn} onClick={() => setAppraisalForm({ open: true, editing: null })}>+ New Appraisal</button>}
        </div>
      </div>

      {loading ? <p className={s.mutedNote}>Loading...</p> : (
        <div className={s.tableWrap}>
          {section === 'cycles' && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map(c => (
                  <tr key={c._id}>
                    <td className={s.cellStrong}>{c.name}</td>
                    <td>{c.type}</td>
                    <td>{formatDate(c.periodStart)} → {formatDate(c.periodEnd)}</td>
                    <td><Badge status={c.status} /></td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        <button className={s.actionBtn} onClick={() => setCycleForm({ open: true, editing: c, name: c.name, type: c.type, periodStart: c.periodStart?.split('T')[0] || '', periodEnd: c.periodEnd?.split('T')[0] || '', status: c.status })}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {cycles.length === 0 && <EmptyRow colSpan={5} text="No review cycles yet." />}
              </tbody>
            </table>
          )}

          {section === 'goals' && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Goal</th>
                  <th>KPI / Target</th>
                  <th>Weight</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {goals.map(g => (
                  <tr key={g._id}>
                    <td className={s.cellStrong}>{g.employee?.firstName} {g.employee?.lastName}</td>
                    <td>
                      {g.title}
                      {g.cycle?.name && <span className={s.cellSub}>{g.cycle.name}</span>}
                    </td>
                    <td>{g.kpi || '—'}{g.targetValue ? ` / ${g.targetValue}` : ''}</td>
                    <td>{g.weight}%</td>
                    <td className={s.progressCell}>
                      <div className={`${s.progressTrack} ${s.progressSpaced}`}>
                        <div className={s.progressFill} style={{ width: `${g.progress}%` }} />
                      </div>
                      <span className={s.cellSubInline}>{g.progress}%</span>
                    </td>
                    <td><Badge status={g.status} /></td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        <button className={s.actionBtn} onClick={() => setGoalForm({ open: true, editing: g, employee: g.employee?._id || '', cycle: g.cycle?._id || '', title: g.title, kpi: g.kpi || '', targetValue: g.targetValue || '', weight: g.weight || 0, progress: g.progress || 0, status: g.status, dueDate: g.dueDate?.split('T')[0] || '' })}>Edit</button>
                        <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteGoalId(g._id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {goals.length === 0 && <EmptyRow colSpan={7} text="No goals yet." />}
              </tbody>
            </table>
          )}

          {section === 'appraisals' && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Employee</th>
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
                    <td className={s.cellStrong}>{a.employee?.firstName} {a.employee?.lastName}</td>
                    <td>{a.cycle?.name}</td>
                    <td>{a.reviewer?.firstName} {a.reviewer?.lastName}</td>
                    <td className={s.cellStrong}>{a.overallRating ? `${a.overallRating} / 5` : '—'}</td>
                    <td><Badge status={a.status} /></td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        <button className={s.actionBtn} onClick={() => setViewAppraisal(a)}>View</button>
                        {a.status === 'Draft' && <button className={s.actionBtn} onClick={() => setAppraisalForm({ open: true, editing: a })}>Edit</button>}
                        {a.status === 'Submitted' && <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => acknowledge(a._id)}>Acknowledge</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {appraisals.length === 0 && <EmptyRow colSpan={6} text="No appraisals yet." />}
              </tbody>
            </table>
          )}
        </div>
      )}

      {cycleForm.open && (
        <Modal
          title={cycleForm.editing ? 'Edit Review Cycle' : 'New Review Cycle'}
          onClose={() => setCycleForm({ ...cycleForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCycleForm({ ...cycleForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveCycle}>Save</Button>
            </>
          }
        >
          <Field label="Name" required>
            <Input type="text" value={cycleForm.name} onChange={e => setCycleForm({ ...cycleForm, name: e.target.value })} placeholder="e.g. Annual Review 2026" />
          </Field>
          <div className={s.modalGrid}>
            <Field label="Type">
              <Select value={cycleForm.type} onChange={e => setCycleForm({ ...cycleForm, type: e.target.value })}>
                {['Annual', 'SemiAnnual', 'Quarterly', 'Probation'].map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            {cycleForm.editing && (
              <Field label="Status">
                <Select value={cycleForm.status} onChange={e => setCycleForm({ ...cycleForm, status: e.target.value })}>
                  <option value="Open">Open</option>
                  <option value="Closed">Closed</option>
                </Select>
              </Field>
            )}
            <Field label="Period Start" required>
              <Input type="date" value={cycleForm.periodStart} onChange={e => setCycleForm({ ...cycleForm, periodStart: e.target.value })} />
            </Field>
            <Field label="Period End" required>
              <Input type="date" value={cycleForm.periodEnd} onChange={e => setCycleForm({ ...cycleForm, periodEnd: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {goalForm.open && (
        <Modal
          title={goalForm.editing ? 'Edit Goal' : 'New Goal'}
          onClose={() => setGoalForm({ ...goalForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setGoalForm({ ...goalForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveGoal}>Save</Button>
            </>
          }
        >
          <div className={s.modalGrid}>
            <Field label="Employee" required>
              <Select value={goalForm.employee} onChange={e => setGoalForm({ ...goalForm, employee: e.target.value })}>
                <option value="">Select</option>
                {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName}</option>)}
              </Select>
            </Field>
            <Field label="Cycle">
              <Select value={goalForm.cycle} onChange={e => setGoalForm({ ...goalForm, cycle: e.target.value })}>
                <option value="">None</option>
                {cycles.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Title" required>
            <Input type="text" value={goalForm.title} onChange={e => setGoalForm({ ...goalForm, title: e.target.value })} />
          </Field>
          <div className={s.modalGrid}>
            <Field label="KPI">
              <Input type="text" value={goalForm.kpi} onChange={e => setGoalForm({ ...goalForm, kpi: e.target.value })} placeholder="e.g. Inspections completed" />
            </Field>
            <Field label="Target">
              <Input type="text" value={goalForm.targetValue} onChange={e => setGoalForm({ ...goalForm, targetValue: e.target.value })} placeholder="e.g. 50 per quarter" />
            </Field>
            <Field label="Weight %">
              <Input type="number" min={0} max={100} value={goalForm.weight} onChange={e => setGoalForm({ ...goalForm, weight: Number(e.target.value) })} />
            </Field>
            <Field label="Progress %">
              <Input type="number" min={0} max={100} value={goalForm.progress} onChange={e => setGoalForm({ ...goalForm, progress: Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <Select value={goalForm.status} onChange={e => setGoalForm({ ...goalForm, status: e.target.value })}>
                {['NotStarted', 'InProgress', 'Completed', 'Cancelled'].map(st => <option key={st} value={st}>{st}</option>)}
              </Select>
            </Field>
            <Field label="Due Date">
              <Input type="date" value={goalForm.dueDate} onChange={e => setGoalForm({ ...goalForm, dueDate: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {appraisalForm.open && (
        <AppraisalForm
          appraisal={appraisalForm.editing}
          employees={employees}
          cycles={cycles.filter(c => c.status === 'Open' || appraisalForm.editing)}
          onClose={() => setAppraisalForm({ open: false, editing: null })}
          onSaved={() => { setAppraisalForm({ open: false, editing: null }); fetchLists(); }}
        />
      )}

      {viewAppraisal && (
        <Modal title={`Appraisal — ${viewAppraisal.employee?.firstName} ${viewAppraisal.employee?.lastName}`} onClose={() => setViewAppraisal(null)} size="wide">
          <div className={`${s.inlineGroup} ${s.spaced}`}>
            <span><strong>Cycle:</strong> {viewAppraisal.cycle?.name}</span>
            <span><strong>Reviewer:</strong> {viewAppraisal.reviewer?.firstName} {viewAppraisal.reviewer?.lastName}</span>
            <span><strong>Status:</strong> <Badge status={viewAppraisal.status} /></span>
            {viewAppraisal.overallRating && <span><strong>Overall:</strong> {viewAppraisal.overallRating} / 5</span>}
          </div>
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
          {viewAppraisal.employeeComments && <p className={s.detailPara}><strong>Employee comments:</strong> {viewAppraisal.employeeComments}</p>}
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteGoalId}
        title="Delete Goal"
        message="Delete this goal permanently?"
        confirmText="Delete"
        destructive
        onCancel={() => setDeleteGoalId(null)}
        onConfirm={deleteGoal}
      />
    </div>
  );
}
