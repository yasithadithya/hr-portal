import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import Pagination from '../../components/Pagination';
import { PageHeader, Badge, EmptyRow, Modal, Field } from './hrShared';
import s from './hr.module.css';
import { useAuth } from '../../context/AuthContext';
import { MODULE_KEYS } from '../../utils/permissions';

import { Button, ConfirmDialog, Select, Textarea } from '@/ui';
export default function LeaveManagement({ basePath }: { basePath: string }) {
  const { can } = useAuth();
  const canApprove = can(MODULE_KEYS.hrLeave, 'approve');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getLeaveRequests({ status: statusFilter || undefined, page, limit });
      if (res.success) {
        setRequests(res.data?.requests || []);
        setTotal(res.data?.total || 0);
        setPages(res.data?.pages || 1);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading leave requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, limit]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = async () => {
    if (!approveId) return;
    const id = approveId;
    setApproveId(null);
    try {
      await hrService.approveLeaveRequest(id);
      toast.success('Leave request approved');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error approving request');
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    if (!rejectReason.trim()) {
      toast.warn('Please enter a rejection reason');
      return;
    }
    try {
      await hrService.rejectLeaveRequest(rejectId, rejectReason.trim());
      toast.success('Leave request rejected');
      setRejectId(null);
      setRejectReason('');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || 'Error rejecting request');
    }
  };

  return (
    <div>
      <PageHeader
        title="Leave Requests"
        subtitle={`${total} request${total === 1 ? '' : 's'}`}
        action={
          <>
            <Select className={s.inlineControl} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
            </Select>
            <button className={s.actionBtn} onClick={fetchRequests}>Refresh</button>
          </>
        }
      />

      {loading ? (
        <p className={s.mutedNote}>Loading leave requests...</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Status</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req._id}>
                  <td className={s.cellStrong}>
                    {req.employee?.firstName} {req.employee?.lastName}
                    <span className={s.cellSub}>{req.employee?.employeeId}</span>
                  </td>
                  <td>{req.leaveType?.name || 'Unknown'}</td>
                  <td>{new Date(req.startDate).toLocaleDateString()} - {new Date(req.endDate).toLocaleDateString()}</td>
                  <td>{req.totalDays}</td>
                  <td className={s.clip}>
                    {req.reason || '—'}
                    {req.status === 'Rejected' && req.rejectionReason && (
                      <span className={`${s.cellSub} ${s.textDanger}`}>Rejected: {req.rejectionReason}</span>
                    )}
                  </td>
                  <td><Badge status={req.status} /></td>
                  <td className={s.alignRight}>
                    {req.status === 'Pending' && canApprove && (
                      <div className={s.actionRow}>
                        <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => setApproveId(req._id)}>Approve</button>
                        <button className={`${s.actionBtn} ${s.actionDanger}`} onClick={() => { setRejectId(req._id); setRejectReason(''); }}>Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {requests.length === 0 && <EmptyRow colSpan={7} text="No leave requests found." />}
            </tbody>
          </table>
          <div>
            <Pagination page={page} limit={limit} total={total} totalPages={pages} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!approveId}
        title="Approve Leave"
        message="Approve this leave request? The employee's balance will be deducted and attendance marked as On Leave."
        confirmText="Approve"
        onCancel={() => setApproveId(null)}
        onConfirm={handleApprove}
      />

      {rejectId && (
        <Modal
          title="Reject Leave Request"
          size="narrow"
          onClose={() => { setRejectId(null); setRejectReason(''); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => { setRejectId(null); setRejectReason(''); }}>Cancel</Button>
              <Button variant="danger" onClick={handleReject}>Reject</Button>
            </>
          }
        >
          <p className={`${s.mutedNote} ${s.spaced}`}>Provide a reason for rejecting this request. The pending balance will be restored.</p>
          <Field label="Reason">
            <Textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Insufficient coverage during this period"
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}
