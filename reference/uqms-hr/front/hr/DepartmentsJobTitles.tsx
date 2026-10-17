import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { Badge, Modal, EmptyRow, Field } from './hrShared';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select } from '@/ui';
export default function DepartmentsJobTitles() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [deptForm, setDeptForm] = useState<{ open: boolean; editing: any | null; name: string; description: string; headOfDepartment: string }>({ open: false, editing: null, name: '', description: '', headOfDepartment: '' });
  const [titleForm, setTitleForm] = useState<{ open: boolean; editing: any | null; title: string; grade: string; description: string }>({ open: false, editing: null, title: '', grade: '', description: '' });
  const [confirm, setConfirm] = useState<{ kind: 'dept' | 'title'; id: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [deptRes, titleRes, empRes] = await Promise.all([
        hrService.getDepartments(),
        hrService.getJobTitles(),
        hrService.getEmployees({ limit: 100, status: 'Active' }),
      ]);
      if (deptRes.success) setDepartments(deptRes.data || []);
      if (titleRes.success) setJobTitles(titleRes.data || []);
      if (empRes.success) setEmployees(empRes.data?.employees || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveDept = async () => {
    if (!deptForm.name.trim()) return toast.warn('Department name is required');
    const payload: any = { name: deptForm.name.trim(), description: deptForm.description };
    payload.headOfDepartment = deptForm.headOfDepartment || null;
    try {
      if (deptForm.editing) {
        await hrService.updateDepartment(deptForm.editing._id, payload);
        toast.success('Department updated');
      } else {
        await hrService.createDepartment(payload);
        toast.success('Department created');
      }
      setDeptForm({ ...deptForm, open: false });
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Error saving department');
    }
  };

  const saveTitle = async () => {
    if (!titleForm.title.trim()) return toast.warn('Title is required');
    const payload = { title: titleForm.title.trim(), grade: titleForm.grade, description: titleForm.description };
    try {
      if (titleForm.editing) {
        await hrService.updateJobTitle(titleForm.editing._id, payload);
        toast.success('Job title updated');
      } else {
        await hrService.createJobTitle(payload);
        toast.success('Job title created');
      }
      setTitleForm({ ...titleForm, open: false });
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Error saving job title');
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    const { kind, id } = confirm;
    setConfirm(null);
    try {
      if (kind === 'dept') await hrService.deleteDepartment(id);
      else await hrService.deleteJobTitle(id);
      toast.success(kind === 'dept' ? 'Department deleted' : 'Job title deleted');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  };

  if (loading) return <p className={s.mutedNote}>Loading...</p>;

  return (
    <div className={s.twoCol}>
      <div>
        <div className={s.topBar}>
          <h3 className={s.sectionTitle}>Departments</h3>
          <button className={s.addBtn} onClick={() => setDeptForm({ open: true, editing: null, name: '', description: '', headOfDepartment: '' })}>+ Add</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Head</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d._id}>
                  <td className={s.cellStrong}>
                    {d.name}
                    {d.description && <span className={s.cellSub}>{d.description}</span>}
                  </td>
                  <td>{d.headOfDepartment ? `${d.headOfDepartment.firstName} ${d.headOfDepartment.lastName}` : '—'}</td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => setDeptForm({ open: true, editing: d, name: d.name, description: d.description || '', headOfDepartment: d.headOfDepartment?._id || '' })}>Edit</button>
                      <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setConfirm({ kind: 'dept', id: d._id })}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {departments.length === 0 && <EmptyRow colSpan={3} text="No departments." />}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className={s.topBar}>
          <h3 className={s.sectionTitle}>Job Titles</h3>
          <button className={s.addBtn} onClick={() => setTitleForm({ open: true, editing: null, title: '', grade: '', description: '' })}>+ Add</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Grade</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobTitles.map(t => (
                <tr key={t._id}>
                  <td className={s.cellStrong}>
                    {t.title}
                    {t.description && <span className={s.cellSub}>{t.description}</span>}
                  </td>
                  <td>{t.grade || '—'}</td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => setTitleForm({ open: true, editing: t, title: t.title, grade: t.grade || '', description: t.description || '' })}>Edit</button>
                      <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setConfirm({ kind: 'title', id: t._id })}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobTitles.length === 0 && <EmptyRow colSpan={3} text="No job titles." />}
            </tbody>
          </table>
        </div>
      </div>

      {deptForm.open && (
        <Modal
          title={deptForm.editing ? 'Edit Department' : 'Add Department'}
          size="narrow"
          onClose={() => setDeptForm({ ...deptForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeptForm({ ...deptForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveDept}>Save</Button>
            </>
          }
        >
          <Field label="Name" required>
            <Input type="text" value={deptForm.name} onChange={e => setDeptForm({ ...deptForm, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input type="text" value={deptForm.description} onChange={e => setDeptForm({ ...deptForm, description: e.target.value })} />
          </Field>
          <Field label="Head of Department">
            <Select value={deptForm.headOfDepartment} onChange={e => setDeptForm({ ...deptForm, headOfDepartment: e.target.value })}>
              <option value="">None</option>
              {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</option>)}
            </Select>
          </Field>
        </Modal>
      )}

      {titleForm.open && (
        <Modal
          title={titleForm.editing ? 'Edit Job Title' : 'Add Job Title'}
          size="narrow"
          onClose={() => setTitleForm({ ...titleForm, open: false })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTitleForm({ ...titleForm, open: false })}>Cancel</Button>
              <Button variant="primary" onClick={saveTitle}>Save</Button>
            </>
          }
        >
          <Field label="Title" required>
            <Input type="text" value={titleForm.title} onChange={e => setTitleForm({ ...titleForm, title: e.target.value })} />
          </Field>
          <Field label="Grade">
            <Input type="text" value={titleForm.grade} onChange={e => setTitleForm({ ...titleForm, grade: e.target.value })} placeholder="e.g. G5" />
          </Field>
          <Field label="Description">
            <Input type="text" value={titleForm.description} onChange={e => setTitleForm({ ...titleForm, description: e.target.value })} />
          </Field>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'dept' ? 'Delete Department' : 'Delete Job Title'}
        message="This is blocked if any active employee is still assigned to it."
        confirmText="Delete"
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={doDelete}
      />
    </div>
  );
}
