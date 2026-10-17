import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  employeeDetailSchema,
  employeePageSchema,
  importPreviewSchema,
  importReportSchema,
  jobHistoryItemSchema,
} from '@hr/shared';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let hr: string;
let mgr: string;
let mgrEmpId: string;
let staff: string;
let staffEmpId: string;
let otherEmpId: string;
const dept: Record<string, string> = {};

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  del: (p: string) =>
    request(h.app).delete(p).set('host', A).set('authorization', `Bearer ${token}`),
});

const hireBody = (over: Record<string, unknown> = {}) => ({
  firstName: 'Kamal',
  lastName: 'Silva',
  joinDate: '2025-02-01',
  employmentType: 'permanent',
  ...over,
});

beforeAll(async () => {
  h = await createHarness('emp', ['a']);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  for (const code of ['SALES', 'OPS']) {
    const r = await as(hr).post('/api/v1/departments', { code, name: code });
    dept[code] = r.body.data.id;
  }
  // Manager + one report + one outsider, hired through the API.
  const m = await as(hr).post(
    '/api/v1/employees',
    hireBody({ firstName: 'Malini', departmentId: dept.SALES }),
  );
  mgrEmpId = m.body.data.id;
  const s = await as(hr).post(
    '/api/v1/employees',
    hireBody({
      firstName: 'Sunil',
      reportsToId: mgrEmpId,
      nic: '199012345678',
      mobile: '0771234567',
    }),
  );
  staffEmpId = s.body.data.id;
  const o = await as(hr).post(
    '/api/v1/employees',
    hireBody({ firstName: 'Other', departmentId: dept.OPS }),
  );
  otherEmpId = o.body.data.id;
  mgr = (await h.createUser('a', { email: 'm@a.lk', roles: ['manager'], employeeId: mgrEmpId }))
    .token;
  staff = (
    await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: staffEmpId })
  ).token;
});

afterAll(async () => {
  await h?.close();
});

describe('hiring', () => {
  it('assigns numbers from the sequence and opens the job history', async () => {
    const d = employeeDetailSchema.parse(
      (await as(hr).get(`/api/v1/employees/${mgrEmpId}`)).body.data,
    );
    expect(d.employeeNo).toBe('EMP-0001');
    expect(d.department?.name).toBe('SALES');
    const hist = (await as(hr).get(`/api/v1/employees/${mgrEmpId}/job-history`)).body.data.map(
      (x: unknown) => jobHistoryItemSchema.parse(x),
    );
    expect(hist).toMatchObject([
      { reason: 'hire', effectiveFrom: '2025-02-01', effectiveTo: null },
    ]);
  });

  it('validates NIC format and uniqueness', async () => {
    expect((await as(hr).post('/api/v1/employees', hireBody({ nic: '12345' }))).status).toBe(400);
    expect(
      (await as(hr).post('/api/v1/employees', hireBody({ nic: '1990 1234 5678' }))).status,
    ).toBe(409);
  });

  it('puts employees with a future probation end on probation', async () => {
    const p = await as(hr).post(
      '/api/v1/employees',
      hireBody({ firstName: 'Pro', employmentType: 'probation', probationEndDate: '2099-01-01' }),
    );
    expect(p.body.data.status).toBe('on_probation');
    const c = await as(hr).post(`/api/v1/employees/${p.body.data.id}/confirm`, {
      confirmationDate: '2025-08-01',
    });
    expect(c.body.data).toMatchObject({
      status: 'active',
      confirmationDate: '2025-08-01',
      employmentType: 'permanent',
    });
  });

  it('only HR can hire', async () => {
    expect((await as(mgr).post('/api/v1/employees', hireBody())).status).toBe(403);
  });
});

describe('list, search and access tiers', () => {
  it('searches, filters and paginates', async () => {
    const all = employeePageSchema.parse(
      (await as(hr).get('/api/v1/employees?pageSize=2')).body.data,
    );
    expect(all.items).toHaveLength(2);
    expect(all.total).toBeGreaterThanOrEqual(4);
    const sunil = employeePageSchema.parse((await as(hr).get('/api/v1/employees?q=sun')).body.data);
    expect(sunil.items.map((e) => e.name)).toEqual(['Sunil Silva']);
    const ops = employeePageSchema.parse(
      (await as(hr).get(`/api/v1/employees?departmentId=${dept.OPS}`)).body.data,
    );
    expect(ops.items.map((e) => e.name)).toEqual(['Other Silva']);
  });

  it('a manager sees team members with work details only', async () => {
    const d = employeeDetailSchema.parse(
      (await as(mgr).get(`/api/v1/employees/${staffEmpId}`)).body.data,
    );
    expect(d.access).toBe('work');
    expect(d.personal).toBeNull();
    expect(d.bank).toBeNull();
    expect((await as(mgr).get(`/api/v1/employees/${otherEmpId}`)).status).toBe(404);
    expect((await as(mgr).get(`/api/v1/employees/${staffEmpId}/contacts`)).status).toBe(403);
  });

  it('employees see their own full record; HR sees everyone in full', async () => {
    const self = employeeDetailSchema.parse(
      (await as(staff).get(`/api/v1/employees/${staffEmpId}`)).body.data,
    );
    expect(self).toMatchObject({
      access: 'full',
      personal: { nic: '199012345678', mobile: '0771234567' },
    });
    expect((await as(staff).get(`/api/v1/employees/${mgrEmpId}`)).status).toBe(404);
    expect(
      employeeDetailSchema.parse((await as(hr).get(`/api/v1/employees/${staffEmpId}`)).body.data)
        .access,
    ).toBe('full');
  });

  it('exports CSV with sensitive columns for HR and audits the export', async () => {
    const res = await as(hr).get('/api/v1/employees/export.csv');
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('NIC');
    expect(res.text).toContain('199012345678');
    const audit = await as(hr).get('/api/v1/audit-log?entity=employees');
    expect(audit.body.data.items.some((i: { action: string }) => i.action === 'export')).toBe(true);
  });

  it('builds a scoped org chart', async () => {
    const nodes = (await as(mgr).get('/api/v1/org-chart')).body.data as {
      id: string;
      reportsToId: string | null;
    }[];
    expect(nodes.map((n) => n.id).sort()).toEqual([mgrEmpId, staffEmpId].sort());
  });
});

describe('job changes and lifecycle', () => {
  it('transfers with an effective date and answers as-of queries', async () => {
    const r = await as(hr).post(`/api/v1/employees/${otherEmpId}/job-change`, {
      effectiveFrom: '2025-06-01',
      reason: 'transfer',
      departmentId: dept.SALES,
      employmentType: 'permanent',
    });
    expect(r.body.data.department.name).toBe('SALES');
    const before = await as(hr).get(`/api/v1/employees/${otherEmpId}/job?date=2025-05-31`);
    const after = await as(hr).get(`/api/v1/employees/${otherEmpId}/job?date=2025-06-01`);
    expect(before.body.data.department.name).toBe('OPS');
    expect(after.body.data.department.name).toBe('SALES');
  });

  it('rejects reporting loops and changes before joining', async () => {
    const loop = await as(hr).post(`/api/v1/employees/${mgrEmpId}/job-change`, {
      effectiveFrom: '2025-07-01',
      reason: 'manager_change',
      reportsToId: staffEmpId,
      employmentType: 'permanent',
    });
    expect(loop.status).toBe(400);
    const early = await as(hr).post(`/api/v1/employees/${otherEmpId}/job-change`, {
      effectiveFrom: '2020-01-01',
      reason: 'transfer',
      employmentType: 'permanent',
    });
    expect(early.status).toBe(400);
  });

  it('notice then exit closes the job history at the exit date', async () => {
    const n = await as(hr).post(`/api/v1/employees/${otherEmpId}/notice`, {
      exitDate: '2026-12-31',
      exitReason: 'Resigned',
    });
    expect(n.body.data.status).toBe('notice');
    const x = await as(hr).post(`/api/v1/employees/${otherEmpId}/exit`, {
      exitDate: '2026-12-31',
      status: 'resigned',
      exitReason: 'Resigned',
    });
    expect(x.body.data.status).toBe('resigned');
    const hist = (await as(hr).get(`/api/v1/employees/${otherEmpId}/job-history`)).body.data;
    expect(hist[0].effectiveTo).toBe('2026-12-31');
    const current = employeePageSchema.parse(
      (await as(hr).get('/api/v1/employees?q=other')).body.data,
    );
    expect(current.items).toHaveLength(0);
    const all = employeePageSchema.parse(
      (await as(hr).get('/api/v1/employees?q=other&status=all')).body.data,
    );
    expect(all.items).toHaveLength(1);
  });
});

describe('documents', () => {
  it('uploads privately, lists, signs short-lived URLs, and keeps others out', async () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const up = await as(hr)
      .post(
        `/api/v1/employees/${staffEmpId}/documents?category=identity&title=NIC%20copy&expiryDate=2026-11-01`,
      )
      .set('content-type', 'application/pdf')
      .send(pdf);
    expect(up.status).toBe(201);
    expect(
      [...h.storage.files.keys()].some((k) => k.startsWith(`employee-documents/${staffEmpId}/`)),
    ).toBe(true);

    const own = await as(staff).get(`/api/v1/employees/${staffEmpId}/documents`);
    expect(own.body.data.map((d: { title: string }) => d.title)).toEqual(['NIC copy']);
    const url = await as(staff).get(
      `/api/v1/employees/${staffEmpId}/documents/${up.body.data.id}/url`,
    );
    expect(url.body.data).toMatchObject({ expiresIn: 60 });
    expect((await as(staff).get(`/api/v1/employees/${mgrEmpId}/documents`)).status).toBe(404);
    expect(
      (
        await as(staff)
          .post(`/api/v1/employees/${staffEmpId}/documents?category=other&title=x`)
          .set('content-type', 'application/pdf')
          .send(pdf)
      ).status,
    ).toBe(403);

    const bad = await as(hr)
      .post(`/api/v1/employees/${staffEmpId}/documents?category=other&title=x`)
      .set('content-type', 'text/plain')
      .send('hi');
    expect(bad.status).toBe(400);

    const expiring = await as(hr).get('/api/v1/documents/expiring?days=365');
    expect(expiring.body.data[0]).toMatchObject({ title: 'NIC copy', employeeName: 'Sunil Silva' });
  });
});

describe('bulk import (500 rows with deliberate errors)', () => {
  const rows = Array.from({ length: 500 }, (_, i) => {
    const n = i + 1;
    const values: Record<string, string> = {
      employeeNo: `IMP-${String(n).padStart(4, '0')}`,
      firstName: `First${n}`,
      lastName: `Last${n}`,
      joinDate: '2024-03-01',
      departmentCode: n % 2 ? 'sales' : 'OPS',
      employmentType: 'Permanent',
      reportsToEmployeeNo: n > 1 && n <= 20 ? 'IMP-0001' : '',
    };
    if (n === 37) values.joinDate = '2024-02-30'; // impossible date
    if (n === 101) values.departmentCode = 'NOPE'; // unknown code
    if (n === 250) values.employeeNo = 'IMP-0249'; // duplicate within file
    if (n === 333) values.nic = '199012345678'; // NIC already used
    if (n === 404) values.firstName = ''; // missing required
    if (n === 499) values.reportsToEmployeeNo = 'GHOST'; // unknown manager
    return { line: n + 1, values };
  });

  it('previews row-level errors without writing anything', async () => {
    const p = importPreviewSchema.parse(
      (await as(hr).post('/api/v1/imports/employees/preview', { rows })).body.data,
    );
    expect(p.total).toBe(500);
    expect(p.valid).toBe(494);
    expect([...new Set(p.errors.map((e) => e.line))].sort((a, b) => a - b)).toEqual([
      38, 102, 251, 334, 405, 500,
    ]);
    expect(p.errors.find((e) => e.line === 102)?.message).toContain('Unknown department code');
    expect(p.errors.find((e) => e.line === 251)?.message).toContain('Duplicate employee no');
  });

  it('refuses to commit with errors unless told to skip them, and then imports atomically', async () => {
    const blocked = await as(hr).post('/api/v1/imports/employees/commit', { rows });
    expect(blocked.status).toBe(400);
    expect(
      employeePageSchema.parse((await as(hr).get('/api/v1/employees?q=IMP-&pageSize=1')).body.data)
        .total,
    ).toBe(0);

    const done = importReportSchema.parse(
      (await as(hr).post('/api/v1/imports/employees/commit', { rows, skipInvalid: true })).body
        .data,
    );
    expect(done.imported).toBe(494);
    expect(done.skippedLines).toEqual([38, 102, 251, 334, 405, 500]);
    expect(
      employeePageSchema.parse((await as(hr).get('/api/v1/employees?q=IMP-&pageSize=1')).body.data)
        .total,
    ).toBe(494);

    const list = employeePageSchema.parse(
      (await as(hr).get('/api/v1/employees?q=IMP-0002')).body.data,
    );
    const d = employeeDetailSchema.parse(
      (await as(hr).get(`/api/v1/employees/${list.items[0]!.id}`)).body.data,
    );
    expect(d.reportsTo?.name).toBe('First1 Last1'); // manager defined in the same file
  }, 120_000);

  it('only HR can import', async () => {
    expect(
      (await as(mgr).post('/api/v1/imports/employees/preview', { rows: rows.slice(0, 1) })).status,
    ).toBe(403);
  });
});
