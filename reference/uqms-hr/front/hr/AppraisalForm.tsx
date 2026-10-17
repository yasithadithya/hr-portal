import { useState } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { Modal, Field } from './hrShared';
import s from './hr.module.css';

import { Button, Input, Select, Textarea } from '@/ui';
interface RatingRow {
  criteria: string;
  rating: number;
  comments: string;
}

const DEFAULT_CRITERIA = ['Quality of Work', 'Productivity', 'Teamwork', 'Communication', 'Initiative'];

export default function AppraisalForm({
  appraisal,
  employees,
  cycles,
  onClose,
  onSaved,
}: {
  appraisal?: any;
  employees: any[];
  cycles: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employee, setEmployee] = useState(appraisal?.employee?._id || '');
  const [cycle, setCycle] = useState(appraisal?.cycle?._id || '');
  const [reviewer, setReviewer] = useState(appraisal?.reviewer?._id || '');
  const [ratings, setRatings] = useState<RatingRow[]>(
    appraisal?.ratings?.length
      ? appraisal.ratings.map((r: any) => ({ criteria: r.criteria, rating: r.rating, comments: r.comments || '' }))
      : DEFAULT_CRITERIA.map(c => ({ criteria: c, rating: 3, comments: '' }))
  );
  const [strengths, setStrengths] = useState(appraisal?.strengths || '');
  const [areasForImprovement, setAreasForImprovement] = useState(appraisal?.areasForImprovement || '');
  const [reviewerComments, setReviewerComments] = useState(appraisal?.reviewerComments || '');
  const [saving, setSaving] = useState(false);

  const updateRating = (index: number, patch: Partial<RatingRow>) => {
    setRatings(rows => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const save = async (submit: boolean) => {
    if (!employee || !cycle || !reviewer) return toast.warn('Employee, cycle, and reviewer are required');
    if (ratings.some(r => !r.criteria.trim())) return toast.warn('Every rating row needs a criteria name');
    setSaving(true);
    try {
      const payload = { employee, cycle, reviewer, ratings, strengths, areasForImprovement, reviewerComments };
      let id = appraisal?._id;
      if (id) {
        await hrService.updateAppraisal(id, payload);
      } else {
        const res = await hrService.createAppraisal(payload);
        id = res.data?._id;
      }
      if (submit && id) {
        await hrService.submitAppraisal(id);
        toast.success('Appraisal submitted');
      } else {
        toast.success('Appraisal saved as draft');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Error saving appraisal');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="secondary" onClick={() => save(false)} disabled={saving}>Save Draft</Button>
      <Button variant="primary" onClick={() => save(true)} disabled={saving}>Submit</Button>
    </>
  );

  return (
    <Modal title={appraisal ? 'Edit Appraisal (Draft)' : 'New Appraisal'} onClose={onClose} size="wide" footer={footer}>
      <div className={`${s.modalGrid} ${s.modalGrid3}`}>
        <Field label="Employee" required>
          <Select value={employee} onChange={e => setEmployee(e.target.value)} disabled={!!appraisal}>
            <option value="">Select</option>
            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName}</option>)}
          </Select>
        </Field>
        <Field label="Cycle" required>
          <Select value={cycle} onChange={e => setCycle(e.target.value)} disabled={!!appraisal}>
            <option value="">Select</option>
            {cycles.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Reviewer" required>
          <Select value={reviewer} onChange={e => setReviewer(e.target.value)}>
            <option value="">Select</option>
            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName}</option>)}
          </Select>
        </Field>
      </div>

      <div className={s.spaced}>
        <div className={s.dynHead}>
          <span className={s.groupLabel}>Ratings (1–5)</span>
          <button className={s.actionBtn} onClick={() => setRatings([...ratings, { criteria: '', rating: 3, comments: '' }])}>
            + Add Criteria
          </button>
        </div>
        {ratings.map((r, i) => (
          <div key={i} className={`${s.dynRow} ${s.dynRatings}`}>
            <Input type="text" placeholder="Criteria" value={r.criteria} onChange={e => updateRating(i, { criteria: e.target.value })} />
            <Select value={r.rating} onChange={e => updateRating(i, { rating: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
            <Input type="text" placeholder="Comments" value={r.comments} onChange={e => updateRating(i, { comments: e.target.value })} />
            <button className={s.iconBtn} onClick={() => setRatings(ratings.filter((_, idx) => idx !== i))} aria-label="Remove">✕</button>
          </div>
        ))}
      </div>

      <Field label="Strengths">
        <Textarea rows={2} value={strengths} onChange={e => setStrengths(e.target.value)} />
      </Field>
      <Field label="Areas for Improvement">
        <Textarea rows={2} value={areasForImprovement} onChange={e => setAreasForImprovement(e.target.value)} />
      </Field>
      <Field label="Reviewer Comments">
        <Textarea rows={2} value={reviewerComments} onChange={e => setReviewerComments(e.target.value)} />
      </Field>
    </Modal>
  );
}
