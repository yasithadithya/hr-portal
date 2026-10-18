import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import {
  findTenantById,
  getOrCreateVapidKeys,
  getTenantConnection,
  listTenants,
  primaryDomain,
  type ControlDb,
  type TenantConnection,
} from '@hr/control-db';
import { refreshJobProjections, schema, type TenantDb } from '@hr/db';
import { CURRENT_STATUSES } from '@hr/shared';
import { addDays, today as todayIn } from '@hr/shared/time';

import { renderEmail, type EmailSender } from '../lib/email';
import { generateVapidKeys, type PushSender } from '../lib/push';
import type { Storage } from '../lib/storage';
import { processRange } from '../modules/attendance/process';
import { getSettings } from '../modules/company/routes';
import { notify, usersWithPermission } from '../modules/notifications/notify';
import { anonymizeEmployee, retentionCandidates } from '../modules/privacy/service';
import type { PoolManager } from '../tenancy/pools';

import type { JobData, JobHandlers, JobQueue } from './queue';

const {
  appUsers,
  companyProfile,
  employeeDocuments,
  employees,
  notificationPreferences,
  notifications,
  pushSubscriptions,
} = schema;

export interface WorkerDeps {
  control: ControlDb;
  pools: PoolManager;
  masterKey: Buffer;
  email: EmailSender;
  push: PushSender;
  jobs: JobQueue;
  logger: Logger;
  /** Overrides https://<primary domain> in email links (local dev: http://localhost:3000). */
  appBaseUrl?: string | undefined;
  /** VAPID subject, e.g. mailto:support@… */
  pushSubject: string;
  /** File storage for a tenant (retention removes documents and photos). */
  storage?: (conn: TenantConnection) => Storage;
}

/** A tenant's database for a job (payload carries tenantId; no request, no host). */
async function tenantRuntime(deps: WorkerDeps, tenantId: string) {
  const tenant = await findTenantById(deps.control, tenantId);
  if (!tenant || tenant.status !== 'active') return null;
  const conn = await getTenantConnection(deps.control, tenant, deps.masterKey);
  return { tenant, conn, db: deps.pools.get(tenant.id, conn.dbUrl) as TenantDb };
}

function need(data: JobData): string {
  if (!data.tenantId) throw new Error('Job payload is missing tenantId');
  return data.tenantId;
}

export function createJobHandlers(deps: WorkerDeps): JobHandlers {
  const log = deps.logger;

  async function deliver(data: JobData) {
    const tenantId = need(data);
    const rt = await tenantRuntime(deps, tenantId);
    if (!rt) return;
    const ids = (data.notificationIds as string[] | undefined) ?? [];
    if (!ids.length) return;
    const rows = await rt.db
      .select({ n: notifications, email: appUsers.email, status: appUsers.status })
      .from(notifications)
      .innerJoin(appUsers, eq(appUsers.id, notifications.userId))
      .where(inArray(notifications.id, ids));
    if (!rows.length) return;
    const userIds = [...new Set(rows.map((r) => r.n.userId))];
    const prefs = await rt.db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, userIds));
    const pref = (userId: string, event: string) =>
      prefs.find((p) => p.userId === userId && p.event === event);
    const subs = await rt.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));

    const [company] = await rt.db.select().from(companyProfile).limit(1);
    const settings = await getSettings(rt.db);
    const domain = deps.appBaseUrl ? null : await primaryDomain(deps.control, tenantId);
    const base = deps.appBaseUrl ?? (domain ? `https://${domain}` : null);
    const url = (link: string | null) =>
      link && base ? `${base.replace(/\/$/, '')}${link}` : null;
    let vapid: Awaited<ReturnType<typeof getOrCreateVapidKeys>> | null = null;

    for (const { n, email, status } of rows) {
      if (status !== 'active') continue;
      const p = pref(n.userId, n.event);
      if (p?.email !== false && !n.emailedAt) {
        try {
          const { html, text } = renderEmail({
            company: company?.name ?? rt.tenant.name,
            color: settings['branding.primary_color'],
            title: n.title,
            body: n.body,
            url: url(n.link),
          });
          await deps.email.send({ to: email, subject: n.title, html, text });
          await rt.db
            .update(notifications)
            .set({ emailedAt: new Date() })
            .where(eq(notifications.id, n.id));
        } catch (err) {
          log.error({ err, tenantId, notificationId: n.id }, 'notification email failed');
        }
      }
      const mine = subs.filter((s) => s.userId === n.userId);
      if (p?.push !== false && mine.length && !n.pushedAt) {
        vapid ??= await getOrCreateVapidKeys(
          deps.control,
          tenantId,
          deps.masterKey,
          generateVapidKeys,
        );
        let any = false;
        for (const s of mine) {
          try {
            const r = await deps.push.send(
              s,
              { title: n.title, body: n.body, url: n.link, tag: n.id },
              vapid,
              deps.pushSubject,
            );
            if (r === 'gone') {
              await rt.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            } else {
              any = true;
              await rt.db
                .update(pushSubscriptions)
                .set({ lastUsedAt: new Date() })
                .where(eq(pushSubscriptions.id, s.id));
            }
          } catch (err) {
            log.error({ err, tenantId, notificationId: n.id }, 'web push failed');
          }
        }
        if (any)
          await rt.db
            .update(notifications)
            .set({ pushedAt: new Date() })
            .where(eq(notifications.id, n.id));
      }
    }
  }

  /** Nightly per tenant: future job changes, attendance processing, HR reminders. */
  async function dailyTenant(data: JobData) {
    const tenantId = need(data);
    const rt = await tenantRuntime(deps, tenantId);
    if (!rt) return;
    const tz = rt.tenant.timezone;
    const today = todayIn(tz);
    await refreshJobProjections(rt.db, today);
    // Yesterday is complete now: compute every employee's day (absences have no event).
    await processRange(rt.db, { tz, from: addDays(today, -1), to: addDays(today, -1), today });

    const settings = await getSettings(rt.db);
    const t = { db: rt.db, tenantId, jobs: deps.jobs };
    const docWindow = addDays(today, settings['documents.expiry_warning_days']);
    const docs = await rt.db
      .select({ d: employeeDocuments, e: employees })
      .from(employeeDocuments)
      .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
      .where(
        and(
          gte(employeeDocuments.expiryDate, today),
          lte(employeeDocuments.expiryDate, docWindow),
          isNull(employees.archivedAt),
        ),
      );
    const docHr = docs.length ? await usersWithPermission(rt.db, 'documents.manage') : [];
    for (const { d, e } of docs) {
      await notify(t, {
        userIds: docHr,
        event: 'reminder.document_expiring',
        title: `${d.title} expires on ${d.expiryDate}`,
        body: `${e.firstName} ${e.lastName} (${e.employeeNo})'s document expires soon.`,
        link: `/employees/${e.id}`,
        dedupeKey: `doc-expiry:${d.id}:${d.expiryDate}`,
      });
    }

    const window = addDays(today, settings['notifications.reminder_days']);
    const staff = await rt.db
      .select()
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.status, CURRENT_STATUSES),
          sql`(${employees.probationEndDate} between ${today} and ${window} and ${employees.status} = 'on_probation')
              or ${employees.contractEndDate} between ${today} and ${window}`,
        ),
      );
    const hr = staff.length ? await usersWithPermission(rt.db, 'employees.update') : [];
    for (const e of staff) {
      const name = `${e.firstName} ${e.lastName} (${e.employeeNo})`;
      if (e.status === 'on_probation' && e.probationEndDate && e.probationEndDate <= window)
        await notify(t, {
          userIds: hr,
          event: 'reminder.probation_ending',
          title: `Probation ends on ${e.probationEndDate}`,
          body: `${name}: confirm, extend or end employment.`,
          link: `/employees/${e.id}`,
          dedupeKey: `probation:${e.id}:${e.probationEndDate}`,
        });
      if (e.contractEndDate && e.contractEndDate >= today && e.contractEndDate <= window)
        await notify(t, {
          userIds: hr,
          event: 'reminder.contract_ending',
          title: `Contract ends on ${e.contractEndDate}`,
          body: `${name}: renew the contract or plan the exit.`,
          link: `/employees/${e.id}`,
          dedupeKey: `contract:${e.id}:${e.contractEndDate}`,
        });
    }
    // PDPA retention: only when the tenant has set a period.
    const years = settings['privacy.retention_years_after_exit'];
    let anonymized = 0;
    if (years) {
      const due = await retentionCandidates(rt.db, today, years);
      const storage = deps.storage?.(rt.conn) ?? null;
      for (const d of due) {
        await anonymizeEmployee(rt.db, { userId: null, userAgent: 'daily-job' }, d.id, storage);
        anonymized++;
      }
    }
    log.info(
      { tenantId, today, reminders: docs.length + staff.length, anonymized },
      'daily tenant job done',
    );
  }

  async function dailySweep() {
    const tenants = await listTenants(deps.control, { status: 'active' });
    for (const t of tenants)
      await deps.jobs.send(
        'daily.tenant',
        { tenantId: t.id },
        {
          singletonKey: `${t.id}:${todayIn(t.timezone)}`,
        },
      );
  }

  return {
    'notifications.deliver': deliver,
    'daily.tenant': dailyTenant,
    'daily.sweep': dailySweep,
  };
}
