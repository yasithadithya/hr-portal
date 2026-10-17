import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { id } from './columns';

/**
 * Append-only audit trail (CLAUDE.md Hard Rule 8). A trigger in the migration rejects UPDATE,
 * DELETE and TRUNCATE for every role. Exempt from audit columns: the row *is* the audit.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId, t.at),
    index('audit_log_actor_idx').on(t.actorUserId, t.at),
    index('audit_log_at_idx').on(t.at),
  ],
).enableRLS();
