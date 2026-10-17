import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { PageHeader, EmptyRow, FilterBar, Field } from './hrShared';
import Pagination from '../../components/Pagination';
import s from './hr.module.css';

import { Select } from '@/ui';
export default function LeaveBalancesView() {
  const now = new Date();
  const [balances, setBalances] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(now.getFullYear());
  const [employeeId, setEmployeeId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    hrService.getEmployees({ limit: 100 }).then(res => {
      if (res.success) setEmployees(res.data?.employees || []);
    }).catch(() => {});
  }, []);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrService.getAllLeaveBalances({ year, employeeId: employeeId || undefined, page, limit });
      if (res.success) {
        setBalances(res.data?.balances || []);
        setTotal(res.data?.total || 0);
        setPages(res.data?.pages || 1);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading balances');
    } finally {
      setLoading(false);
    }
  }, [year, employeeId, page, limit]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  return (
    <div>
      <PageHeader title="Leave Balances" subtitle={`${total} balance record${total === 1 ? '' : 's'}`} />

      <FilterBar>
        <Field label="Year" className={s.filterField}>
          <Select value={year} onChange={e => { setYear(Number(e.target.value)); setPage(1); }}>
            {Array.from({ length: 4 }, (_, i) => now.getFullYear() + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
        <Field label="Employee" className={s.filterField}>
          <Select value={employeeId} onChange={e => { setEmployeeId(e.target.value); setPage(1); }}>
            <option value="">All employees</option>
            {employees.map(emp => <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</option>)}
          </Select>
        </Field>
      </FilterBar>

      {loading ? <p className={s.mutedNote}>Loading balances...</p> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Entitlement</th>
                <th>Used</th>
                <th>Pending</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => {
                const remaining = (b.totalDays ?? 0) - (b.usedDays ?? 0) - (b.pendingDays ?? 0);
                return (
                  <tr key={b._id}>
                    <td className={s.cellStrong}>
                      {b.employee?.firstName} {b.employee?.lastName}
                      <span className={s.cellSub}>{b.employee?.employeeId}</span>
                    </td>
                    <td>{b.leaveType?.name || '—'}</td>
                    <td>{b.totalDays}</td>
                    <td>{b.usedDays}</td>
                    <td>{b.pendingDays}</td>
                    <td className={`${s.cellStrong} ${remaining <= 0 ? s.textDanger : s.textSuccess}`}>{remaining}</td>
                  </tr>
                );
              })}
              {balances.length === 0 && <EmptyRow colSpan={6} text={`No balances found for ${year}. Use "Initialize Balances" under Settings → Leave Types.`} />}
            </tbody>
          </table>
          <div>
            <Pagination page={page} limit={limit} total={total} totalPages={pages} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        </div>
      )}
    </div>
  );
}
