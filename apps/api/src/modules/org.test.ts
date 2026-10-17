import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  companyProfileDtoSchema,
  departmentSchema,
  holidayImportResultSchema,
  publicTenantSchema,
  workCalendarSchema,
} from '@hr/shared';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
let hr: string;
let emp: string;
const A = 'a.localhost';

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  patch: (p: string, b?: object) =>
    request(h.app).patch(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  del: (p: string) =>
    request(h.app).delete(p).set('host', A).set('authorization', `Bearer ${token}`),
});

beforeAll(async () => {
  h = await createHarness('org', ['a']);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  emp = (await h.createUser('a', { email: 'e@a.lk', roles: ['employee'] })).token;
});

afterAll(async () => {
  await h?.close();
});

describe('company profile & branding', () => {
  it('is seeded from the tenant name and readable by everyone', async () => {
    const res = await as(emp).get('/api/v1/company');
    expect(companyProfileDtoSchema.parse(res.body.data)).toMatchObject({
      name: 'Tenant A',
      timezone: 'Asia/Colombo',
      currency: 'LKR',
      fiscalYearStartMonth: 4,
    });
  });

  it('only settings.manage can edit; bad timezone is rejected; edits are audited', async () => {
    const body = {
      name: 'Acme Lanka',
      legalName: 'Acme Lanka (Pvt) Ltd',
      regNo: 'PV 12345',
      epfRegNo: 'A/12345',
      etfRegNo: null,
      tin: null,
      address: { line1: '1 Galle Road', city: 'Colombo 03' },
      phone: '',
      email: '',
      timezone: 'Asia/Colombo',
      currency: 'LKR',
      fiscalYearStartMonth: 4,
    };
    expect((await as(emp).put('/api/v1/company', body)).status).toBe(403);
    expect(
      (await as(hr).put('/api/v1/company', { ...body, timezone: 'Mars/Olympus' })).status,
    ).toBe(400);
    const res = await as(hr).put('/api/v1/company', body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Acme Lanka', email: null, phone: null });
    const audit = await as(hr).get('/api/v1/audit-log?entity=company_profile');
    expect(audit.body.data.items[0].action).toBe('update');
  });

  it('uploads a logo and exposes it (and the brand colour) on the public tenant endpoint', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const up = await as(hr).put('/api/v1/company/logo').set('content-type', 'image/png').send(png);
    expect(up.status).toBe(200);
    expect(up.body.data.logoUrl).toMatch(/^https:\/\/storage\.test\/branding\/logo-.+\.png/);

    expect(
      (await as(hr).put('/api/v1/settings/branding.primary_color', { value: '#1d4ed8' })).status,
    ).toBe(200);
    const pub = publicTenantSchema.parse(
      (await request(h.app).get('/api/v1/public/tenant').set('host', A)).body.data,
    );
    expect(pub.name).toBe('Acme Lanka');
    expect(pub.logoUrl).toContain('branding/logo-');
    expect(pub.theme.primaryColor).toBe('#1d4ed8');
  });

  it('rejects non-image logos', async () => {
    const res = await as(hr)
      .put('/api/v1/company/logo')
      .set('content-type', 'text/plain')
      .send('nope');
    expect(res.status).toBe(400);
  });
});

describe('settings registry', () => {
  it('returns defaults and validates per key', async () => {
    const s = await as(emp).get('/api/v1/settings');
    expect(s.body.data['security.mfa_required']).toBe(false);
    expect((await as(hr).put('/api/v1/settings/not.a.key', { value: 1 })).status).toBe(400);
    expect(
      (await as(hr).put('/api/v1/settings/documents.expiry_warning_days', { value: 0 })).status,
    ).toBe(400);
    expect(
      (await as(hr).put('/api/v1/settings/documents.expiry_warning_days', { value: 45 })).body.data[
        'documents.expiry_warning_days'
      ],
    ).toBe(45);
    expect(
      (await as(emp).put('/api/v1/settings/security.mfa_required', { value: true })).status,
    ).toBe(403);
  });
});

describe('work calendars & holidays', () => {
  let calId: string;

  it('seeds one default Mon–Fri calendar', async () => {
    const cals = (await as(emp).get('/api/v1/work-calendars')).body.data.map((c: unknown) =>
      workCalendarSchema.parse(c),
    );
    expect(cals).toHaveLength(1);
    expect(cals[0]).toMatchObject({
      isDefault: true,
      workWeek: { sat: 'off', sun: 'off', mon: 'full' },
    });
    calId = cals[0].id;
  });

  it('a new default replaces the old one; the default cannot be un-defaulted or deleted', async () => {
    const created = await as(hr).post('/api/v1/work-calendars', {
      name: 'Factory (half Sat)',
      isDefault: true,
      workWeek: {
        mon: 'full',
        tue: 'full',
        wed: 'full',
        thu: 'full',
        fri: 'full',
        sat: 'half',
        sun: 'off',
      },
    });
    expect(created.status).toBe(201);
    const cals = created.body.data as { id: string; name: string; isDefault: boolean }[];
    expect(cals.filter((c) => c.isDefault).map((c) => c.name)).toEqual(['Factory (half Sat)']);
    const factory = cals.find((c) => c.isDefault)!;
    expect((await as(hr).del(`/api/v1/work-calendars/${factory.id}`)).status).toBe(400);
    expect(
      (
        await as(hr).put(`/api/v1/work-calendars/${factory.id}`, {
          name: 'Factory (half Sat)',
          isDefault: false,
          workWeek: {
            mon: 'full',
            tue: 'full',
            wed: 'full',
            thu: 'full',
            fri: 'full',
            sat: 'half',
            sun: 'off',
          },
        })
      ).status,
    ).toBe(400);
  });

  it('adds holidays and refuses duplicates', async () => {
    const add = (body: object) => as(hr).post(`/api/v1/work-calendars/${calId}/holidays`, body);
    expect((await add({ date: '2026-10-15', name: 'Test Holiday', type: 'public' })).status).toBe(
      201,
    );
    expect((await add({ date: '2026-10-15', name: 'Test Holiday', type: 'public' })).status).toBe(
      409,
    );
    expect((await add({ date: '2026-02-30', name: 'Bad', type: 'public' })).status).toBe(400);
  });

  it('counts working days with the calendar and its holidays', async () => {
    const res = await as(emp).get(
      `/api/v1/work-calendars/${calId}/working-days?start=2026-10-01&end=2026-10-31`,
    );
    expect(res.body.data.workingDays).toBe(21); // 22 Mon–Fri minus the 15th
  });

  it('CSV import previews row errors, refuses to commit with errors, then commits the valid file', async () => {
    const bad =
      'date,name,type\n2026-01-15,Thai Pongal,public\n2026-13-01,Nonsense,public\n2026-01-15,Thai Pongal,public\n';
    const preview = holidayImportResultSchema.parse(
      (
        await as(hr).post(`/api/v1/work-calendars/${calId}/holidays/import`, {
          csv: bad,
          dryRun: true,
        })
      ).body.data,
    );
    expect(preview.valid).toHaveLength(1);
    expect(preview.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(
      (
        await as(hr).post(`/api/v1/work-calendars/${calId}/holidays/import`, {
          csv: bad,
          dryRun: false,
        })
      ).status,
    ).toBe(400);

    const good = 'Date,Name,Type\n2026-01-15,Thai Pongal,public\n2024-02-29,Leap Test,company\n';
    const done = await as(hr).post(`/api/v1/work-calendars/${calId}/holidays/import`, {
      csv: good,
      dryRun: false,
    });
    expect(done.body.data.imported).toBe(2);
    const list = (await as(emp).get(`/api/v1/work-calendars/${calId}/holidays?year=2026`)).body
      .data;
    expect(list.find((x: { name: string }) => x.name === 'Thai Pongal').isVerified).toBe(false);
  });

  it('copies a year as unverified, skipping 29 Feb in non-leap years', async () => {
    const res = await as(hr).post(`/api/v1/work-calendars/${calId}/holidays/copy`, {
      fromYear: 2024,
      toYear: 2025,
    });
    expect(res.body.data.copied).toBe(0);
    const res2 = await as(hr).post(`/api/v1/work-calendars/${calId}/holidays/copy`, {
      fromYear: 2026,
      toYear: 2027,
    });
    expect(res2.body.data.copied).toBe(2);
    const y27 = (await as(emp).get(`/api/v1/work-calendars/${calId}/holidays?year=2027`)).body.data;
    expect(y27.every((x: { isVerified: boolean }) => !x.isVerified)).toBe(true);
  });
});

describe('organisation reference data', () => {
  it('creates, lists, conflicts on duplicate codes, and archives', async () => {
    const g = await as(hr).post('/api/v1/grades', { code: 'm1', name: 'Manager 1', rank: 10 });
    expect(g.status).toBe(201);
    expect(g.body.data.code).toBe('M1');
    expect((await as(hr).post('/api/v1/grades', { code: 'M1', name: 'Dup', rank: 1 })).status).toBe(
      409,
    );
    expect((await as(emp).post('/api/v1/grades', { code: 'X', name: 'X', rank: 1 })).status).toBe(
      403,
    );

    expect(
      (await as(hr).post('/api/v1/designations', { title: 'Engineer', gradeId: randomUUID() }))
        .status,
    ).toBe(400);
    const d = await as(hr).post('/api/v1/designations', {
      title: 'Engineer',
      gradeId: g.body.data.id,
    });
    expect(d.status).toBe(201);

    await as(hr).patch(`/api/v1/grades/${g.body.data.id}/archive`, { archived: true });
    expect((await as(emp).get('/api/v1/grades')).body.data).toEqual([]);
    expect((await as(emp).get('/api/v1/grades?includeArchived=true')).body.data).toHaveLength(1);
  });

  it('keeps departments a tree', async () => {
    const mk = async (code: string, parentId: string | null = null) =>
      departmentSchema.parse(
        (await as(hr).post('/api/v1/departments', { code, name: code, parentId })).body.data,
      );
    const ops = await mk('OPS');
    const fin = await mk('FIN', ops.id);
    const ap = await mk('AP', fin.id);

    const move = (id: string, parentId: string | null, code: string) =>
      as(hr).put(`/api/v1/departments/${id}`, { code, name: code, parentId });
    expect((await move(ops.id, ap.id, 'OPS')).status).toBe(400);
    expect((await move(ops.id, ops.id, 'OPS')).status).toBe(400);
    expect((await move(ap.id, ops.id, 'AP')).status).toBe(200);
  });

  it('validates branch geofence fields', async () => {
    expect(
      (await as(hr).post('/api/v1/branches', { code: 'HO', name: 'Head office', geoLat: 6.9 }))
        .status,
    ).toBe(400);
    const b = await as(hr).post('/api/v1/branches', {
      code: 'HO',
      name: 'Head office',
      geoLat: 6.9271,
      geoLng: 79.8612,
      geoRadiusM: 150,
      allowedIps: ['203.0.113.0/24'],
    });
    expect(b.status).toBe(201);
    expect(b.body.data).toMatchObject({ geoLat: 6.9271, geoLng: 79.8612, geoRadiusM: 150 });
  });
});

describe('numbering', () => {
  it('shows a preview and lets HR change the format', async () => {
    const list = await as(hr).get('/api/v1/number-sequences');
    expect(list.body.data).toEqual([
      { key: 'employee', prefix: 'EMP-', nextValue: 1, padding: 4, preview: 'EMP-0001' },
    ]);
    const upd = await as(hr).put('/api/v1/number-sequences/employee', {
      prefix: 'AC/',
      nextValue: 120,
      padding: 5,
    });
    expect(upd.body.data.preview).toBe('AC/00120');
    expect((await as(emp).get('/api/v1/number-sequences')).status).toBe(403);
  });
});
