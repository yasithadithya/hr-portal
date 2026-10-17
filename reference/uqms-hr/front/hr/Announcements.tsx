import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, Badge, Modal, Field, formatDate } from './hrShared';
import Pagination from '../../components/Pagination';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select, Textarea } from '@/ui';
const emptyForm = { title: '', body: '', priority: 'Normal', publishDate: '', expiryDate: '', isActive: true };

export default function Announcements() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const [editing, setEditing] = useState<any | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getAnnouncements({ page, limit });
      if (res.success) {
        setItems(res.data?.announcements || []);
        setTotal(res.data?.total || 0);
        setPages(res.data?.pages || 1);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading announcements');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const openForm = (item?: any) => {
    setEditing(item || null);
    setForm(item ? {
      title: item.title,
      body: item.body,
      priority: item.priority || 'Normal',
      publishDate: item.publishDate ? new Date(item.publishDate).toISOString().split('T')[0] : '',
      expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : '',
      isActive: item.isActive ?? true,
    } : emptyForm);
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast.warn('Title and body are required');
    const payload: any = { ...form };
    if (!payload.publishDate) delete payload.publishDate;
    payload.expiryDate = payload.expiryDate || null;
    try {
      if (editing) {
        await hrService.updateAnnouncement(editing._id, payload);
        toast.success('Announcement updated');
      } else {
        await hrService.createAnnouncement(payload);
        toast.success('Announcement published');
      }
      setFormOpen(false);
      fetchItems();
    } catch (err: any) {
      toast.error(err.message || 'Error saving announcement');
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await hrService.deleteAnnouncement(deleteId);
      toast.success('Announcement deleted');
      setDeleteId(null);
      fetchItems();
    } catch (err: any) {
      toast.error(err.message || 'Error deleting announcement');
    }
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle={`${total} announcement${total === 1 ? '' : 's'}`}
        action={<button className={s.addBtn} onClick={() => openForm()}>+ New Announcement</button>}
      />

      {loading ? <p className={s.mutedNote}>Loading announcements...</p> : (
        <>
          {items.map(a => (
            <div key={a._id} className={`${s.entityCard} ${s.spaced} ${a.isActive ? '' : s.inactive}`}>
              <div className={s.entityCardHead}>
                <div className={s.grow}>
                  <div className={s.inlineGroup}>
                    <span className={s.entityTitle}>{a.title}</span>
                    <Badge status={a.priority} />
                    {!a.isActive && <Badge status="Cancelled" label="Inactive" />}
                  </div>
                  <p className={s.body}>{a.body}</p>
                  <p className={`${s.entityMeta} ${s.metaFoot}`}>
                    Published {formatDate(a.publishDate)}{a.expiryDate ? ` · expires ${formatDate(a.expiryDate)}` : ''}
                  </p>
                </div>
                <div className={s.actionRow}>
                  <button className={s.actionBtn} onClick={() => openForm(a)}>Edit</button>
                  <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteId(a._id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className={s.mutedNote}>No announcements yet.</p>}
          <Pagination page={page} limit={limit} total={total} totalPages={pages} onPageChange={setPage} onLimitChange={setLimit} />
        </>
      )}

      {formOpen && (
        <Modal
          title={editing ? 'Edit Announcement' : 'New Announcement'}
          onClose={() => setFormOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={save}>{editing ? 'Save' : 'Publish'}</Button>
            </>
          }
        >
          <Field label="Title" required>
            <Input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Body" required>
            <Textarea rows={4} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
          </Field>
          <div className={`${s.modalGrid} ${s.modalGrid3}`}>
            <Field label="Priority">
              <Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="Normal">Normal</option>
                <option value="Important">Important</option>
                <option value="Urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Publish Date">
              <Input type="date" value={form.publishDate} onChange={e => setForm({ ...form, publishDate: e.target.value })} />
            </Field>
            <Field label="Expiry Date">
              <Input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
          </div>
          <label className={s.checkLabel}>
            <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Announcement"
        message="Delete this announcement permanently?"
        confirmText="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </div>
  );
}
