import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import { appendAudit, schema, withAudit, type Actor, type TenantDb, type Tx } from '@hr/db';
import { addDays } from '@hr/shared/time';

import type { RequestContext } from '../../context';
import type { Storage } from '../../lib/storage';

/**
 * PDPA readiness (Sri Lanka Personal Data Protection Act, PLAN.md Phase 10). Data-subject export,
 * retention-based anonymisation and logging of access to sensitive data. Legal periods and wording
 * are tenant settings — nothing here decides what the law requires.
 */
const {
  appUsers,
  attendanceDays,
  attendancePunches,
  auditLog,
  employeeContacts,
  employeeDocuments,
  employeeJobHistory,
  employees,
  leaveLedger,
  leaveRequests,
  notifications,
  payslipLines,
  payslips,
  payrollRuns,
  payrollPeriods,
  profileChangeRequests,
  regularizationRequests,
} = schema;
type Db = TenantDb | Tx;

const DOC_BUCKET = 'employee-documents';
const PHOTO_BUCKET = 'employee-photos';
const EXITED = ['resigned', 'terminated', 'retired'] as const;

/** Everything held about one employee, as one JSON package. */
export async function dataExport(db: Db, employeeId: string) {
  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee) return null;
  const users = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      status: appUsers.status,
      lastLoginAt: appUsers.lastLoginAt,
    })
    .from(appUsers)
    .where(eq(appUsers.employeeId, employeeId));
  const userIds = users.map((u) => u.id);
  const slips = await db
    .select({ s: payslips, p: payrollPeriods, r: payrollRuns })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
    .where(
      and(eq(payslips.employeeId, employeeId), inArray(payrollRuns.status, ['locked', 'paid'])),
    )
    .orderBy(asc(payrollPeriods.startDate));
  const lines = slips.length
    ? await db
        .select()
        .from(payslipLines)
        .where(
          inArray(
            payslipLines.payslipId,
            slips.map((x) => x.s.id),
          ),
        )
    : [];
  const docs = await db
    .select()
    .from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employeeId));
  return {
    generatedAt: new Date().toISOString(),
    note: 'Personal data held by this employer about the employee. Document files are listed, not attached; request copies from HR.',
    employee,
    accounts: users,
    jobHistory: await db
      .select()
      .from(employeeJobHistory)
      .where(eq(employeeJobHistory.employeeId, employeeId))
      .orderBy(asc(employeeJobHistory.effectiveFrom)),
    emergencyContacts: await db
      .select()
      .from(employeeContacts)
      .where(eq(employeeContacts.employeeId, employeeId)),
    documents: docs.map(({ storagePath, ...d }) => {
      void storagePath;
      return d;
    }),
    leave: {
      requests: await db
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.employeeId, employeeId)),
      ledger: await db.select().from(leaveLedger).where(eq(leaveLedger.employeeId, employeeId)),
    },
    attendance: {
      days: await db
        .select()
        .from(attendanceDays)
        .where(eq(attendanceDays.employeeId, employeeId))
        .orderBy(asc(attendanceDays.date)),
      punches: await db
        .select()
        .from(attendancePunches)
        .where(eq(attendancePunches.employeeId, employeeId))
        .orderBy(asc(attendancePunches.at)),
      corrections: await db
        .select()
        .from(regularizationRequests)
        .where(eq(regularizationRequests.employeeId, employeeId)),
    },
    payslips: slips.map(({ s, p }) => ({
      month: `${p.year}-${String(p.month).padStart(2, '0')}`,
      payDate: p.payDate,
      gross: s.gross,
      deductions: s.totalDeductions,
      net: s.net,
      lines: lines
        .filter((l) => l.payslipId === s.id)
        .map((l) => ({ code: l.code, name: l.name, kind: l.kind, amount: l.amount })),
    })),
    profileChangeRequests: await db
      .select()
      .from(profileChangeRequests)
      .where(eq(profileChangeRequests.employeeId, employeeId)),
    notifications: userIds.length
      ? await db.select().from(notifications).where(inArray(notifications.userId, userIds))
      : [],
    auditTrail: await db
      .select({ at: auditLog.at, entity: auditLog.entity, action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, employeeId))
      .orderBy(desc(auditLog.at))
      .limit(5000),
  };
}

/** Former employees whose retention period has passed and who still hold personal data. */
export async function retentionCandidates(db: Db, today: string, years: number) {
  const cutoff = addDays(today, -Math.round(years * 365.25));
  return db
    .select({ id: employees.id, employeeNo: employees.employeeNo, exitDate: employees.exitDate })
    .from(employees)
    .where(
      and(
        isNull(employees.anonymizedAt),
        isNotNull(employees.exitDate),
        lt(employees.exitDate, cutoff),
        inArray(employees.status, EXITED),
      ),
    )
    .orderBy(asc(employees.exitDate));
}

/**
 * Removes personal data but keeps the records employers must keep (payroll, EPF/ETF numbers,
 * tax file number, leave and attendance history) under the employee number. Linked user accounts
 * are disabled and unlinked. The append-only audit log keeps its history (it is the legal record of
 * who changed what); this is documented for clients.
 */
export async function anonymizeEmployee(
  db: TenantDb,
  actor: Actor,
  employeeId: string,
  storage: Storage | null,
): Promise<{ files: number }> {
  const files: { bucket: string; path: string }[] = [];
  await withAudit(db, actor, 'employees', async (tx) => {
    const [e] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for('update');
    if (!e || e.anonymizedAt)
      return { action: 'anonymize_skipped', entityId: employeeId, result: null };
    const docs = await tx
      .select()
      .from(employeeDocuments)
      .where(eq(employeeDocuments.employeeId, employeeId));
    for (const d of docs) files.push({ bucket: DOC_BUCKET, path: d.storagePath });
    if (e.photoPath) files.push({ bucket: PHOTO_BUCKET, path: e.photoPath });
    await tx.delete(employeeDocuments).where(eq(employeeDocuments.employeeId, employeeId));
    await tx.delete(employeeContacts).where(eq(employeeContacts.employeeId, employeeId));
    await tx.delete(profileChangeRequests).where(eq(profileChangeRequests.employeeId, employeeId));
    await tx
      .update(employees)
      .set({
        firstName: 'Former',
        lastName: 'employee',
        nameWithInitials: null,
        preferredName: null,
        nic: null,
        passportNo: null,
        dob: null,
        gender: null,
        maritalStatus: null,
        nationality: null,
        religion: null,
        personalEmail: null,
        workEmail: null,
        mobile: null,
        address: {},
        photoPath: null,
        bankName: null,
        bankBranch: null,
        bankAccountNo: null,
        bankAccountName: null,
        exitReason: null,
        anonymizedAt: new Date(),
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId));
    const users = await tx
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.employeeId, employeeId));
    for (const u of users) {
      await tx
        .update(appUsers)
        .set({
          status: 'disabled',
          employeeId: null,
          email: `removed+${u.id}@anonymized.invalid`,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, u.id));
      await appendAudit(tx, actor, 'app_users', { action: 'anonymize', entityId: u.id });
    }
    return {
      action: 'anonymize',
      entityId: employeeId,
      after: { employeeNo: e.employeeNo, documents: docs.length, accounts: users.length },
      result: null,
    };
  });
  let removed = 0;
  if (storage) {
    for (const f of files) {
      try {
        await storage.remove(f.bucket, f.path);
        removed++;
      } catch {
        // A missing object is fine; anything else is retried by the next run's cleanup.
      }
    }
  }
  return { files: removed };
}

/**
 * Logs a read of sensitive fields (NIC, bank, salary, payslips) by someone other than the person
 * themselves. Viewing is not a change, so it goes to the audit log as its own action.
 */
export async function auditSensitiveRead(
  ctx: RequestContext,
  entity: string,
  entityId: string,
  action: string,
  subjectEmployeeId: string | null,
) {
  if (subjectEmployeeId && subjectEmployeeId === ctx.user?.employeeId) return;
  await withAudit(ctx.db, ctx.actor, entity, async () => ({ action, entityId, result: null }));
}
