import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { hrService } from '../../api';
import { Badge, Modal, EmptyRow, FilterBar, Field } from './hrShared';
import s from './hr.module.css';

import { Button, Input, Select } from '@/ui';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function AttendanceView({ basePath }: { basePath: string }) {
  const now = new Date();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [logs, setLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [clockLoading, setClockLoading] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ date: '', clockIn: '', clockOut: '', status: 'Present', notes: '' });

  useEffect(() => {
    hrService.getEmployees({ limit: 100 }).then(res => {
      if (res.success) setEmployees(res.data?.employees || []);
    }).catch(() => toast.error('Failed to load employees'));
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!selectedEmployeeId) {
      setLogs([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        hrService.getAttendance(selectedEmployeeId, { month, year }),
        hrService.getAttendanceSummary(selectedEmployeeId, month, year),
      ]);
      if (logsRes.success) setLogs(logsRes.data || []);
      if (summaryRes.success) setSummary(summaryRes.data);
    } catch (err: any) {
      toast.error(err.message || 'Error loading attendance');
    } finally {
      setLoading(false);
    }
  }, [selectedEmployeeId, month, year]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClock = async (direction: 'in' | 'out') => {
    if (!selectedEmployeeId) return toast.warn('Select an employee first');
    setClockLoading(true);
    try {
      if (direction === 'in') await hrService.clockIn(selectedEmployeeId);
      else await hrService.clockOut(selectedEmployeeId);
      toast.success(direction === 'in' ? 'Clocked in' : 'Clocked out');
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setClockLoading(false);
    }
  };

  const submitManual = async () => {
    if (!selectedEmployeeId) return toast.warn('Select an employee first');
    if (!manual.date) return toast.warn('Date is required');
    try {
      await hrService.manualAttendanceEntry({
        employeeId: selectedEmployeeId,
        date: manual.date,
        clockIn: manual.clockIn ? `${manual.date}T${manual.clockIn}:00` : undefined,
        clockOut: manual.clockOut ? `${manual.date}T${manual.clockOut}:00` : undefined,
        status: manual.status,
        notes: manual.notes || undefined,
      });
      toast.success('Manual entry saved');
      setManualOpen(false);
      setManual({ date: '', clockIn: '', clockOut: '', status: 'Present', notes: '' });
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message || 'Error saving manual entry');
    }
  };

  const summaryCards = summary ? [
    { label: 'Present', value: summary.present },
    { label: 'Absent', value: summary.absent },
    { label: 'Late', value: summary.late },
    { label: 'Half Day', value: summary.halfDay },
    { label: 'On Leave', value: summary.onLeave },
    { label: 'OT Hours', value: (summary.totalOvertimeHours || 0).toFixed(1) },
  ] : [];

  return (
    <div>
      <FilterBar>
        <Field label="Select Employee" className={s.filterField} full>
          <Select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)}>
            <option value="">-- Select Employee --</option>
            {employees.map(emp => (
              <option key={emp._id} value={emp._id}>{emp.firstName} {emp.lastName} ({emp.employeeId})</option>
            ))}
          </Select>
        </Field>
        <Field label="Month" className={s.filterField}>
          <Select value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Year" className={s.filterField}>
          <Select value={year} onChange={e => setYear(Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
        <Button variant="primary" onClick={() => handleClock('in')} disabled={!selectedEmployeeId || clockLoading}>
          Clock In
        </Button>
        <Button variant="secondary" onClick={() => handleClock('out')} disabled={!selectedEmployeeId || clockLoading}>
          Clock Out
        </Button>
        <button className={s.actionBtn} onClick={() => setManualOpen(true)} disabled={!selectedEmployeeId}>
          + Manual Entry
        </button>
      </FilterBar>

      {summary && (
        <div className={s.summaryCards}>
          {summaryCards.map(card => (
            <div key={card.label} className={s.summaryCard}>
              <div className={s.summaryValue}>{card.value}</div>
              <div className={s.summaryLabel}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className={s.mutedNote}>Loading attendance logs...</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>OT</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log._id}>
                  <td className={s.cellStrong}>{new Date(log.date).toLocaleDateString()}</td>
                  <td>{log.clockIn ? new Date(log.clockIn).toLocaleTimeString() : '-'}</td>
                  <td>{log.clockOut ? new Date(log.clockOut).toLocaleTimeString() : '-'}</td>
                  <td>{log.workedHours ? log.workedHours.toFixed(2) : '-'}</td>
                  <td>{log.overtimeHours ? log.overtimeHours.toFixed(2) : '-'}</td>
                  <td>
                    <Badge status={log.status} />
                    {log.isManualEntry && <span className={s.cellSubInline}>(manual)</span>}
                  </td>
                  <td className={s.clip}>{log.notes || '—'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <EmptyRow colSpan={7} text={selectedEmployeeId ? 'No attendance logs found for this period.' : 'Please select an employee to view logs.'} />
              )}
            </tbody>
          </table>
        </div>
      )}

      {manualOpen && (
        <Modal
          title="Manual Attendance Entry"
          onClose={() => setManualOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setManualOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={submitManual}>Save Entry</Button>
            </>
          }
        >
          <div className={s.modalGrid}>
            <Field label="Date" required>
              <Input type="date" value={manual.date} onChange={e => setManual({ ...manual, date: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={manual.status} onChange={e => setManual({ ...manual, status: e.target.value })}>
                {['Present', 'Absent', 'Late', 'HalfDay', 'OnLeave', 'Holiday'].map(st => <option key={st} value={st}>{st}</option>)}
              </Select>
            </Field>
            <Field label="Clock In">
              <Input type="time" value={manual.clockIn} onChange={e => setManual({ ...manual, clockIn: e.target.value })} />
            </Field>
            <Field label="Clock Out">
              <Input type="time" value={manual.clockOut} onChange={e => setManual({ ...manual, clockOut: e.target.value })} />
            </Field>
            <Field label="Notes" full>
              <Input type="text" value={manual.notes} onChange={e => setManual({ ...manual, notes: e.target.value })} placeholder="Reason for manual entry" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
