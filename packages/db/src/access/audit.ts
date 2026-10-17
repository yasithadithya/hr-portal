import type { TenantDb } from '../index';
import { auditLog } from '../schema/index';

export interface Actor {
  userId: string | null;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
}

export type Tx = Parameters<Parameters<TenantDb['transaction']>[0]>[0];

export interface AuditedChange<T> {
  action: 'create' | 'update' | 'delete' | (string & {});
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  result: T;
}

/** Strips values that must never land in the audit log. */
function redact(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = /password|secret|token/i.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

/**
 * Runs a write in a transaction and appends one audit_log row for it in the same transaction
 * (CLAUDE.md Hard Rules 8 and 9). Every HR-data write goes through this helper.
 */
export async function withAudit<T>(
  db: TenantDb,
  actor: Actor,
  entity: string,
  fn: (tx: Tx) => Promise<AuditedChange<T>>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const change = await fn(tx);
    await tx.insert(auditLog).values({
      actorUserId: actor.userId,
      action: change.action,
      entity,
      entityId: change.entityId,
      before: redact(change.before) as never,
      after: redact(change.after) as never,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent?.slice(0, 500) ?? null,
      requestId: actor.requestId ?? null,
    });
    return change.result;
  });
}
