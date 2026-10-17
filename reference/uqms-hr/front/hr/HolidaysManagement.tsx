import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, Badge, Modal, EmptyRow, Field, formatDate } from './hrShared';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input } from '@/ui';
export default function HolidaysManagement() {
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', isRecurring: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getHolidays();
      if (res.success) setHolidays(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading holidays');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const openForm = (holiday?: any) => {
    setEditing(holiday || null);
    setForm({
      name: holiday?.name || '',
      date: holiday?.date ? new Date(holiday.date).toISOString().split('T')[0] : '',
      isRecurring: holiday?.isRecurring || false,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.date) return toast.warn('Name and date are required');
    try {
      if (editing) {
        await hrService.updateHoliday(editing._id, form);
        toast.success('Holiday updated');
      } else {
        await hrService.addHoliday(form);
        toast.success('Holiday added');
      }
      setFormOpen(false);
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || 'Error saving holiday');
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await hrService.removeHoliday(deleteId);
      toast.success('Holiday removed');
      setDeleteId(null);
      fetchHolidays();
    } catch (err: any) {
      toast.error(err.message || 'Error removing holiday');
    }
  };

  return (
    <div>
      <PageHeader
        title="Public Holidays"
        subtitle="Excluded from leave-day calculations"
        action={<button className={s.addBtn} onClick={() => openForm()}>+ Add Holiday</button>}
      />

      {loading ? <p className={s.mutedNote}>Loading holidays...</p> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Recurring</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h._id}>
                  <td className={s.cellStrong}>{formatDate(h.date)}</td>
                  <td>{h.name}</td>
                  <td>{h.isRecurring ? <Badge status="Active" label="Yes" /> : <Badge status="Cancelled" label="No" />}</td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => openForm(h)}>Edit</button>
                      <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteId(h._id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && <EmptyRow colSpan={4} text="No public holidays defined." />}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <Modal
          title={editing ? 'Edit Holiday' : 'Add Holiday'}
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
            <Input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Independence Day" />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </Field>
          <label className={s.checkLabel}>
            <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} />
            Recurring every year
          </label>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Remove Holiday"
        message="Remove this public holiday? Leave-day calculations will no longer exclude it."
        confirmText="Remove"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </div>
  );
}
