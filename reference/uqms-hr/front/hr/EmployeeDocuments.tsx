import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, Badge, Modal, EmptyRow, FilterBar, Field, formatDate } from './hrShared';
import s from './hr.module.css';

import { Button, ConfirmDialog, Input, Select } from '@/ui';
const CATEGORIES = ['NIC', 'Passport', 'Contract', 'Certificate', 'Medical', 'Other'];

const isExpiringSoon = (d?: string) => {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
};

const isExpired = (d?: string) => !!d && new Date(d).getTime() < Date.now();

export default function EmployeeDocuments() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'Other', expiryDate: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    hrService.getEmployees({ limit: 100 }).then(res => {
      if (res.success) setEmployees(res.data?.employees || []);
    }).catch(() => toast.error('Failed to load employees'));
  }, []);

  const fetchDocuments = useCallback(async () => {
    if (!employeeId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const res = await hrService.getEmployeeDocuments(employeeId);
      if (res.success) setDocuments(res.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading documents');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const upload = async () => {
    if (!file) return toast.warn('Choose a file');
    if (!form.title.trim()) return toast.warn('Title is required');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', form.title.trim());
      fd.append('category', form.category);
      if (form.expiryDate) fd.append('expiryDate', form.expiryDate);
      if (form.notes) fd.append('notes', form.notes);
      await hrService.uploadEmployeeDocument(employeeId, fd);
      toast.success('Document uploaded');
      setUploadOpen(false);
      setForm({ title: '', category: 'Other', expiryDate: '', notes: '' });
      setFile(null);
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await hrService.deleteEmployeeDocument(deleteId);
      toast.success('Document deleted');
      setDeleteId(null);
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <div>
      <PageHeader title="Employee Documents" subtitle="Contracts, certificates, and IDs with expiry alerts" />

      <FilterBar>
        <Field label="Employee" className={s.filterField}>
          <Select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">-- Select Employee --</option>
            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</option>)}
          </Select>
        </Field>
        <Button variant="primary"  disabled={!employeeId} onClick={() => setUploadOpen(true)}>
          + Upload Document
        </Button>
      </FilterBar>

      {loading ? <p className={s.mutedNote}>Loading documents...</p> : employeeId ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Uploaded</th>
                <th>Expiry</th>
                <th>Size</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc._id}>
                  <td className={s.cellStrong}>
                    {doc.title}
                    {doc.notes && <span className={s.cellSub}>{doc.notes}</span>}
                  </td>
                  <td><Badge status="Scheduled" label={doc.category} /></td>
                  <td>{formatDate(doc.createdAt)}</td>
                  <td className={isExpired(doc.expiryDate) ? s.textDanger : isExpiringSoon(doc.expiryDate) ? s.textWarning : undefined}>
                    {doc.expiryDate ? `${formatDate(doc.expiryDate)}${isExpired(doc.expiryDate) ? ' (expired)' : isExpiringSoon(doc.expiryDate) ? ' (soon)' : ''}` : '—'}
                  </td>
                  <td>{doc.size ? `${(doc.size / 1024).toFixed(0)} KB` : '—'}</td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      {doc.fileUrl && (
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className={s.actionBtn}>Open</a>
                      )}
                      <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => setDeleteId(doc._id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && <EmptyRow colSpan={6} text="No documents for this employee." />}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={s.mutedNote}>Select an employee to manage their documents.</p>
      )}

      {uploadOpen && (
        <Modal
          title="Upload Document"
          size="narrow"
          onClose={() => setUploadOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
              <Button variant="primary" onClick={upload} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
            </>
          }
        >
          <Field label="File (PDF, Word, Excel, or image — max 15 MB)" required>
            <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Field label="Title" required>
            <Input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Employment Contract 2026" />
          </Field>
          <div className={s.modalGrid}>
            <Field label="Category">
              <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Expiry Date">
              <Input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <Input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Document"
        message="Delete this document? The stored file is removed too."
        confirmText="Delete"
        destructive
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </div>
  );
}
