import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { auditColumns, id } from './columns';
import { employees } from './employees';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  district?: string;
  postalCode?: string;
  country?: string;
}

/** Exactly one row (enforced by the `singleton` column). */
export const companyProfile = pgTable(
  'company_profile',
  {
    id: id(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    regNo: text('reg_no'),
    epfRegNo: text('epf_reg_no'),
    etfRegNo: text('etf_reg_no'),
    tin: text('tin'),
    address: jsonb('address').$type<Address>().notNull().default({}),
    phone: text('phone'),
    email: text('email'),
    logoPath: text('logo_path'),
    timezone: text('timezone').notNull().default('Asia/Colombo'),
    currency: text('currency').notNull().default('LKR'),
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(4),
    ...auditColumns(),
  },
  (t) => [
    check('company_profile_singleton', sql`${t.singleton}`),
    check('company_profile_fy_month', sql`${t.fiscalYearStartMonth} between 1 and 12`),
  ],
).enableRLS();

/** `work_week`: { mon: 'full' | 'half' | 'off', ... } — see @hr/shared/time WorkWeek. */
export const workCalendars = pgTable(
  'work_calendars',
  {
    id: id(),
    name: text('name').notNull().unique(),
    workWeek: jsonb('work_week').$type<Record<string, 'full' | 'half' | 'off'>>().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('work_calendars_one_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
).enableRLS();

/**
 * Holiday `type` is data (public, bank, mercantile, poya, company…); no code branches on it.
 * `is_verified` = HR confirmed it against the official gazette (imports/copies start unverified).
 */
export const holidays = pgTable(
  'holidays',
  {
    id: id(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => workCalendars.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    isVerified: boolean('is_verified').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('holidays_calendar_date_name').on(t.calendarId, t.date, t.name),
    index('holidays_calendar_date').on(t.calendarId, t.date),
  ],
).enableRLS();

export const branches = pgTable(
  'branches',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    address: jsonb('address').$type<Address>().notNull().default({}),
    calendarId: uuid('calendar_id').references(() => workCalendars.id),
    geoLat: numeric('geo_lat', { precision: 9, scale: 6 }),
    geoLng: numeric('geo_lng', { precision: 9, scale: 6 }),
    geoRadiusM: integer('geo_radius_m'),
    allowedIps: text('allowed_ips')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    check('branches_geo_all_or_none', sql`(${t.geoLat} is null) = (${t.geoLng} is null)`),
    check('branches_radius_positive', sql`${t.geoRadiusM} is null or ${t.geoRadiusM} > 0`),
  ],
).enableRLS();

export const departments = pgTable(
  'departments',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id),
    headEmployeeId: uuid('head_employee_id').references((): AnyPgColumn => employees.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    index('departments_parent_idx').on(t.parentId),
    check('departments_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
).enableRLS();

export const grades = pgTable('grades', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  rank: integer('rank').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...auditColumns(),
}).enableRLS();

export const designations = pgTable('designations', {
  id: id(),
  title: text('title').notNull().unique(),
  gradeId: uuid('grade_id').references(() => grades.id),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...auditColumns(),
}).enableRLS();

export const costCenters = pgTable('cost_centers', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...auditColumns(),
}).enableRLS();

/** e.g. key 'employee' → EMP-0001. Incremented under a row lock (see nextSequenceValue). */
export const numberSequences = pgTable(
  'number_sequences',
  {
    id: id(),
    key: text('key').notNull().unique(),
    prefix: text('prefix').notNull().default(''),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    padding: smallint('padding').notNull().default(4),
    ...auditColumns(),
  },
  (t) => [
    check('number_sequences_next_positive', sql`${t.nextValue} >= 1`),
    check('number_sequences_padding', sql`${t.padding} between 0 and 12`),
  ],
).enableRLS();
