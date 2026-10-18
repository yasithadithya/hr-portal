import { randomUUID } from 'node:crypto';

import { and, asc, count, eq, gte, lte, ne, sql } from 'drizzle-orm';
import express, { Router } from 'express';
import { z } from 'zod';

import { schema, withAudit, type TenantDb, type Tx } from '@hr/db';
import {
  addressSchema,
  companyProfileSchema,
  holidayCopySchema,
  holidayImportSchema,
  holidayInputSchema,
  numberSequenceUpdateSchema,
  ok,
  parseCsvRecords,
  SETTINGS,
  settingDefaults,
  settingKeySchema,
  formatSequence,
  workCalendarInputSchema,
  type CompanyProfile,
  type Holiday,
  type HolidayImportResult,
  type NumberSequence,
  type SettingKey,
  type WorkCalendar,
} from '@hr/shared';
import { businessDateSchema, countWorkingDays, type WorkWeek } from '@hr/shared/time';

import { authedCtx, type RequestContext } from '../../context';
import { AppError } from '../../lib/errors';
import { requireFileType } from '../../lib/sniff';
import { requirePermission } from '../../middleware/auth';
import { parsed, validate } from '../../middleware/validate';

const { companyProfile, workCalendars, holidays, branches, numberSequences, settings } = schema;

export const LOGO_BUCKET = 'branding';
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const LOGO_URL_TTL = 60 * 60;

const manage = requirePermission('settings.manage', 'all');
const idParams = { params: z.object({ id: z.uuid() }) };

export async function getSettings(db: TenantDb | Tx) {
  const rows = await db.select().from(settings);
  const values = settingDefaults() as Record<string, unknown>;
  for (const r of rows) if (r.key in SETTINGS) values[r.key] = r.value;
  return values as ReturnType<typeof settingDefaults>;
}

export async function logoUrl(ctx: RequestContext, path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    return await ctx.storage().signedUrl(LOGO_BUCKET, path, LOGO_URL_TTL);
  } catch {
    return null;
  }
}

async function profileDto(ctx: RequestContext): Promise<CompanyProfile> {
  const [p] = await ctx.db.select().from(companyProfile);
  if (!p) throw AppError.notFound('Company profile not set up');
  return {
    name: p.name,
    legalName: p.legalName,
    regNo: p.regNo,
    epfRegNo: p.epfRegNo,
    etfRegNo: p.etfRegNo,
    tin: p.tin,
    address: addressSchema.parse(p.address ?? {}),
    phone: p.phone,
    email: p.email,
    timezone: p.timezone,
    currency: p.currency,
    fiscalYearStartMonth: p.fiscalYearStartMonth,
    logoUrl: await logoUrl(ctx, p.logoPath),
  };
}

async function calendarDtos(db: TenantDb): Promise<WorkCalendar[]> {
  const rows = await db.select().from(workCalendars).orderBy(asc(workCalendars.name));
  const counts = await db
    .select({ calendarId: holidays.calendarId, n: count() })
    .from(holidays)
    .groupBy(holidays.calendarId);
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    workWeek: c.workWeek as WorkWeek,
    isDefault: c.isDefault,
    holidayCount: counts.find((x) => x.calendarId === c.id)?.n ?? 0,
  }));
}

function holidayDto(h: typeof holidays.$inferSelect): Holiday {
  return {
    id: h.id,
    calendarId: h.calendarId,
    date: h.date,
    name: h.name,
    type: h.type,
    isVerified: h.isVerified,
  };
}

async function calendarOr404(db: TenantDb, id: string) {
  const [c] = await db.select().from(workCalendars).where(eq(workCalendars.id, id));
  if (!c) throw AppError.notFound('Work calendar not found');
  return c;
}

export function companyRoutes(): Router {
  const router = Router();

  // ── Company profile ────────────────────────────────────────────────────────
  router.get('/company', async (req, res) => {
    res.json(ok(await profileDto(authedCtx(req))));
  });

  const profileSchemas = { body: companyProfileSchema };
  router.put('/company', manage, validate(profileSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, profileSchemas);
    await withAudit(ctx.db, ctx.actor, 'company_profile', async (tx) => {
      const [before] = await tx.select().from(companyProfile);
      const [after] = await tx
        .update(companyProfile)
        .set({ ...body, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(companyProfile.singleton, true))
        .returning();
      return { action: 'update', entityId: after?.id ?? null, before, after, result: null };
    });
    res.json(ok(await profileDto(ctx)));
  });

  router.put(
    '/company/logo',
    manage,
    express.raw({ type: Object.keys(LOGO_TYPES), limit: '1mb' }),
    async (req, res) => {
      const ctx = authedCtx(req);
      const type = req.get('content-type')?.split(';')[0]?.trim() ?? '';
      const ext = LOGO_TYPES[type];
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw AppError.badRequest('Upload a PNG, JPEG, WebP or SVG image up to 1 MB');
      }
      requireFileType(type, req.body, AppError.badRequest);
      const path = `logo-${randomUUID()}.${ext}`;
      await ctx.storage().upload(LOGO_BUCKET, path, req.body, type);
      const [before] = await ctx.db.select().from(companyProfile);
      await withAudit(ctx.db, ctx.actor, 'company_profile', async (tx) => {
        await tx
          .update(companyProfile)
          .set({ logoPath: path, updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(eq(companyProfile.singleton, true));
        return {
          action: 'update_logo',
          entityId: before?.id ?? null,
          before: { logoPath: before?.logoPath },
          after: { logoPath: path },
          result: null,
        };
      });
      if (before?.logoPath)
        await ctx
          .storage()
          .remove(LOGO_BUCKET, before.logoPath)
          .catch(() => {});
      res.json(ok(await profileDto(ctx)));
    },
  );

  // ── Settings (typed registry) ───────────────────────────────────────────────
  router.get('/settings', async (req, res) => {
    res.json(ok(await getSettings(authedCtx(req).db)));
  });

  const settingSchemas = {
    params: z.object({ key: settingKeySchema }),
    body: z.object({ value: z.unknown() }),
  };
  router.put('/settings/:key', manage, validate(settingSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, settingSchemas);
    const key = params.key as SettingKey;
    const value = SETTINGS[key].schema.parse(body.value);
    await withAudit(ctx.db, ctx.actor, 'settings', async (tx) => {
      const [before] = await tx.select().from(settings).where(eq(settings.key, key));
      const [row] = await tx
        .insert(settings)
        .values({ key, value, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedBy: ctx.user.id, updatedAt: new Date() },
        })
        .returning();
      return {
        action: 'update',
        entityId: key,
        before: before?.value ?? null,
        after: value,
        result: row,
      };
    });
    res.json(ok(await getSettings(ctx.db)));
  });

  // ── Work calendars ────────────────────────────────────────────────────────
  router.get('/work-calendars', async (req, res) => {
    res.json(ok(await calendarDtos(authedCtx(req).db)));
  });

  const calSchemas = { body: workCalendarInputSchema };
  router.post('/work-calendars', manage, validate(calSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, calSchemas);
    await withAudit(ctx.db, ctx.actor, 'work_calendars', async (tx) => {
      if (body.isDefault) await tx.update(workCalendars).set({ isDefault: false });
      const [c] = await tx
        .insert(workCalendars)
        .values({ ...body, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: c!.id, after: c, result: c };
    });
    res.status(201).json(ok(await calendarDtos(ctx.db)));
  });

  const calUpdate = { ...idParams, body: workCalendarInputSchema };
  router.put('/work-calendars/:id', manage, validate(calUpdate), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, calUpdate);
    const before = await calendarOr404(ctx.db, params.id);
    if (before.isDefault && !body.isDefault) {
      throw AppError.badRequest('Make another calendar the default instead');
    }
    await withAudit(ctx.db, ctx.actor, 'work_calendars', async (tx) => {
      if (body.isDefault) {
        await tx
          .update(workCalendars)
          .set({ isDefault: false })
          .where(ne(workCalendars.id, params.id));
      }
      const [c] = await tx
        .update(workCalendars)
        .set({ ...body, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(workCalendars.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: c, result: c };
    });
    res.json(ok(await calendarDtos(ctx.db)));
  });

  router.delete('/work-calendars/:id', manage, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const before = await calendarOr404(ctx.db, params.id);
    if (before.isDefault) throw AppError.badRequest('The default calendar cannot be deleted');
    const [used] = await ctx.db
      .select({ n: count() })
      .from(branches)
      .where(eq(branches.calendarId, params.id));
    if ((used?.n ?? 0) > 0) throw new AppError(409, 'CONFLICT', 'Branches still use this calendar');
    await withAudit(ctx.db, ctx.actor, 'work_calendars', async (tx) => {
      await tx.delete(workCalendars).where(eq(workCalendars.id, params.id));
      return { action: 'delete', entityId: params.id, before, result: null };
    });
    res.json(ok(await calendarDtos(ctx.db)));
  });

  const workingDaysSchemas = {
    ...idParams,
    query: z.object({ start: businessDateSchema, end: businessDateSchema }),
  };
  router.get('/work-calendars/:id/working-days', validate(workingDaysSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, query } = parsed(req, workingDaysSchemas);
    if (query.end < query.start) throw AppError.badRequest('End is before start');
    const cal = await calendarOr404(ctx.db, params.id);
    const hols = await ctx.db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          eq(holidays.calendarId, params.id),
          gte(holidays.date, query.start),
          lte(holidays.date, query.end),
        ),
      );
    const days = countWorkingDays(
      query.start,
      query.end,
      cal.workWeek as WorkWeek,
      new Set(hols.map((h) => h.date)),
    );
    res.json(ok({ start: query.start, end: query.end, workingDays: days }));
  });

  // ── Holidays ──────────────────────────────────────────────────────────────
  const listHolidays = {
    ...idParams,
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
  };
  router.get('/work-calendars/:id/holidays', validate(listHolidays), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, query } = parsed(req, listHolidays);
    await calendarOr404(ctx.db, params.id);
    const rows = await ctx.db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.calendarId, params.id),
          query.year ? sql`extract(year from ${holidays.date}) = ${query.year}` : undefined,
        ),
      )
      .orderBy(asc(holidays.date));
    res.json(ok(rows.map(holidayDto)));
  });

  const addHoliday = { ...idParams, body: holidayInputSchema };
  router.post('/work-calendars/:id/holidays', manage, validate(addHoliday), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, addHoliday);
    await calendarOr404(ctx.db, params.id);
    const row = await withAudit(ctx.db, ctx.actor, 'holidays', async (tx) => {
      const [h] = await tx
        .insert(holidays)
        .values({ ...body, calendarId: params.id, createdBy: ctx.user.id, updatedBy: ctx.user.id })
        .returning();
      return { action: 'create', entityId: h!.id, after: h, result: h! };
    });
    res.status(201).json(ok(holidayDto(row)));
  });

  const updHoliday = { ...idParams, body: holidayInputSchema };
  router.put('/holidays/:id', manage, validate(updHoliday), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, updHoliday);
    const row = await withAudit(ctx.db, ctx.actor, 'holidays', async (tx) => {
      const [before] = await tx.select().from(holidays).where(eq(holidays.id, params.id));
      if (!before) throw AppError.notFound('Holiday not found');
      const [h] = await tx
        .update(holidays)
        .set({ ...body, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(holidays.id, params.id))
        .returning();
      return { action: 'update', entityId: params.id, before, after: h, result: h! };
    });
    res.json(ok(holidayDto(row)));
  });

  router.delete('/holidays/:id', manage, validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    await withAudit(ctx.db, ctx.actor, 'holidays', async (tx) => {
      const [before] = await tx.delete(holidays).where(eq(holidays.id, params.id)).returning();
      if (!before) throw AppError.notFound('Holiday not found');
      return { action: 'delete', entityId: params.id, before, result: null };
    });
    res.json(ok({ id: params.id }));
  });

  /** CSV import (date,name,type). dryRun=true returns a preview with row errors; false commits atomically. */
  const importSchemas = { ...idParams, body: holidayImportSchema };
  router.post(
    '/work-calendars/:id/holidays/import',
    manage,
    validate(importSchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, importSchemas);
      await calendarOr404(ctx.db, params.id);
      const records = parseCsvRecords(body.csv);
      const result: HolidayImportResult = { valid: [], errors: [], imported: 0 };
      const seen = new Set<string>();
      if (records.length === 0)
        result.errors.push({ line: 1, message: 'No rows found (need a header: date,name,type)' });
      for (const { line, record } of records) {
        const parsedRow = holidayInputSchema.safeParse({
          date: record.date,
          name: record.name,
          type: record.type || 'public',
        });
        if (!parsedRow.success) {
          result.errors.push({
            line,
            message: parsedRow.error.issues
              .map((i) => `${i.path.join('.') || 'row'}: ${i.message}`)
              .join('; '),
          });
          continue;
        }
        const key = `${parsedRow.data.date}|${parsedRow.data.name.toLowerCase()}`;
        if (seen.has(key)) {
          result.errors.push({ line, message: 'Duplicate of an earlier row' });
          continue;
        }
        seen.add(key);
        result.valid.push({
          date: parsedRow.data.date,
          name: parsedRow.data.name,
          type: parsedRow.data.type,
        });
      }
      if (!body.dryRun) {
        if (result.errors.length > 0) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Fix the errors before importing',
            result.errors,
          );
        }
        result.imported = await withAudit(ctx.db, ctx.actor, 'holidays', async (tx) => {
          const inserted = result.valid.length
            ? await tx
                .insert(holidays)
                .values(
                  result.valid.map((h) => ({
                    ...h,
                    calendarId: params.id,
                    isVerified: false,
                    createdBy: ctx.user.id,
                    updatedBy: ctx.user.id,
                  })),
                )
                .onConflictDoNothing()
                .returning({ id: holidays.id })
            : [];
          return {
            action: 'import',
            entityId: params.id,
            after: { rows: inserted.length },
            result: inserted.length,
          };
        });
      }
      res.json(ok(result));
    },
  );

  /** Copies a year's holidays to another year (same month/day), unverified: lunar dates move, so HR must check. */
  const copySchemas = { ...idParams, body: holidayCopySchema };
  router.post(
    '/work-calendars/:id/holidays/copy',
    manage,
    validate(copySchemas),
    async (req, res) => {
      const ctx = authedCtx(req);
      const { params, body } = parsed(req, copySchemas);
      await calendarOr404(ctx.db, params.id);
      const source = await ctx.db
        .select()
        .from(holidays)
        .where(
          and(
            eq(holidays.calendarId, params.id),
            sql`extract(year from ${holidays.date}) = ${body.fromYear}`,
          ),
        );
      const values = source
        .map((h) => ({ ...h, date: `${body.toYear}${h.date.slice(4)}` }))
        // 29 Feb only exists in leap years
        .filter((h) => businessDateSchema.safeParse(h.date).success)
        .map((h) => ({
          calendarId: params.id,
          date: h.date,
          name: h.name,
          type: h.type,
          isVerified: false,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        }));
      const copied = await withAudit(ctx.db, ctx.actor, 'holidays', async (tx) => {
        const rows = values.length
          ? await tx
              .insert(holidays)
              .values(values)
              .onConflictDoNothing()
              .returning({ id: holidays.id })
          : [];
        return {
          action: 'copy_year',
          entityId: params.id,
          after: { ...body, rows: rows.length },
          result: rows.length,
        };
      });
      res.json(ok({ copied }));
    },
  );

  // ── Numbering ─────────────────────────────────────────────────────────────
  function seqDto(s: typeof numberSequences.$inferSelect): NumberSequence {
    return {
      key: s.key,
      prefix: s.prefix,
      nextValue: s.nextValue,
      padding: s.padding,
      preview: formatSequence(s, s.nextValue),
    };
  }

  router.get('/number-sequences', manage, async (req, res) => {
    const rows = await authedCtx(req)
      .db.select()
      .from(numberSequences)
      .orderBy(asc(numberSequences.key));
    res.json(ok(rows.map(seqDto)));
  });

  const seqSchemas = {
    params: z.object({ key: z.string().max(40) }),
    body: numberSequenceUpdateSchema,
  };
  router.put('/number-sequences/:key', manage, validate(seqSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { params, body } = parsed(req, seqSchemas);
    const row = await withAudit(ctx.db, ctx.actor, 'number_sequences', async (tx) => {
      const [before] = await tx
        .select()
        .from(numberSequences)
        .where(eq(numberSequences.key, params.key));
      if (!before) throw AppError.notFound('Unknown sequence');
      const [s] = await tx
        .update(numberSequences)
        .set({ ...body, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(numberSequences.key, params.key))
        .returning();
      return { action: 'update', entityId: params.key, before, after: s, result: s! };
    });
    res.json(ok(seqDto(row)));
  });

  return router;
}
