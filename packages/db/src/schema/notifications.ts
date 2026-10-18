import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { appUsers } from './auth';
import { auditColumns, id } from './columns';
import { employees } from './employees';

/**
 * Notifications (PLAN.md Phase 8). Every notification is stored in-app; email and web push are
 * extra channels delivered by a background job, subject to each user's preferences.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => appUsers.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** App-relative path, e.g. /approvals. */
    link: text('link'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** Reminders are sent once per subject (e.g. `doc-expiry:<docId>:<date>`). */
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [
    index('notifications_user_unread').on(t.userId, t.readAt, t.createdAt),
    uniqueIndex('notifications_dedupe')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
).enableRLS();

/** Missing row = defaults (email and push on). In-app cannot be turned off. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => appUsers.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    email: boolean('email').notNull().default(true),
    push: boolean('push').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event] })],
).enableRLS();

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references((): AnyPgColumn => appUsers.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...auditColumns(),
  },
  (t) => [index('push_subscriptions_user').on(t.userId)],
).enableRLS();

export const PROFILE_SECTIONS = ['personal', 'contact', 'bank'] as const;

/** Self-service profile edits: the employee asks, HR applies (PLAN.md Phase 8). */
export const profileChangeRequests = pgTable(
  'profile_change_requests',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id, { onDelete: 'cascade' }),
    section: text('section', { enum: PROFILE_SECTIONS }).notNull(),
    /** field → { from, to } */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    note: text('note'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'withdrawn'] })
      .notNull()
      .default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...auditColumns(),
  },
  (t) => [
    index('profile_change_requests_status').on(t.status, t.employeeId),
    check(
      'profile_change_requests_status_check',
      sql`${t.status} in ('pending','approved','rejected','withdrawn')`,
    ),
  ],
).enableRLS();
