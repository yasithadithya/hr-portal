import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { Scope } from '@hr/shared/permissions';

/**
 * Row filter for a scoped permission (CLAUDE.md Hard Rule 7). `employeeColumn` is the column that
 * holds the owning employee's id on the table being queried.
 *  - all  → no restriction
 *  - team → the actor plus their recursive reports_to subtree
 *  - self → only the actor's own rows
 * An actor without a linked employee sees nothing under self/team.
 */
export function scopeCondition(
  scope: Scope,
  actorEmployeeId: string | null,
  employeeColumn: AnyColumn | SQL,
): SQL {
  if (scope === 'all') return sql`true`;
  if (!actorEmployeeId) return sql`false`;
  if (scope === 'self') return sql`${employeeColumn} = ${actorEmployeeId}`;
  return sql`${employeeColumn} in (${teamSubquery(actorEmployeeId)})`;
}

/** SELECT of employee ids in the actor's team (self + all direct and indirect reports). */
export function teamSubquery(managerEmployeeId: string): SQL {
  return sql`
    with recursive team(id, depth) as (
      select e.id, 0 from employees e where e.id = ${managerEmployeeId}
      union
      select e.id, t.depth + 1 from employees e join team t on e.reports_to_id = t.id
      where t.depth < 50
    )
    select id from team`;
}
