import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { request } from '../../api/client';
import { Modal, formatMoney } from './hrShared';
import s from './hr.module.css';

function PayRow({ label, value, strong }: { label: string; value?: number; strong?: boolean }) {
  return (
    <div className={`${s.payRow} ${strong ? s.payRowStrong : ''}`}>
      <span>{label}</span>
      <span>{(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

export default function PayslipModal({ runId, onClose, selfService = false }: { runId: string, onClose: () => void, selfService?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetcher = selfService
      ? request<any>(`/hr/me/payslips/${runId}`)
      : hrService.getPayslip(runId);
    fetcher.then(res => {
      if (res.success) setData(res.data);
      setLoading(false);
    }).catch(() => {
      toast.error('Error fetching payslip');
      onClose();
    });
  }, [runId]);

  if (loading || !data) return null;

  return (
    <Modal title={`Payslip — ${data.month}/${data.year}`} onClose={onClose}>
      <div className={s.payMeta}>
        <p className={s.cellStrong}>{data.employee?.firstName} {data.employee?.lastName} · {data.employee?.employeeId}</p>
        <p className={s.mutedNote}>
          Attendance: {data.daysWorked}/{data.workingDaysInMonth} days worked
          {data.leaveDaysPaid > 0 && ` · ${data.leaveDaysPaid} paid leave`}
          {data.absentDays > 0 && ` · ${data.absentDays} absent`}
          {data.overtimeHours > 0 && ` · ${data.overtimeHours} OT hrs`}
        </p>
      </div>

      <div className={s.payCols}>
        <div>
          <div className={s.payColTitle}>Earnings</div>
          <PayRow label="Basic Salary" value={data.basicSalary} />
          {(data.allowanceBreakdown || []).map((a: any, i: number) => (
            <PayRow key={i} label={a.name} value={a.amount} />
          ))}
          {(!data.allowanceBreakdown || data.allowanceBreakdown.length === 0) && <PayRow label="Allowances" value={data.totalAllowances} />}
          {data.overtimePay > 0 && <PayRow label="Overtime Pay" value={data.overtimePay} />}
          <PayRow label="Gross Earnings" value={data.grossSalary} strong />
        </div>

        <div>
          <div className={s.payColTitle}>Deductions</div>
          <PayRow label="EPF (Employee 8%)" value={data.epfEmployee} />
          <PayRow label="Income Tax (APIT)" value={data.incomeTax} />
          {(data.otherDeductions || []).map((d: any, i: number) => (
            <PayRow key={i} label={d.name} value={d.amount} />
          ))}
          <PayRow label="Total Deductions" value={data.totalDeductions} strong />
        </div>
      </div>

      <div className={s.payNote}>
        Employer contributions (not deducted from salary): EPF 12% = {(data.epfEmployer ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} · ETF 3% = {(data.etf ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>

      <div className={s.payTotal}>
        <span className={s.sectionTitle}>Net pay</span>
        <span className={s.payTotalValue}>{formatMoney(data.netSalary)}</span>
      </div>
    </Modal>
  );
}
