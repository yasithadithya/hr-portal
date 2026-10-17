import { randomUUID } from 'node:crypto';

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import express, { Router, type Request } from 'express';
import { z } from 'zod';

import { jobAsOf, schema, scopeCondition, withAudit } from '@hr/db';
import {
  bankStatutorySchema,
  confirmSchema,
  contactInputSchema,
  csvCell,
  CURRENT_STATUSES,
  datesSchema,
  documentMetaSchema,
  employeeListQuerySchema,
  exitSchema,
  hireSchema,
  jobChangeSchema,
  noticeSchema,
  ok,
  personalSchema,
  type Contact,
  type EmployeeDocument,
  type OrgChartNode,
  type Scope,
} from '@hr/shared';
import { addDays, businessDateSchema } from '@hr/shared/time';

import { authedCtx, scopeOf, type AuthedUser, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';
import { getSettings } from '../company/routes';

import * as repo from './repo';
import * as service from './service';

const { employees, employeeContacts, employeeDocuments, designations, departments } = schema;

const idParams = { params: z.object({ id: z.uuid() }) };
const DOC_BUCKET = 'employee-documents';
const PHOTO_BUCKET = 'employee-photos';
const SIGNED_URL_TTL = 60;
/** UTF-8 byte-order mark so Excel opens Sinhala/Tamil names correctly. */
const BOM = String.fromCharCode(0xfeff);
const DOC_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const PHOTO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

type Ctx = RequestContext & { user: AuthedUser };

/** Loads an employee the caller may see under `key`'s scope, or 404 (no existence oracle). */
async function visibleEmployee(
  ctx: Ctx,
  req: Request,
  id: string,
  key: 'employees.read' | 'documents.read' | 'documents.manage',
) {
  const scope: Scope = scopeOf(req, key);
  const e = await repo.getEmployee(
    ctx.db,
    id,
    scopeCondition(scope, ctx.user.employeeId, employees.id),
  );
  if (!e || e.archivedAt) throw AppError.notFound('Employee not found');
  return { e, scope };
}

function accessFor(ctx: Ctx, scope: Scope, employeeId: string): 'full' | 'work' {
  return scope === 'all' || employeeId === ctx.user.employeeId ? 'full' : 'work';
}

function docDto(d: typeof employeeDocuments.$inferSelect): EmployeeDocument {
  return {
    id: d.id,
    category: d.category,
    title: d.title,
    mime: d.mime,
    size: d.size,
    expiryDate: d.expiryDate,
    uploadedAt: d.createdAt.toISOString(),
  };
}

export function employeeRoutes(): Router {
  const router = Router();
  const read = requirePermission('employees.read');
  const hr = requirePermission('employees.update', 'all');

  // ── List, export, org chart, upcoming ──────────────────────────────────────
  const listSchemas = { query: employeeListQuerySchema };
  router.get('/employees', read, validate(listSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listSchemas);
    const where = repo.listFilters(query, scopeOf(req, 'employees.read'), ctx.user.employeeId);
    const { items, total } = await repo.listEmployees(ctx.db, query, where);
    res.json(ok({ items, total, page: query.page, pageSize: query.pageSize }));
  });

  /** CSV of the filtered list (opens in Excel). Sensitive columns only for all-scope readers. */
  router.get('/employees/export.csv', read, validate(listSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listSchemas);
    const scope = scopeOf(req, 'employees.read');
    const where = repo.listFilters(query, scope, ctx.user.employeeId);
    const { items } = await repo.listEmployees(
      ctx.db,
      { ...query, page: 1, pageSize: 100_000 },
      where,
    );
    const full = scope === 'all';
    const extra = full
      ? await ctx.db
          .select()
          .from(employees)
          .where(
            inArray(
              employees.id,
              items.length ? items.map((i) => i.id) : ['00000000-0000-0000-0000-000000000000'],
            ),
          )
      : [];
    const byId = new Map(extra.map((e) => [e.id, e]));
    const header = [
      'Employee no',
      'Name',
      'Designation',
      'Department',
      'Branch',
      'Status',
      'Type',
      'Join date',
      'Work email',
    ];
    if (full) header.push('NIC', 'Mobile', 'EPF no');
    const lines = [header.map(csvCell).join(',')];
    for (const i of items) {
      const row: unknown[] = [
        i.employeeNo,
        i.name,
        i.designation,
        i.department,
        i.branch,
        i.status,
        i.employmentType,
        i.joinDate,
        i.workEmail,
      ];
      if (full) {
        const e = byId.get(i.id);
        row.push(e?.nic, e?.mobile, e?.epfNo);
      }
      lines.push(row.map(csvCell).join(','));
    }
    await withAudit(ctx.db, ctx.actor, 'employees', async () => ({
      action: 'export',
      entityId: null,
      after: { rows: items.length, sensitive: full, filters: query },
      result: null,
    }));
    res
      .type('text/csv; charset=utf-8')
      .attachment(`employees-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(`${BOM}${lines.join('\r\n')}\r\n`);
  });

  router.get('/org-chart', read, async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select({ e: employees, designation: designations.title, department: departments.name })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.status, CURRENT_STATUSES),
          scopeCondition(scopeOf(req, 'employees.read'), ctx.user.employeeId, employees.id),
        ),
      )
      .orderBy(asc(employees.firstName));
    const nodes: OrgChartNode[] = rows.map(({ e, designation, department }) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      name: `${e.firstName} ${e.lastName}`,
      designation,
      department,
      reportsToId: e.reportsToId,
    }));
    res.json(ok(nodes));
  });

  const upcomingSchemas = {
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  };
  router.get('/employees/upcoming', read, validate(upcomingSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, upcomingSchemas);
    const from = service.tenantToday(ctx);
    const to = addDays(from, query.days);
    const rows = await ctx.db
      .select()
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.status, CURRENT_STATUSES),
          scopeCondition(scopeOf(req, 'employees.read'), ctx.user.employeeId, employees.id),
        ),
      );
    const events = rows
      .flatMap((e) => [
        e.status === 'on_probation' && e.probationEndDate
          ? { e, kind: 'probation_end' as const, date: e.probationEndDate }
          : null,
        e.contractEndDate ? { e, kind: 'contract_end' as const, date: e.contractEndDate } : null,
        e.status === 'notice' && e.exitDate ? { e, kind: 'exit' as const, date: e.exitDate } : null,
      ])
      .filter((x): x is NonNullable<typeof x> => !!x && x.date >= from && x.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ e, kind, date }) => ({
        employeeId: e.id,
        employeeNo: e.employeeNo,
        name: `${e.firstName} ${e.lastName}`,
        kind,
        date,
      }));
    res.json(ok(events));
  });

  // ── Detail & history ───────────────────────────────────────────────────────
  router.get('/employees/:id', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { e, scope } = await visibleEmployee(
      ctx,
      req,
      parsed(req, idParams).params.id,
      'employees.read',
    );
    res.json(ok(await repo.toDetail(ctx.db, e, accessFor(ctx, scope, e.id))));
  });

  router.get('/employees/:id/job-history', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { e } = await visibleEmployee(
      ctx,
      req,
      parsed(req, idParams).params.id,
      'employees.read',
    );
    res.json(ok(await repo.jobHistory(ctx.db, e.id)));
  });

  const asOfSchemas = { ...idParams, query: z.object({ date: businessDateSchema }) };
  router.get('/employees/:id/job', read, validate(asOfSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, query } = parsed(req, asOfSchemas);
    const { e } = await visibleEmployee(ctx, req, params.id, 'employees.read');
    const row = await jobAsOf(ctx.db, e.id, query.date);
    if (!row) throw AppError.notFound('No job record on that date');
    res.json(ok((await repo.jobHistory(ctx.db, e.id)).find((h) => h.id === row.id) ?? null));
  });

  // ── HR actions ─────────────────────────────────────────────────────────────
  const hireSchemas = { body: hireSchema };
  router.post(
    '/employees',
    requirePermission('employees.create', 'all'),
    validate(hireSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const created = await service.hire(ctx, parsed(req, hireSchemas).body);
      res.status(201).json(ok(await repo.toDetail(ctx.db, created, 'full')));
    },
  );

  function action<S extends z.ZodType>(
    path: string,
    body: S,
    fn: (ctx: Ctx, id: string, input: z.output<S>) => Promise<unknown>,
  ) {
    const schemas = { ...idParams, body };
    router.post(`/employees/:id/${path}`, hr, validate(schemas), async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body: input } = parsed(req, schemas);
      await fn(ctx, params.id, input as z.output<S>);
      const e = await repo.getEmployee(ctx.db, params.id);
      res.json(ok(await repo.toDetail(ctx.db, e!, 'full')));
    });
  }
  action('job-change', jobChangeSchema, service.changeJob);
  action('confirm', confirmSchema, service.confirm);
  action('notice', noticeSchema, service.setNotice);
  action('exit', exitSchema, service.exitEmployee);

  const putSchemas = <S extends z.ZodType>(body: S) => ({ ...idParams, body });
  const personal = putSchemas(personalSchema);
  router.put('/employees/:id/personal', hr, validate(personal), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, personal);
    const e = await service.updatePersonal(ctx, params.id, body);
    res.json(ok(await repo.toDetail(ctx.db, e, 'full')));
  });
  const bank = putSchemas(bankStatutorySchema);
  router.put('/employees/:id/bank', hr, validate(bank), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, bank);
    const e = await service.updateBank(ctx, params.id, body);
    res.json(ok(await repo.toDetail(ctx.db, e, 'full')));
  });
  const dates = putSchemas(datesSchema);
  router.put('/employees/:id/dates', hr, validate(dates), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, dates);
    const e = await service.updateDates(ctx, params.id, body);
    res.json(ok(await repo.toDetail(ctx.db, e, 'full')));
  });

  router.post(
    '/employees/:id/archive',
    requirePermission('employees.archive', 'all'),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      const before = await repo.getEmployee(ctx.db, params.id);
      if (!before) throw AppError.notFound('Employee not found');
      await withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
        await tx
          .update(employees)
          .set({ archivedAt: new Date(), updatedBy: ctx.user.id })
          .where(eq(employees.id, params.id));
        return { action: 'archive', entityId: params.id, before, result: null };
      });
      res.json(ok({ id: params.id }));
    },
  );

  // ── Contacts (personal data: full access only) ─────────────────────────────
  router.get('/employees/:id/contacts', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { e, scope } = await visibleEmployee(
      ctx,
      req,
      parsed(req, idParams).params.id,
      'employees.read',
    );
    if (accessFor(ctx, scope, e.id) !== 'full') throw AppError.forbidden('Contacts are private');
    const rows = await ctx.db
      .select()
      .from(employeeContacts)
      .where(eq(employeeContacts.employeeId, e.id))
      .orderBy(asc(employeeContacts.type), asc(employeeContacts.name));
    res.json(
      ok(
        rows.map((c): Contact => ({
          id: c.id,
          type: c.type,
          name: c.name,
          relationship: c.relationship,
          phone: c.phone,
          dob: c.dob,
        })),
      ),
    );
  });

  const addContact = { ...idParams, body: contactInputSchema };
  router.post('/employees/:id/contacts', hr, validate(addContact), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, addContact);
    const row = await withAudit(ctx.db, ctx.actor, 'employee_contacts', async (tx) => {
      const [c] = await tx
        .insert(employeeContacts)
        .values({ ...body, employeeId: params.id, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: c!.id, after: c, result: c! };
    });
    res.status(201).json(ok({ id: row.id }));
  });

  const contactIds = { params: z.object({ id: z.uuid(), contactId: z.uuid() }) };
  router.delete(
    '/employees/:id/contacts/:contactId',
    hr,
    validate(contactIds),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, contactIds);
      await withAudit(ctx.db, ctx.actor, 'employee_contacts', async (tx) => {
        const [before] = await tx
          .delete(employeeContacts)
          .where(
            and(
              eq(employeeContacts.id, params.contactId),
              eq(employeeContacts.employeeId, params.id),
            ),
          )
          .returning();
        if (!before) throw AppError.notFound('Contact not found');
        return { action: 'delete', entityId: params.contactId, before, result: null };
      });
      res.json(ok({ id: params.contactId }));
    },
  );

  // ── Documents ──────────────────────────────────────────────────────────────
  router.get(
    '/employees/:id/documents',
    requirePermission('documents.read'),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { e } = await visibleEmployee(
        ctx,
        req,
        parsed(req, idParams).params.id,
        'documents.read',
      );
      const rows = await ctx.db
        .select()
        .from(employeeDocuments)
        .where(eq(employeeDocuments.employeeId, e.id))
        .orderBy(asc(employeeDocuments.title));
      res.json(ok(rows.map(docDto)));
    },
  );

  const uploadSchemas = { ...idParams, query: documentMetaSchema };
  router.post(
    '/employees/:id/documents',
    requirePermission('documents.manage'),
    express.raw({ type: Object.keys(DOC_TYPES), limit: '10mb' }),
    validate(uploadSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, query } = parsed(req, uploadSchemas);
      const { e } = await visibleEmployee(ctx, req, params.id, 'documents.manage');
      const type = req.get('content-type')?.split(';')[0]?.trim() ?? '';
      const ext = DOC_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw AppError.badRequest('Upload a PDF, image or Word document up to 10 MB');
      }
      const path = `${e.id}/${randomUUID()}.${ext}`;
      await ctx.storage().upload(DOC_BUCKET, path, req.body, type);
      const row = await withAudit(ctx.db, ctx.actor, 'employee_documents', async (tx) => {
        const [d] = await tx
          .insert(employeeDocuments)
          .values({
            employeeId: e.id,
            ...query,
            storagePath: path,
            mime: type,
            size: req.body.length,
            uploadedBy: ctx.user.id,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          })
          .returning();
        return { action: 'upload', entityId: d!.id, after: d, result: d! };
      });
      res.status(201).json(ok(docDto(row)));
    },
  );

  const docIds = { params: z.object({ id: z.uuid(), docId: z.uuid() }) };
  /** Short-lived signed URL (60 s); every download is audited. */
  router.get(
    '/employees/:id/documents/:docId/url',
    requirePermission('documents.read'),
    validate(docIds),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, docIds);
      const { e } = await visibleEmployee(ctx, req, params.id, 'documents.read');
      const [d] = await ctx.db
        .select()
        .from(employeeDocuments)
        .where(and(eq(employeeDocuments.id, params.docId), eq(employeeDocuments.employeeId, e.id)));
      if (!d) throw AppError.notFound('Document not found');
      const url = await ctx.storage().signedUrl(DOC_BUCKET, d.storagePath, SIGNED_URL_TTL);
      await withAudit(ctx.db, ctx.actor, 'employee_documents', async () => ({
        action: 'download',
        entityId: d.id,
        result: null,
      }));
      res.json(ok({ url, expiresIn: SIGNED_URL_TTL }));
    },
  );

  router.delete(
    '/employees/:id/documents/:docId',
    requirePermission('documents.manage'),
    validate(docIds),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, docIds);
      const { e } = await visibleEmployee(ctx, req, params.id, 'documents.manage');
      const before = await withAudit(ctx.db, ctx.actor, 'employee_documents', async (tx) => {
        const [d] = await tx
          .delete(employeeDocuments)
          .where(
            and(eq(employeeDocuments.id, params.docId), eq(employeeDocuments.employeeId, e.id)),
          )
          .returning();
        if (!d) throw AppError.notFound('Document not found');
        return { action: 'delete', entityId: d.id, before: d, result: d };
      });
      await ctx
        .storage()
        .remove(DOC_BUCKET, before.storagePath)
        .catch(() => {});
      res.json(ok({ id: params.docId }));
    },
  );

  const expiringSchemas = {
    query: z.object({ days: z.coerce.number().int().min(1).max(365).optional() }),
  };
  router.get(
    '/documents/expiring',
    requirePermission('documents.read', 'all'),
    validate(expiringSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { query } = parsed(req, expiringSchemas);
      const days = query.days ?? (await getSettings(ctx.db))['documents.expiry_warning_days'];
      const today = service.tenantToday(ctx);
      const rows = await ctx.db
        .select({ d: employeeDocuments, e: employees })
        .from(employeeDocuments)
        .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
        .where(
          and(
            isNotNull(employeeDocuments.expiryDate),
            lte(employeeDocuments.expiryDate, addDays(today, days)),
            gte(employeeDocuments.expiryDate, addDays(today, -365)),
            isNull(employees.archivedAt),
          ),
        )
        .orderBy(asc(employeeDocuments.expiryDate));
      res.json(
        ok(
          rows.map(({ d, e }) => ({
            ...docDto(d),
            employeeId: e.id,
            employeeNo: e.employeeNo,
            employeeName: `${e.firstName} ${e.lastName}`,
            daysLeft: Math.round(
              (Date.parse(`${d.expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
                86_400_000,
            ),
          })),
        ),
      );
    },
  );

  // ── Photo ──────────────────────────────────────────────────────────────────
  router.put(
    '/employees/:id/photo',
    hr,
    express.raw({ type: Object.keys(PHOTO_TYPES), limit: '2mb' }),
    validate(idParams),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params } = parsed(req, idParams);
      const e = await repo.getEmployee(ctx.db, params.id);
      if (!e) throw AppError.notFound('Employee not found');
      const type = req.get('content-type')?.split(';')[0]?.trim() ?? '';
      const ext = PHOTO_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0)
        throw AppError.badRequest('Upload a PNG, JPEG or WebP up to 2 MB');
      const path = `${e.id}/${randomUUID()}.${ext}`;
      await ctx.storage().upload(PHOTO_BUCKET, path, req.body, type);
      await withAudit(ctx.db, ctx.actor, 'employees', async (tx) => {
        await tx
          .update(employees)
          .set({ photoPath: path, updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(employees.id, e.id));
        return {
          action: 'update_photo',
          entityId: e.id,
          before: { photoPath: e.photoPath },
          after: { photoPath: path },
          result: null,
        };
      });
      if (e.photoPath)
        await ctx
          .storage()
          .remove(PHOTO_BUCKET, e.photoPath)
          .catch(() => {});
      res.json(ok({ id: e.id }));
    },
  );

  router.get('/employees/:id/photo', read, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { e } = await visibleEmployee(
      ctx,
      req,
      parsed(req, idParams).params.id,
      'employees.read',
    );
    if (!e.photoPath) throw AppError.notFound('No photo');
    res.json(ok({ url: await ctx.storage().signedUrl(PHOTO_BUCKET, e.photoPath, 300) }));
  });

  return router;
}
