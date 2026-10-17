import { z } from 'zod';

import { isValidNic, normaliseNic } from '../nic';
import { businessDateSchema } from '../time/index';

import { addressSchema } from './org';

export const EMPLOYEE_STATUSES = [
  'active',
  'on_probation',
  'notice',
  'resigned',
  'terminated',
  'retired',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
/** Statuses that still count as employed (payroll, leave, attendance). */
export const CURRENT_STATUSES: EmployeeStatus[] = ['active', 'on_probation', 'notice'];

export const EMPLOYMENT_TYPES = [
  'permanent',
  'contract',
  'probation',
  'intern',
  'part_time',
  'consultant',
] as const;
export const GENDERS = ['male', 'female', 'other'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'other'] as const;
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

const blankToNull = (s: string | null | undefined) => (s === '' || s === undefined ? null : s);
const optText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform(blankToNull);
const optDate = businessDateSchema
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);
const optUuid = z
  .uuid()
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);

export const nicSchema = z
  .string()
  .trim()
  .transform(normaliseNic)
  .refine(isValidNic, 'Not a valid Sri Lankan NIC (9 digits + V/X, or 12 digits)');

// ── Personal ────────────────────────────────────────────────────────────────
export const personalSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  nameWithInitials: optText(120),
  preferredName: optText(80),
  nic: nicSchema
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  passportNo: optText(20),
  dob: optDate,
  gender: z
    .enum(GENDERS)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  maritalStatus: z
    .enum(MARITAL_STATUSES)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  nationality: optText(40),
  religion: optText(40),
  personalEmail: z
    .email()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  workEmail: z
    .email()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  mobile: optText(20),
  address: addressSchema.default({}),
});
export type PersonalInput = z.input<typeof personalSchema>;

export const bankStatutorySchema = z.object({
  bankName: optText(60),
  bankBranch: optText(60),
  bankAccountNo: z
    .string()
    .trim()
    .regex(/^[0-9 -]{4,30}$/, 'Digits only')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null),
  bankAccountName: optText(120),
  epfNo: optText(20),
  etfNo: optText(20),
  taxFileNo: optText(30),
});
export type BankStatutoryInput = z.input<typeof bankStatutorySchema>;

// ── Job ─────────────────────────────────────────────────────────────────────
export const jobFieldsSchema = z.object({
  branchId: optUuid,
  departmentId: optUuid,
  designationId: optUuid,
  gradeId: optUuid,
  costCenterId: optUuid,
  reportsToId: optUuid,
  employmentType: z.enum(EMPLOYMENT_TYPES),
});
export type JobFields = z.infer<typeof jobFieldsSchema>;

export const hireSchema = personalSchema
  .extend(jobFieldsSchema.shape)
  .extend(bankStatutorySchema.shape)
  .extend({
    /** Leave blank to take the next number from the employee sequence. */
    employeeNo: optText(30),
    joinDate: businessDateSchema,
    probationEndDate: optDate,
    contractEndDate: optDate,
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate >= v.joinDate, {
    path: ['probationEndDate'],
    message: 'Probation must end after the join date',
  })
  .refine((v) => !v.contractEndDate || v.contractEndDate >= v.joinDate, {
    path: ['contractEndDate'],
    message: 'Contract must end after the join date',
  });
export type HireInput = z.input<typeof hireSchema>;

export const jobChangeSchema = jobFieldsSchema.extend({
  effectiveFrom: businessDateSchema,
  reason: z.enum(JOB_CHANGE_REASONS).exclude(['hire']),
  notes: optText(500),
});
export type JobChangeInput = z.input<typeof jobChangeSchema>;

export const confirmSchema = z.object({ confirmationDate: businessDateSchema });
export const noticeSchema = z.object({
  exitDate: businessDateSchema,
  exitReason: z.string().trim().min(1).max(200),
});
export const exitSchema = z.object({
  exitDate: businessDateSchema,
  status: z.enum(['resigned', 'terminated', 'retired']),
  exitReason: z.string().trim().min(1).max(200),
});
export const datesSchema = z.object({
  joinDate: businessDateSchema,
  probationEndDate: optDate,
  contractEndDate: optDate,
});

// ── Read models ─────────────────────────────────────────────────────────────
const ref = z.object({ id: z.uuid(), name: z.string() }).nullable();

export const employeeListItemSchema = z.object({
  id: z.uuid(),
  employeeNo: z.string(),
  name: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  branch: z.string().nullable(),
  status: z.enum(EMPLOYEE_STATUSES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  joinDate: z.string(),
  workEmail: z.string().nullable(),
});
export type EmployeeListItem = z.infer<typeof employeeListItemSchema>;

export const EMPLOYEE_SORTS = ['employeeNo', 'name', 'joinDate', 'department'] as const;
export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  departmentId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  status: z.enum([...EMPLOYEE_STATUSES, 'current', 'all']).default('current'),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  sort: z.enum(EMPLOYEE_SORTS).default('employeeNo'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(25),
});
/** Client-side list parameters (all optional; the API fills defaults). */
export type EmployeeListQuery = Partial<z.output<typeof employeeListQuerySchema>>;

export const employeePageSchema = z.object({
  items: z.array(employeeListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const jobHistoryItemSchema = z.object({
  id: z.uuid(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  reason: z.enum(JOB_CHANGE_REASONS),
  notes: z.string().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  branch: ref,
  department: ref,
  designation: ref,
  grade: ref,
  costCenter: ref,
  reportsTo: ref,
});
export type JobHistoryItem = z.infer<typeof jobHistoryItemSchema>;

/**
 * Detail view. `access: 'work'` (e.g. a manager looking at their team) omits personal and
 * bank/statutory data — those fields are null — while `full` (self, HR) includes them.
 */
export const employeeDetailSchema = z.object({
  access: z.enum(['full', 'work']),
  id: z.uuid(),
  employeeNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  workEmail: z.string().nullable(),
  status: z.enum(EMPLOYEE_STATUSES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  joinDate: z.string(),
  probationEndDate: z.string().nullable(),
  confirmationDate: z.string().nullable(),
  contractEndDate: z.string().nullable(),
  exitDate: z.string().nullable(),
  exitReason: z.string().nullable(),
  branch: ref,
  department: ref,
  designation: ref,
  grade: ref,
  costCenter: ref,
  reportsTo: ref,
  hasPhoto: z.boolean(),
  personal: personalSchema
    .omit({ firstName: true, lastName: true, preferredName: true, workEmail: true })
    .extend({
      nic: z.string().nullable(),
      dob: z.string().nullable(),
      personalEmail: z.string().nullable(),
    })
    .nullable(),
  bank: z
    .object({
      bankName: z.string().nullable(),
      bankBranch: z.string().nullable(),
      bankAccountNo: z.string().nullable(),
      bankAccountName: z.string().nullable(),
      epfNo: z.string().nullable(),
      etfNo: z.string().nullable(),
      taxFileNo: z.string().nullable(),
    })
    .nullable(),
});
export type EmployeeDetail = z.infer<typeof employeeDetailSchema>;

// ── Contacts & documents ────────────────────────────────────────────────────
export const contactInputSchema = z.object({
  type: z.enum(['emergency', 'dependent']),
  name: z.string().trim().min(1).max(120),
  relationship: optText(40),
  phone: optText(20),
  dob: optDate,
});
export type ContactInput = z.input<typeof contactInputSchema>;
export const contactSchema = z.object({
  id: z.uuid(),
  type: z.enum(['emergency', 'dependent']),
  name: z.string(),
  relationship: z.string().nullable(),
  phone: z.string().nullable(),
  dob: z.string().nullable(),
});
export type Contact = z.infer<typeof contactSchema>;

export const DOCUMENT_CATEGORIES = [
  'identity',
  'contract',
  'certificate',
  'medical',
  'letter',
  'other',
] as const;
export const documentMetaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1).max(120),
  expiryDate: optDate,
});
export const documentSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  title: z.string(),
  mime: z.string(),
  size: z.number(),
  expiryDate: z.string().nullable(),
  uploadedAt: z.string(),
});
export type EmployeeDocument = z.infer<typeof documentSchema>;

export const expiringDocumentSchema = documentSchema.extend({
  employeeId: z.uuid(),
  employeeNo: z.string(),
  employeeName: z.string(),
  daysLeft: z.number().int(),
});

export const orgChartNodeSchema = z.object({
  id: z.uuid(),
  employeeNo: z.string(),
  name: z.string(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  reportsToId: z.uuid().nullable(),
});
export type OrgChartNode = z.infer<typeof orgChartNodeSchema>;

export const upcomingEventSchema = z.object({
  employeeId: z.uuid(),
  employeeNo: z.string(),
  name: z.string(),
  kind: z.enum(['probation_end', 'contract_end', 'exit']),
  date: z.string(),
});
