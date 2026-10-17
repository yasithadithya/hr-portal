import { z } from 'zod';

import { businessDateSchema, workWeekSchema } from '../time/index';

const code = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only')
  .transform((s) => s.toUpperCase());
const name = z.string().trim().min(1).max(120);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s === '' ? null : s));

export const addressSchema = z.object({
  line1: z.string().trim().max(120).optional(),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().max(60).optional(),
  district: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().max(10).optional(),
  country: z.string().trim().max(60).optional(),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Company ──────────────────────────────────────────────────────────────────
export const companyProfileSchema = z.object({
  name,
  legalName: optionalText(160),
  regNo: optionalText(40),
  epfRegNo: optionalText(40),
  etfRegNo: optionalText(40),
  tin: optionalText(40),
  address: addressSchema,
  phone: optionalText(30),
  email: z
    .email()
    .nullable()
    .or(z.literal('').transform(() => null)),
  timezone: z.string().refine(isTimeZone, 'Unknown timezone'),
  currency: z.string().length(3),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});
export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export const companyProfileDtoSchema = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  regNo: z.string().nullable(),
  epfRegNo: z.string().nullable(),
  etfRegNo: z.string().nullable(),
  tin: z.string().nullable(),
  address: addressSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  fiscalYearStartMonth: z.number().int(),
  logoUrl: z.string().nullable(),
});
export type CompanyProfile = z.infer<typeof companyProfileDtoSchema>;

// ── Work calendars & holidays ───────────────────────────────────────────────
export const workCalendarInputSchema = z.object({
  name,
  workWeek: workWeekSchema,
  isDefault: z.boolean().default(false),
});
export type WorkCalendarInput = z.input<typeof workCalendarInputSchema>;
export const workCalendarSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  workWeek: workWeekSchema,
  isDefault: z.boolean(),
  holidayCount: z.number().int(),
});
export type WorkCalendar = z.infer<typeof workCalendarSchema>;

/** Suggested types; the column is free text so clients can add their own. */
export const HOLIDAY_TYPES = ['public', 'bank', 'mercantile', 'poya', 'company'] as const;
export const holidayInputSchema = z.object({
  date: businessDateSchema,
  name: z.string().trim().min(1).max(120),
  type: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(30)
    .regex(/^[a-z_]+$/, 'Lowercase letters only'),
  isVerified: z.boolean().default(false),
});
export type HolidayInput = z.input<typeof holidayInputSchema>;
export const holidaySchema = z.object({
  id: z.uuid(),
  calendarId: z.uuid(),
  date: z.string(),
  name: z.string(),
  type: z.string(),
  isVerified: z.boolean(),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const holidayImportSchema = z.object({
  /** CSV with a header row containing date,name,type (date as YYYY-MM-DD). */
  csv: z.string().max(200_000),
  dryRun: z.boolean().default(true),
});
export const holidayImportResultSchema = z.object({
  valid: z.array(holidaySchema.pick({ date: true, name: true, type: true })),
  errors: z.array(z.object({ line: z.number().int(), message: z.string() })),
  imported: z.number().int(),
});
export type HolidayImportResult = z.infer<typeof holidayImportResultSchema>;

export const holidayCopySchema = z
  .object({
    fromYear: z.number().int().min(2000).max(2100),
    toYear: z.number().int().min(2000).max(2100),
  })
  .refine((v) => v.fromYear !== v.toYear, 'Pick two different years');

// ── Reference data ──────────────────────────────────────────────────────────
export const branchInputSchema = z
  .object({
    code,
    name,
    address: addressSchema.default({}),
    calendarId: z.uuid().nullable().default(null),
    geoLat: z.number().min(-90).max(90).nullable().default(null),
    geoLng: z.number().min(-180).max(180).nullable().default(null),
    geoRadiusM: z.number().int().positive().max(100_000).nullable().default(null),
    allowedIps: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9a-f.:/]+$/i, 'IP address or CIDR'),
      )
      .max(50)
      .default([]),
  })
  .refine((b) => (b.geoLat === null) === (b.geoLng === null), {
    path: ['geoLng'],
    message: 'Set both latitude and longitude, or neither',
  });
export type BranchInput = z.input<typeof branchInputSchema>;
export const branchSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  address: addressSchema,
  calendarId: z.uuid().nullable(),
  geoLat: z.number().nullable(),
  geoLng: z.number().nullable(),
  geoRadiusM: z.number().nullable(),
  allowedIps: z.array(z.string()),
  archived: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const departmentInputSchema = z.object({
  code,
  name,
  parentId: z.uuid().nullable().default(null),
  headEmployeeId: z.uuid().nullable().default(null),
});
export type DepartmentInput = z.input<typeof departmentInputSchema>;
export const departmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  headEmployeeId: z.uuid().nullable(),
  archived: z.boolean(),
});
export type Department = z.infer<typeof departmentSchema>;

export const gradeInputSchema = z.object({ code, name, rank: z.number().int().min(0).max(1000) });
export type GradeInput = z.input<typeof gradeInputSchema>;
export const gradeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  rank: z.number().int(),
  archived: z.boolean(),
});
export type Grade = z.infer<typeof gradeSchema>;

export const designationInputSchema = z.object({
  title: name,
  gradeId: z.uuid().nullable().default(null),
});
export type DesignationInput = z.input<typeof designationInputSchema>;
export const designationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  gradeId: z.uuid().nullable(),
  archived: z.boolean(),
});
export type Designation = z.infer<typeof designationSchema>;

export const costCenterInputSchema = z.object({ code, name });
export type CostCenterInput = z.input<typeof costCenterInputSchema>;
export const costCenterSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  archived: z.boolean(),
});
export type CostCenter = z.infer<typeof costCenterSchema>;

export const archiveSchema = z.object({ archived: z.boolean() });

// ── Numbering ───────────────────────────────────────────────────────────────
export const numberSequenceSchema = z.object({
  key: z.string(),
  prefix: z.string().max(10),
  nextValue: z.number().int().min(1),
  padding: z.number().int().min(0).max(12),
  preview: z.string(),
});
export type NumberSequence = z.infer<typeof numberSequenceSchema>;
export const numberSequenceUpdateSchema = z.object({
  prefix: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9/_-]*$/, 'Letters, digits, -, _ and / only'),
  nextValue: z.number().int().min(1).max(1e12),
  padding: z.number().int().min(0).max(12),
});
export type NumberSequenceUpdate = z.input<typeof numberSequenceUpdateSchema>;

export function formatSequence(s: { prefix: string; padding: number }, value: number): string {
  return `${s.prefix}${String(value).padStart(s.padding, '0')}`;
}
