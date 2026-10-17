import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, Badge, Modal, EmptyRow, Field } from './hrShared';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select } from '@/ui';
export default function LeaveTypesManagement() {
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', defaultDaysPerYear: 14, isPaidLeave: true, isCarryForwardAllowed: false, maxCarryForwardDays: 0 });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [initYear, setInitYear] = useState(new Date().getFullYear());
  const [initConfirm, setInitConfirm] = useState(false);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getLeaveTypes();
      if (res.success) setTypes(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading leave types');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const openForm = (type?: any) => {
    setEditing(type || null);
    setForm({
      name: type?.name || '',
      defaultDaysPerYear: type?.defaultDaysPerYear ?? 14,
      isPaidLeave: type?.isPaidLeave ?? true,
      isCarryForwardAllowed: type?.isCarryForwardAllowed ?? false,
      maxCarryForwardDays: type?.maxCarryForwardDays ?? 0,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name) return toast.warn('Name is required');
    try {
      if (editing) {
        await hrService.updateLeaveType(editing._id, form);
        toast.success('Leave type updated');
      } else {
        await hrService.createLeaveType(form);
        toast.success('Leave type created');
      }
      setFormOpen(false);
      fetchTypes();
    } catch (err: any) {
      toast.error(err.message || 'Error saving leave type');
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await hrService.deleteLeaveType(deleteId);
      toast.success('Leave type deleted');
      setDeleteId(null);
      fetchTypes();
    } catch (err: any) {
      toast.error(err.message || 'Error deleting leave type');
      setDeleteId(null);
    }
  };

  const initialize = async () => {
    setInitConfirm(false);
    try {
      await hrService.initializeLeaveBalances(initYear);
      toast.success(`Leave balances initialized for ${initYear} (all active employees)`);
    } catch (err: any) {
      toast.error(err.message || 'Error initializing balances');
    }
  };

  return (
    <div>
      <PageHeader
        title="Leave Types"
        subtitle="Entitlements and carry-forward rules"
        action={
          <>
            <Select className={s.inlineControl} value={initYear} onChange={e => setInitYear(Number(e.target.value))}>
              {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
            <button className={s.actionBtn} onClick={() => setInitConfirm(true)}>Initialize Balances</button>
            <button className={s.addBtn} onClick={() => openForm()}>+ Add Leave Type</button>
          </>
        }
      />

      {loading ? <p className={s.mutedNote}>Loading leave types...</p> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Days / Year</th>
                <th>Paid</th>
                <th>Carry Forward</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map(t => (
                <tr key={t._id}>
                  <td className={s.cellStrong}>{t.name}</td>
                  <td>{t.defaultDaysPerYear}</td>
                  <td>{t.isPaidLeave ? <Badge status="Active" label="Paid" /> : <Badge status="Cancelled" label="Unpaid" />}</td>
                  <td>{t.isCarryForwardAllowed ? `Yes (max ${t.maxCarryForwardDays ?? 0})` : 'No'}</td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => openForm(t)}>Edit</button>
                      <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteId(t._id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {types.length === 0 && <EmptyRow colSpan={5} text="No leave types defined." />}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <Modal
          title={editing ? 'Edit Leave Type' : 'Add Leave Type'}
          size="narrow"
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={save}>Save</Button>
            </>
          }
        >
          <Field label="Name" required>
            <Input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Annual" />
          </Field>
          <Field label="Default Days Per Year" required>
            <Input type="number" min={0} value={form.defaultDaysPerYear} onChange={e => setForm({ ...form, defaultDaysPerYear: Number(e.target.value) })} />
          </Field>
          <label className={`${s.checkLabel} ${s.spaced}`}>
            <input type="checkbox" checked={form.isPaidLeave} onChange={e => setForm({ ...form, isPaidLeave: e.target.checked })} />
            Paid leave
          </label>
          <label className={`${s.checkLabel} ${s.spaced}`}>
            <input type="checkbox" checked={form.isCarryForwardAllowed} onChange={e => setForm({ ...form, isCarryForwardAllowed: e.target.checked })} />
            Allow carry forward
          </label>
          {form.isCarryForwardAllowed && (
            <Field label="Max Carry Forward Days">
              <Input type="number" min={0} value={form.maxCarryForwardDays} onChange={e => setForm({ ...form, maxCarryForwardDays: Number(e.target.value) })} />
            </Field>
          )}
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Leave Type"
        message="Delete this leave type? This is blocked if any requests or balances reference it."
        confirmText="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={initConfirm}
        title="Initialize Leave Balances"
        message={`Create ${initYear} leave balances for every active employee and leave type? Existing balances are left untouched.`}
        confirmText="Initialize"
        onCancel={() => setInitConfirm(false)}
        onConfirm={initialize}
      />
    </div>
  );
}
