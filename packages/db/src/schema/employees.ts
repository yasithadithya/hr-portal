import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';
import { branches, costCenters, departments, designations, grades, type Address } from './org';

export const EMPLOYEE_STATUSES = [
  'active',
  'on_probation',
  'notice',
  'resigned',
  'terminated',
  'retired',
] as const;

export const EMPLOYMENT_TYPES = [
  'permanent',
  'contract',
  'probation',
  'intern',
  'part_time',
  'consultant',
] as const;

/**
 * Employee master (PLAN.md Phase 4). Job fields (branch … employment_type) are a *projection*
 * of the employee_job_history row covering today, kept in sync in the same transaction.
 */
export const employees = pgTable(
  'employees',
  {
    id: id(),
    employeeNo: text('employee_no').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    nameWithInitials: text('name_with_initials'),
    preferredName: text('preferred_name'),
    nic: text('nic'),
    passportNo: text('passport_no'),
    dob: date('dob'),
    gender: text('gender', { enum: ['male', 'female', 'other'] }),
    maritalStatus: text('marital_status', {
      enum: ['single', 'married', 'divorced', 'widowed', 'other'],
    }),
    nationality: text('nationality'),
    religion: text('religion'),
    personalEmail: text('personal_email'),
    workEmail: text('work_email'),
    mobile: text('mobile'),
    address: jsonb('address').$type<Address>().notNull().default({}),
    photoPath: text('photo_path'),

    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id),
    designationId: uuid('designation_id').references((): AnyPgColumn => designations.id),
    gradeId: uuid('grade_id').references((): AnyPgColumn => grades.id),
    costCenterId: uuid('cost_center_id').references((): AnyPgColumn => costCenters.id),
    reportsToId: uuid('reports_to_id').references((): AnyPgColumn => employees.id),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES })
      .notNull()
      .default('permanent'),

    status: text('status', { enum: EMPLOYEE_STATUSES }).notNull().default('active'),
    joinDate: date('join_date').notNull(),
    probationEndDate: date('probation_end_date'),
    confirmationDate: date('confirmation_date'),
    contractEndDate: date('contract_end_date'),
    exitDate: date('exit_date'),
    exitReason: text('exit_reason'),

    bankName: text('bank_name'),
    bankBranch: text('bank_branch'),
    bankAccountNo: text('bank_account_no'),
    bankAccountName: text('bank_account_name'),
    epfNo: text('epf_no'),
    etfNo: text('etf_no'),
    taxFileNo: text('tax_file_no'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    index('employees_reports_to_idx').on(t.reportsToId),
    index('employees_department_idx').on(t.departmentId),
    index('employees_branch_idx').on(t.branchId),
    index('employees_status_idx').on(t.status),
    uniqueIndex('employees_nic_unique')
      .on(t.nic)
      .where(sql`${t.nic} is not null`),
    uniqueIndex('employees_epf_unique')
      .on(t.epfNo)
      .where(sql`${t.epfNo} is not null`),
    check(
      'employees_status_check',
      sql`${t.status} in ('active','on_probation','notice','resigned','terminated','retired')`,
    ),
    check(
      'employees_type_check',
      sql`${t.employmentType} in ('permanent','contract','probation','intern','part_time','consultant')`,
    ),
    check(
      'employees_not_own_manager',
      sql`${t.reportsToId} is null or ${t.reportsToId} <> ${t.id}`,
    ),
    check(
      'employees_exit_after_join',
      sql`${t.exitDate} is null or ${t.exitDate} >= ${t.joinDate}`,
    ),
  ],
).enableRLS();

export const JOB_CHANGE_REASONS = [
  'hire',
  'promotion',
  'transfer',
  'redesignation',
  'confirmation',
  'type_change',
  'manager_change',
  'correction',
  'other',
] as const;

/** Effective-dated job history: answers "what was X's department on date D". */
export const employeeJobHistory = pgTable(
  'employee_job_history',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from').notNull(),
    /** Inclusive; null = still current. */
    effectiveTo: date('effective_to'),
    branchId: uuid('branch_id').references((): AnyPgColumn => branches.id),
    departmentId: uuid('department_id').references((): AnyPgColumn => departments.id),
    designationId: uuid('designation_id').references((): AnyPgColumn => designations.id),
    gradeId: uuid('grade_id').references((): AnyPgColumn => grades.id),
    costCenterId: uuid('cost_center_id').references((): AnyPgColumn => costCenters.id),
    reportsToId: uuid('reports_to_id').references((): AnyPgColumn => employees.id),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES }).notNull(),
    reason: text('reason', { enum: JOB_CHANGE_REASONS }).notNull(),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('job_history_employee_from').on(t.employeeId, t.effectiveFrom),
    index('job_history_employee_range').on(t.employeeId, t.effectiveFrom, t.effectiveTo),
    check(
      'job_history_range',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

export const employeeContacts = pgTable(
  'employee_contacts',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['emergency', 'dependent'] }).notNull(),
    name: text('name').notNull(),
    relationship: text('relationship'),
    phone: text('phone'),
    dob: date('dob'),
    ...auditColumns(),
  },
  (t) => [index('employee_contacts_employee_idx').on(t.employeeId)],
).enableRLS();

export const employeeDocuments = pgTable(
  'employee_documents',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    title: text('title').notNull(),
    storagePath: text('storage_path').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    expiryDate: date('expiry_date'),
    uploadedBy: uuid('uploaded_by'),
    ...auditColumns(),
  },
  (t) => [
    index('employee_documents_employee_idx').on(t.employeeId),
    index('employee_documents_expiry_idx').on(t.expiryDate),
  ],
).enableRLS();

/** Self-service edit requests, reviewed by HR (used by the Phase 8 self-service area). */
export const employeeChangeRequests = pgTable(
  'employee_change_requests',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'withdrawn'] })
      .notNull()
      .default('pending'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    ...auditColumns(),
  },
  (t) => [index('employee_change_requests_employee_idx').on(t.employeeId, t.status)],
).enableRLS();
