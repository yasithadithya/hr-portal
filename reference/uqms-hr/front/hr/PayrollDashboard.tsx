import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import PayslipModal from './PayslipModal';
import Pagination from '../../components/Pagination';
import { PageHeader, Badge, EmptyRow, FilterBar, Field, formatMoney } from './hrShared';
import s from './hr.module.css';
import { useAuth } from '../../context/AuthContext';
import { MODULE_KEYS } from '../../utils/permissions';

import { Button, ConfirmDialog, Input, Select } from '@/ui';
export default function PayrollDashboard({ basePath }: { basePath: string }) {
  const { can } = useAuth();
  const canGenerate = can(MODULE_KEYS.hrPayroll, 'create');
  const canApprove = can(MODULE_KEYS.hrPayroll, 'approve');
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateLoading, setGenerateLoading] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | ''>('');
  const [filterYear, setFilterYear] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void>; destructive?: boolean } | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getPayrollRuns({
        month: filterMonth || undefined,
        year: filterYear || undefined,
        page,
        limit,
      });
      if (res.success) {
        setRuns(res.data?.runs || []);
        setTotal(res.data?.total || 0);
        setPages(res.data?.pages || 1);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading payroll runs');
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterYear, page, limit]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleGenerate = () => {
    setConfirm({
      title: 'Generate Payroll',
      message: `Generate payroll for all active employees for ${month}/${year}?`,
      action: async () => {
        setGenerateLoading(true);
        try {
          const res = await hrService.generatePayroll(month, year);
          const results: any[] = Array.isArray(res.data) ? res.data : [];
          const ok = results.filter(r => r.status === 'Success').length;
          const failed = results.filter(r => r.status === 'Failed');
          toast.success(`Payroll generated: ${ok} succeeded, ${results.length - ok - failed.length} skipped, ${failed.length} failed`);
          if (failed.length > 0) {
            toast.warn(`Failed: ${failed.map(f => `${f.employeeId} (${f.error})`).join('; ')}`);
          }
          fetchRuns();
        } catch (err: any) {
          toast.error(err.message || 'Error generating payroll');
        } finally {
          setGenerateLoading(false);
        }
      },
    });
  };

  const handleApprove = (id: string) => {
    setConfirm({
      title: 'Approve Payroll',
      message: 'Approve this payroll record?',
      action: async () => {
        try {
          await hrService.approvePayrollRun(id);
          toast.success('Payroll approved');
          fetchRuns();
        } catch (err: any) {
          toast.error(err.message || 'Error approving payroll');
        }
      },
    });
  };

  const handleMarkPaid = (id: string) => {
    setConfirm({
      title: 'Mark as Paid',
      message: 'Mark this payroll record as Paid?',
      action: async () => {
        try {
          await hrService.markPayrollPaid(id);
          toast.success('Payroll marked as paid');
          fetchRuns();
        } catch (err: any) {
          toast.error(err.message || 'Error marking payroll as paid');
        }
      },
    });
  };

  return (
    <div>
      <PageHeader title="Payroll" subtitle={`${total} payroll record${total === 1 ? '' : 's'}`} />

      <FilterBar>
        <Field label="Month" className={s.filterField}>
          <Select value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Year" className={s.filterField}>
          <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} />
        </Field>
        <Button variant="primary" onClick={handleGenerate} disabled={generateLoading || !canGenerate} >
          {generateLoading ? 'Generating...' : 'Generate Bulk Payroll'}
        </Button>

        <div className="spacer" />

        <Field label="Filter Month" className={s.filterField}>
          <Select value={filterMonth} onChange={e => { setFilterMonth(e.target.value ? Number(e.target.value) : ''); setPage(1); }}>
            <option value="">All</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Filter Year" className={s.filterField}>
          <Select value={filterYear} onChange={e => { setFilterYear(e.target.value ? Number(e.target.value) : ''); setPage(1); }}>
            <option value="">All</option>
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {loading ? (
        <p className={s.mutedNote}>Loading payroll runs...</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Period</th>
                <th>Gross</th>
                <th>Deductions</th>
                <th>Net Salary</th>
                <th>Status</th>
                <th className={s.alignRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run._id}>
                  <td className={s.cellStrong}>
                    {run.employee?.firstName} {run.employee?.lastName}
                    <span className={s.cellSub}>{run.employee?.employeeId}</span>
                  </td>
                  <td className={s.cellStrong}>{run.month} / {run.year}</td>
                  <td>{formatMoney(run.grossSalary)}</td>
                  <td>{formatMoney(run.totalDeductions)}</td>
                  <td className={s.cellStrong}>{formatMoney(run.netSalary)}</td>
                  <td><Badge status={run.status} /></td>
                  <td className={s.alignRight}>
                    <div className={s.actionRow}>
                      <button className={s.actionBtn} onClick={() => setSelectedRunId(run._id)}>View Payslip</button>
                      {run.status === 'Draft' && canApprove && <button className={`${s.actionBtn} ${s.actionPrimary}`} onClick={() => handleApprove(run._id)}>Approve</button>}
                      {run.status === 'Approved' && canApprove && <button className={`${s.actionBtn} ${s.actionSuccess}`} onClick={() => handleMarkPaid(run._id)}>Mark Paid</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && <EmptyRow colSpan={7} text="No payroll runs found." />}
            </tbody>
          </table>
          <div>
            <Pagination page={page} limit={limit} total={total} totalPages={pages} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        </div>
      )}

      {selectedRunId && (
        <PayslipModal runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        destructive={confirm?.destructive}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) action();
        }}
      />
    </div>
  );
}
