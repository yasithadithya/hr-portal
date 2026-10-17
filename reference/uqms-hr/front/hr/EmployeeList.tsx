import { useState, useEffect } from 'react';
import { hrService } from '../../api';
import EmployeeForm from './EmployeeForm';
import Pagination from '@/components/Pagination';
import { PageHeader, Badge, EmptyRow } from './hrShared';
import s from './hr.module.css';

export default function EmployeeList({ basePath }: { basePath: string }) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  // Pagination states
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchEmployees = async (currentPage = page, currentLimit = limit) => {
    try {
      setLoading(true);
      const res = await hrService.getEmployees({ page: currentPage, limit: currentLimit });
      if (res.success && res.data) {
        setEmployees(res.data.employees || []);
        setTotal(res.data.total || 0);
        setTotalPages(res.data.pages || 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees(page, limit);
  }, [page, limit]);

  const handleAdd = () => {
    setSelectedEmployee(null);
    setIsFormOpen(true);
  };

  const handleEdit = (emp: any) => {
    setSelectedEmployee(emp);
    setIsFormOpen(true);
  };

  const handleSaved = () => {
    setIsFormOpen(false);
    fetchEmployees(page, limit);
  };

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${total} employee${total === 1 ? '' : 's'}`}
        action={<button className={s.addBtn} onClick={handleAdd}>+ Add Employee</button>}
      />

      {loading ? (
        <p className={s.mutedNote}>Loading employees...</p>
      ) : (
        <>
          <div className={`${s.tableWrap} ${s.spaced}`}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Emp ID</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Job Title</th>
                  <th>Status</th>
                  <th className={s.alignRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp._id}>
                    <td className={s.cellStrong}>{emp.employeeId}</td>
                    <td className={s.cellStrong}>{emp.firstName} {emp.lastName}</td>
                    <td>{emp.department?.name || '—'}</td>
                    <td>{emp.jobTitle?.title || '—'}</td>
                    <td><Badge status={emp.employmentStatus} /></td>
                    <td className={s.alignRight}>
                      <div className={s.actionRow}>
                        <button className={s.actionBtn} onClick={() => handleEdit(emp)}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && <EmptyRow colSpan={6} text="No employees found." />}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            limit={limit}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        </>
      )}

      {isFormOpen && (
        <EmployeeForm
          employee={selectedEmployee}
          onClose={() => setIsFormOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
