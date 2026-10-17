import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';
import { accrualsDue, addMonths, carryForwardExpiry, type PolicyInput } from '@hr/shared/leave';
import type { WorkWeek } from '@hr/shared/time';

const { branches, holidays, leaveLedger, leavePolicies, leaveRequests, leaveTypes, workCalendars } =
  schema;

type Db = TenantDb | Tx;
export type Employee = typeof schema.employees.$inferSelect;
export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type PolicyRow = typeof leavePolicies.$inferSelect;

const n = (v: string | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v);

/** The employee's work calendar (branch calendar, else the default) and its holidays in a range. */
export async function employeeCalendar(db: Db, employee: Employee, from: string, to: string) {
  let calendarId: string | null = null;
  if (employee.branchId) {
    const [b] = await db
      .select({ c: branches.calendarId })
      .from(branches)
      .where(eq(branches.id, employee.branchId));
    calendarId = b?.c ?? null;
  }
  const [cal] = calendarId
    ? await db.select().from(workCalendars).where(eq(workCalendars.id, calendarId))
    : await db.select().from(workCalendars).where(eq(workCalendars.isDefault, true));
  if (!cal) throw new Error('No work calendar configured');
  const hols = await db
    .select({ date: holidays.date, name: holidays.name })
    .from(holidays)
    .where(and(eq(holidays.calendarId, cal.id), gte(holidays.date, from), lte(holidays.date, to)));
  return { calendar: cal, workWeek: cal.workWeek as WorkWeek, holidays: hols };
}

function matches(p: PolicyRow, e: Employee): boolean {
  const a = p.appliesTo ?? {};
  if (a.employmentTypes?.length && !a.employmentTypes.includes(e.employmentType)) return false;
  if (a.gradeIds?.length && (!e.gradeId || !a.gradeIds.includes(e.gradeId))) return false;
  if (a.branchIds?.length && (!e.branchId || !a.branchIds.includes(e.branchId))) return false;
  return true;
}

/** The policy governing `type` for `employee` on `asOf`: lowest priority among matching, latest effective. */
export async function resolvePolicy(db: Db, employee: Employee, leaveTypeId: string, asOf: string) {
  const rows = await db
    .select()
    .from(leavePolicies)
    .where(
      and(
        eq(leavePolicies.leaveTypeId, leaveTypeId),
        eq(leavePolicies.isActive, true),
        lte(leavePolicies.effectiveFrom, asOf),
      ),
    )
    .orderBy(asc(leavePolicies.priority), sql`${leavePolicies.effectiveFrom} desc`);
  return rows.find((p) => matches(p, employee)) ?? null;
}

export function policyInput(p: PolicyRow): PolicyInput {
  return {
    entitlement: p.entitlement,
    accrual: p.accrual,
    prorationOnJoin: p.prorationOnJoin,
    rounding: p.rounding,
    eligibleAfterMonths: p.eligibleAfterMonths,
  };
}

/**
 * Materialises any accrual ledger entries due up to `asOf` for the year. Idempotent via the
 * ledger's `idempotency_key`, so balances never depend on a cron having run.
 */
export async function ensureAccruals(
  db: Db,
  employee: Employee,
  policy: PolicyRow,
  year: number,
  asOf: string,
) {
  const due = accrualsDue(year, employee.joinDate, asOf, policyInput(policy));
  if (!due.length) return;
  await db
    .insert(leaveLedger)
    .values(
      due.map((a) => ({
        employeeId: employee.id,
        leaveTypeId: policy.leaveTypeId,
        periodYear: year,
        entryType: 'accrual' as const,
        amount: String(a.amount),
        idempotencyKey: `acc:${employee.id}:${policy.leaveTypeId}:${a.key}`,
        refType: 'policy',
        refId: policy.id,
        effectiveDate: a.effectiveDate,
        note: `${policy.name}`,
      })),
    )
    .onConflictDoNothing({ target: leaveLedger.idempotencyKey });
}

/**
 * Expires carried-forward leave not used by the policy's expiry date (FIFO: carried days are
 * used first). Lazy and idempotent, like accruals.
 */
export async function ensureCarryExpiry(
  db: Db,
  employee: Employee,
  policy: PolicyRow,
  year: number,
  asOf: string,
) {
  if (!policy.carryForwardExpiryMonths) return;
  const expiresOn = addMonths(`${year}-01-01`, policy.carryForwardExpiryMonths);
  if (asOf < expiresOn) return;
  const [row] = await db
    .select({
      carried: sql<string>`coalesce(sum(${leaveLedger.amount}) filter (where ${leaveLedger.entryType} = 'carry_forward'), 0)`,
      taken: sql<string>`coalesce(-sum(${leaveLedger.amount}) filter (where ${leaveLedger.entryType} in ('taken','reversal') and ${leaveLedger.effectiveDate} < ${expiresOn}), 0)`,
    })
    .from(leaveLedger)
    .where(
      and(
        eq(leaveLedger.employeeId, employee.id),
        eq(leaveLedger.leaveTypeId, policy.leaveTypeId),
        eq(leaveLedger.periodYear, year),
      ),
    );
  const expired = carryForwardExpiry(n(row?.carried), n(row?.taken));
  if (expired <= 0) return;
  await db
    .insert(leaveLedger)
    .values({
      employeeId: employee.id,
      leaveTypeId: policy.leaveTypeId,
      periodYear: year,
      entryType: 'expiry',
      amount: String(-expired),
      idempotencyKey: `exp:${employee.id}:${policy.leaveTypeId}:${year}`,
      refType: 'policy',
      refId: policy.id,
      effectiveDate: expiresOn,
      note: 'Unused carried-forward leave expired',
    })
    .onConflictDoNothing({ target: leaveLedger.idempotencyKey });
}

export interface BalanceFigures {
  entitled: number;
  taken: number;
  pending: number;
  balance: number;
}

/** Ledger balance (+ pending requests, which reserve but don't consume). */
export async function balanceOf(
  db: Db,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  excludeRequestId?: string,
): Promise<BalanceFigures> {
  const [l] = await db
    .select({
      entitled: sql<string>`coalesce(sum(${leaveLedger.amount}) filter (where ${leaveLedger.amount} > 0 and ${leaveLedger.entryType} <> 'reversal'), 0)`,
      taken: sql<string>`coalesce(-sum(${leaveLedger.amount}) filter (where ${leaveLedger.entryType} in ('taken','reversal')), 0)`,
      balance: sql<string>`coalesce(sum(${leaveLedger.amount}), 0)`,
    })
    .from(leaveLedger)
    .where(
      and(
        eq(leaveLedger.employeeId, employeeId),
        eq(leaveLedger.leaveTypeId, leaveTypeId),
        eq(leaveLedger.periodYear, year),
      ),
    );
  const [p] = await db
    .select({ pending: sql<string>`coalesce(sum(${leaveRequests.amount}), 0)` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.leaveTypeId, leaveTypeId),
        eq(leaveRequests.periodYear, year),
        eq(leaveRequests.status, 'pending'),
        excludeRequestId ? sql`${leaveRequests.id} <> ${excludeRequestId}` : undefined,
      ),
    );
  return {
    entitled: n(l?.entitled),
    taken: n(l?.taken),
    pending: n(p?.pending),
    balance: n(l?.balance),
  };
}

/** All active types with balances for an employee (accruals materialised first). */
export async function balancesFor(db: Db, employee: Employee, year: number, asOf: string) {
  const types = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.isActive, true))
    .orderBy(asc(leaveTypes.sortOrder));
  const out = [];
  for (const t of types) {
    if (t.genderRestriction && employee.gender && t.genderRestriction !== employee.gender) continue;
    const policy = await resolvePolicy(db, employee, t.id, asOf);
    if (policy) {
      await ensureAccruals(db, employee, policy, year, asOf);
      await ensureCarryExpiry(db, employee, policy, year, asOf);
    }
    const b = await balanceOf(db, employee.id, t.id, year);
    out.push({ type: t, policy, ...b, available: b.balance - b.pending });
  }
  return out;
}

export async function typesById(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, LeaveTypeRow>();
  const rows = await db.select().from(leaveTypes).where(inArray(leaveTypes.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
