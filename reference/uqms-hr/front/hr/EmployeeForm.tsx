import { useState, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { toast } from 'react-toastify';
import { hrService, usersService, type ApiUserDirectoryEntry } from '../../api';
import { Modal, Field } from './hrShared';
import s from './hr.module.css';

import { Button, Input, Select } from '@/ui';
const toDateInput = (d?: string | Date | null) => (d ? new Date(d).toISOString().split('T')[0] : '');

export default function EmployeeForm({ employee, onClose, onSaved }: { employee?: any, onClose: () => void, onSaved: () => void }) {
  // The directory is readable by every signed-in user, so HR staff without User Management can link accounts.
  const [users, setUsers] = useState<ApiUserDirectoryEntry[]>([]);
  useEffect(() => {
    usersService.getDirectory()
      .then(res => { if (res.success) setUsers(res.data); })
      .catch(() => toast.error('Could not load user accounts for linking.'));
  }, []);
  const [formData, setFormData] = useState({
    firstName: employee?.firstName || '',
    lastName: employee?.lastName || '',
    nic: employee?.nic || '',
    companyEmail: employee?.companyEmail || '',
    personalEmail: employee?.personalEmail || '',
    phone: employee?.phone || '',
    gender: employee?.gender || 'Male',
    employmentType: employee?.employmentType || 'Permanent',
    employmentStatus: employee?.employmentStatus || 'Active',
    department: employee?.department?._id || employee?.department || '',
    jobTitle: employee?.jobTitle?._id || employee?.jobTitle || '',
    reportsTo: employee?.reportsTo?._id || employee?.reportsTo || '',
    dateOfBirth: toDateInput(employee?.dateOfBirth),
    joinedDate: toDateInput(employee?.joinedDate),
    probationEndDate: toDateInput(employee?.probationEndDate),
    confirmationDate: toDateInput(employee?.confirmationDate),
    maritalStatus: employee?.maritalStatus || 'Single',
    userId: employee?.userId || '',
    address: {
      street: employee?.address?.street || '',
      city: employee?.address?.city || '',
      district: employee?.address?.district || '',
      province: employee?.address?.province || '',
      postalCode: employee?.address?.postalCode || '',
    },
    emergencyContact: {
      name: employee?.emergencyContact?.name || '',
      relationship: employee?.emergencyContact?.relationship || '',
      phone: employee?.emergencyContact?.phone || '',
    },
  });

  const [departments, setDepartments] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      hrService.getDepartments(),
      hrService.getJobTitles(),
      hrService.getEmployees({ limit: 100, status: 'Active' }),
    ]).then(([deptRes, jobRes, empRes]) => {
      if (deptRes.success) setDepartments(deptRes.data);
      if (jobRes.success) setJobTitles(jobRes.data);
      if (empRes.success) setManagers((empRes.data?.employees || []).filter((e: any) => e._id !== employee?._id));
    }).catch(() => toast.error('Failed to load form data'));
  }, [employee?._id]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleNestedChange = (group: 'address' | 'emergencyContact') => (e: ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [group]: { ...formData[group], [e.target.name]: e.target.value } });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: any = { ...formData };
      // Empty strings break ObjectId/date casting — strip them
      ['department', 'jobTitle', 'reportsTo', 'dateOfBirth', 'joinedDate', 'probationEndDate', 'confirmationDate', 'userId'].forEach(k => {
        if (!payload[k]) delete payload[k];
      });
      if (employee?._id && !formData.userId) payload.userId = null;

      let savedId = employee?._id;
      if (employee?._id) {
        await hrService.updateEmployee(employee._id, payload);
      } else {
        const res = await hrService.createEmployee(payload);
        savedId = res.data?._id;
      }

      if (photoFile && savedId) {
        const fd = new FormData();
        fd.append('photo', photoFile);
        try {
          await hrService.uploadPhoto(savedId, fd);
        } catch (err: any) {
          toast.warn(`Employee saved, but photo upload failed: ${err.message}`);
        }
      }

      toast.success(employee?._id ? 'Employee updated' : 'Employee created');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Error saving employee');
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
      <Button variant="primary" type="submit" form="employee-form" disabled={loading}>
        {loading ? 'Saving...' : 'Save Employee'}
      </Button>
    </>
  );

  return (
    <Modal title={employee ? `Edit Employee — ${employee.employeeId}` : 'Add Employee'} onClose={onClose} size="wide" footer={footer}>
      <form id="employee-form" onSubmit={handleSubmit}>
        <div className={s.formSection}>Personal Information</div>
        <div className={`${s.modalGrid}`}>
          <Field label="First Name" required>
            <Input type="text" name="firstName" value={formData.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Last Name" required>
            <Input type="text" name="lastName" value={formData.lastName} onChange={handleChange} required />
          </Field>
          <Field label="NIC" required>
            <Input type="text" name="nic" value={formData.nic} onChange={handleChange} required />
          </Field>
          <Field label="Date of Birth">
            <Input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} />
          </Field>
          <Field label="Gender">
            <Select name="gender" value={formData.gender} onChange={handleChange}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Marital Status">
            <Select name="maritalStatus" value={formData.maritalStatus} onChange={handleChange}>
              <option value="Single">Single</option>
              <option value="Married">Married</option>
              <option value="Divorced">Divorced</option>
              <option value="Widowed">Widowed</option>
            </Select>
          </Field>
          <Field label="Company Email" required>
            <Input type="email" name="companyEmail" value={formData.companyEmail} onChange={handleChange} required />
          </Field>
          <Field label="Personal Email">
            <Input type="email" name="personalEmail" value={formData.personalEmail} onChange={handleChange} />
          </Field>
          <Field label="Phone" required>
            <Input type="text" name="phone" value={formData.phone} onChange={handleChange} required />
          </Field>
          <Field label="Profile Photo">
            <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => setPhotoFile(e.target.files?.[0] || null)} />
          </Field>
        </div>

        <div className={s.formSection}>Address</div>
        <div className={s.modalGrid}>
          <Field label="Street" full>
            <Input type="text" name="street" value={formData.address.street} onChange={handleNestedChange('address')} />
          </Field>
          <Field label="City">
            <Input type="text" name="city" value={formData.address.city} onChange={handleNestedChange('address')} />
          </Field>
          <Field label="District">
            <Input type="text" name="district" value={formData.address.district} onChange={handleNestedChange('address')} />
          </Field>
          <Field label="Province">
            <Input type="text" name="province" value={formData.address.province} onChange={handleNestedChange('address')} />
          </Field>
          <Field label="Postal Code">
            <Input type="text" name="postalCode" value={formData.address.postalCode} onChange={handleNestedChange('address')} />
          </Field>
        </div>

        <div className={s.formSection}>Employment</div>
        <div className={s.modalGrid}>
          <Field label="Department">
            <Select name="department" value={formData.department} onChange={handleChange}>
              <option value="">Select Department</option>
              {departments.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Job Title">
            <Select name="jobTitle" value={formData.jobTitle} onChange={handleChange}>
              <option value="">Select Title</option>
              {jobTitles.map(j => <option key={j._id} value={j._id}>{j.title}</option>)}
            </Select>
          </Field>
          <Field label="Employment Type">
            <Select name="employmentType" value={formData.employmentType} onChange={handleChange}>
              <option value="Permanent">Permanent</option>
              <option value="Contract">Contract</option>
              <option value="Intern">Intern</option>
              <option value="PartTime">Part Time</option>
            </Select>
          </Field>
          {employee?._id && (
            <Field label="Employment Status">
              <Select name="employmentStatus" value={formData.employmentStatus} onChange={handleChange}>
                <option value="Active">Active</option>
                <option value="OnProbation">On Probation</option>
                <option value="Resigned">Resigned</option>
                <option value="Terminated">Terminated</option>
              </Select>
            </Field>
          )}
          <Field label="Reports To">
            <Select name="reportsTo" value={formData.reportsTo} onChange={handleChange}>
              <option value="">None</option>
              {managers.map(m => <option key={m._id} value={m._id}>{m.firstName} {m.lastName} ({m.employeeId})</option>)}
            </Select>
          </Field>
          <Field label="Joined Date">
            <Input type="date" name="joinedDate" value={formData.joinedDate} onChange={handleChange} />
          </Field>
          <Field label="Probation End Date">
            <Input type="date" name="probationEndDate" value={formData.probationEndDate} onChange={handleChange} />
          </Field>
          <Field label="Confirmation Date">
            <Input type="date" name="confirmationDate" value={formData.confirmationDate} onChange={handleChange} />
          </Field>
        </div>

        <div className={s.formSection}>Emergency Contact</div>
        <div className={s.modalGrid}>
          <Field label="Name">
            <Input type="text" name="name" value={formData.emergencyContact.name} onChange={handleNestedChange('emergencyContact')} />
          </Field>
          <Field label="Relationship">
            <Input type="text" name="relationship" value={formData.emergencyContact.relationship} onChange={handleNestedChange('emergencyContact')} />
          </Field>
          <Field label="Phone">
            <Input type="text" name="phone" value={formData.emergencyContact.phone} onChange={handleNestedChange('emergencyContact')} />
          </Field>
        </div>

        <div className={s.formSection}>System Account (Self-Service)</div>
        <Field label="Linked User Account">
          <Select name="userId" value={formData.userId} onChange={handleChange}>
            <option value="">Not linked</option>
            {users.map(u => (
              <option key={u._id} value={u._id}>{u.fullName || u.username} ({u.username})</option>
            ))}
          </Select>
          <p className={s.hint}>
            Linking lets this employee use the "My HR" self-service portal (own payslips, leave, attendance).
          </p>
        </Field>
      </form>
    </Modal>
  );
}
