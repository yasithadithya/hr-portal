import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let owner: string;
let hr: string;
let staff: string;
const ids = {} as Record<'staff' | 'former' | 'formerUser' | 'doc', string>;
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
});

beforeAll(async () => {
  h = await createHarness('privacy', ['a']);
  owner = (await h.createUser('a', { email: 'owner@a.lk', roles: ['owner'] })).token;
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  ids.staff = await h.createEmployee('a', 'P-STAFF');
  ids.former = await h.createEmployee('a', 'P-FORMER');
  staff = (await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: ids.staff }))
    .token;
  ids.formerUser = (
    await h.createUser('a', { email: 'f@a.lk', roles: ['employee'], employeeId: ids.former })
  ).id;
  const sql = h.tenants.a!.sql;
  await sql`update employees set nic = '198512345678', mobile = '+94770000000', bank_account_no = '123456'
            where id = ${ids.staff}`;
  await sql`update employees set join_date = '2010-01-04', status = 'resigned', exit_date = '2015-03-31', nic = '197012345678',
            mobile = '+94711111111', bank_account_no = '999999', exit_reason = 'Moved abroad'
            where id = ${ids.former}`;
  await sql`insert into employee_contacts (employee_id, type, name, relationship, phone)
            values (${ids.former}, 'emergency', 'Spouse', 'spouse', '+94712222222')`;
  const up = await request(h.app)
    .post(`/api/v1/employees/${ids.former}/documents?category=identity&title=NIC`)
    .set('host', A)
    .set('authorization', `Bearer ${hr}`)
    .set('content-type', 'application/pdf')
    .send(PDF);
  expect(up.status).toBe(201);
  ids.doc = up.body.data.id;
});

afterAll(async () => {
  await h?.close();
});

describe('privacy notice', () => {
  it('nothing to acknowledge until the company writes a notice', async () => {
    expect((await as(staff).get('/api/v1/privacy')).body.data).toMatchObject({
      notice: null,
      mustAcknowledge: false,
    });
  });

  it('a published notice must be acknowledged, and again when the version is raised', async () => {
    await as(owner).put('/api/v1/settings/privacy.notice', {
      value: 'We process your data to run payroll.',
    });
    expect((await as(staff).get('/api/v1/privacy')).body.data.mustAcknowledge).toBe(true);
    expect((await as(staff).post('/api/v1/privacy/acknowledge', { version: 2 })).status).toBe(400);
    await as(staff).post('/api/v1/privacy/acknowledge', { version: 1 });
    expect((await as(staff).get('/api/v1/privacy')).body.data).toMatchObject({
      acknowledgedVersion: 1,
      mustAcknowledge: false,
    });
    await as(owner).put('/api/v1/settings/privacy.notice_version', { value: 2 });
    expect((await as(staff).get('/api/v1/privacy')).body.data.mustAcknowledge).toBe(true);
  });
});

describe('data-subject export', () => {
  it('an employee downloads their own data package', async () => {
    const res = await as(staff).get('/api/v1/me/data-export');
    expect(res.headers['content-disposition']).toMatch(/personal-data-P-STAFF\.json/);
    const pkg = JSON.parse(res.text).data;
    expect(pkg.employee).toMatchObject({ employeeNo: 'P-STAFF', nic: '198512345678' });
    expect(pkg).toHaveProperty('leave.requests');
    expect(pkg).toHaveProperty('attendance.punches');
    expect(pkg).toHaveProperty('payslips');
    expect(pkg.accounts[0].email).toBe('s@a.lk');
  });

  it('HR can produce it for any employee (audited); others cannot', async () => {
    const res = await as(hr).get(`/api/v1/employees/${ids.former}/data-export`);
    const pkg = JSON.parse(res.text).data;
    expect(pkg.documents[0]).toMatchObject({ title: 'NIC' });
    expect(pkg.documents[0]).not.toHaveProperty('storagePath');
    expect((await as(staff).get(`/api/v1/employees/${ids.former}/data-export`)).status).toBe(403);
    const [a] = await h.tenants.a!.sql`
      select count(*)::int as n from audit_log where action = 'data_export'`;
    expect(a!.n).toBe(2);
  });
});

describe('access to sensitive data is logged', () => {
  it('HR viewing an employee record is logged; the employee viewing their own is not', async () => {
    const count = async () =>
      (
        await h.tenants.a!.sql`select count(*)::int as n from audit_log
          where action = 'view_personal' and entity_id = ${ids.staff}`
      )[0]!.n as number;
    const before = await count();
    await as(staff).get(`/api/v1/employees/${ids.staff}`);
    expect(await count()).toBe(before);
    await as(hr).get(`/api/v1/employees/${ids.staff}`);
    expect(await count()).toBe(before + 1);
  });

  it('viewing pay setup is logged', async () => {
    await as(owner).get(`/api/v1/payroll/employees/${ids.staff}/setup`);
    const [r] = await h.tenants.a!.sql`
      select count(*)::int as n from audit_log where action = 'view_salary' and entity_id = ${ids.staff}`;
    expect(r!.n).toBe(1);
  });
});

describe('retention', () => {
  it('does nothing until a retention period is set', async () => {
    expect((await as(owner).get('/api/v1/privacy/retention')).body.data).toEqual({
      years: null,
      due: [],
    });
    expect((await as(owner).post('/api/v1/privacy/retention/run')).status).toBe(400);
    expect((await as(hr).get('/api/v1/privacy/retention')).status).toBe(200);
    expect((await as(staff).get('/api/v1/privacy/retention')).status).toBe(403);
  });

  it('anonymises former employees past the period, keeping the records', async () => {
    await as(owner).put('/api/v1/settings/privacy.retention_years_after_exit', { value: 7 });
    const preview = (await as(owner).get('/api/v1/privacy/retention')).body.data;
    expect(preview.due.map((d: { employeeNo: string }) => d.employeeNo)).toEqual(['P-FORMER']);

    // The nightly job does the same thing as the button.
    await h.jobs.send('daily.tenant', { tenantId: h.tenants.a!.id });
    await h.jobs.drain();
    expect(h.jobs.errors).toEqual([]);

    const sql = h.tenants.a!.sql;
    const [e] = await sql`select * from employees where id = ${ids.former}`;
    expect(e).toMatchObject({
      employee_no: 'P-FORMER',
      first_name: 'Former',
      nic: null,
      mobile: null,
      bank_account_no: null,
      exit_reason: null,
      exit_date: expect.anything(),
    });
    expect(e!.anonymized_at).not.toBeNull();
    expect(
      (await sql`select * from employee_contacts where employee_id = ${ids.former}`).length,
    ).toBe(0);
    expect(
      (await sql`select * from employee_documents where employee_id = ${ids.former}`).length,
    ).toBe(0);
    const [u] =
      await sql`select status, employee_id, email from app_users where id = ${ids.formerUser}`;
    expect(u).toMatchObject({ status: 'disabled', employee_id: null });
    expect(u!.email).toMatch(/anonymized\.invalid$/);
    // Current staff untouched; a second run finds nothing.
    const [s] = await sql`select nic from employees where id = ${ids.staff}`;
    expect(s!.nic).toBe('198512345678');
    expect((await as(owner).post('/api/v1/privacy/retention/run')).body.data.anonymized).toBe(0);
  });
});
