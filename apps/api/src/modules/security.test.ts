import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LeaveType } from '@hr/shared';
import { addDays, today as todayIn, weekdayOf } from '@hr/shared/time';

import { createApp } from '../app';
import { loadEnv } from '../env';
import { Bucket } from '../middleware/rateLimit';
import { createHarness, type Harness } from '../test/harness';

/**
 * IDOR suite across resources (PLAN.md Phase 10): an employee can never reach another employee's
 * data by guessing ids, and a user of another tenant gets nothing. Out-of-scope reads answer 404
 * (no id oracle); actions needing a permission the caller lacks answer 403.
 */
let h: Harness;
const A = 'a.localhost';
let hr: string;
let victim: string;
let attacker: string;
let outsider: string;
const ids = {} as Record<
  | 'victim'
  | 'attacker'
  | 'victimUser'
  | 'doc'
  | 'leave'
  | 'reg'
  | 'payslip'
  | 'change'
  | 'note'
  | 'annual',
  string
>;
const T = todayIn('Asia/Colombo');

const as = (token: string, host = A) => ({
  get: (p: string) =>
    request(h.app).get(p).set('host', host).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', host).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object | Buffer, type?: string) => {
    const r = request(h.app).put(p).set('host', host).set('authorization', `Bearer ${token}`);
    return type ? r.set('content-type', type).send(b) : r.send(b);
  },
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  h = await createHarness('security', ['a', 'b']);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  ids.victim = await h.createEmployee('a', 'S-VICTIM');
  ids.attacker = await h.createEmployee('a', 'S-ATTACK');
  const v = await h.createUser('a', {
    email: 'v@a.lk',
    roles: ['employee'],
    employeeId: ids.victim,
  });
  victim = v.token;
  ids.victimUser = v.id;
  attacker = (
    await h.createUser('a', { email: 'x@a.lk', roles: ['employee'], employeeId: ids.attacker })
  ).token;
  outsider = (await h.createUser('b', { email: 'b@b.lk', roles: ['owner'] })).token;

  // Victim's data.
  const up = await request(h.app)
    .post(`/api/v1/employees/${ids.victim}/documents?category=identity&title=NIC%20copy`)
    .set('host', A)
    .set('authorization', `Bearer ${hr}`)
    .set('content-type', 'application/pdf')
    .send(PDF);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  ids.doc = up.body.data.id;

  const types = (await as(hr).get('/api/v1/leave/types')).body.data as LeaveType[];
  ids.annual = types.find((t) => t.code === 'ANNUAL')!.id;
  let d = addDays(T, 30);
  while (weekdayOf(d) !== 'tue') d = addDays(d, 1);
  const lv = await as(victim).post('/api/v1/leave/requests', {
    leaveTypeId: types.find((t) => t.code === 'NOPAY')!.id,
    startDate: d,
    endDate: d,
  });
  ids.leave = lv.body.data.id;
  const reg = await as(victim).post('/api/v1/attendance/regularizations', {
    date: addDays(T, -2),
    requestedIn: '08:30',
    reason: 'Forgot',
  });
  ids.reg = reg.body.data.id;
  const ch = await as(victim).post('/api/v1/me/profile-changes', {
    section: 'contact',
    values: { mobile: '+94 77 000 1111' },
  });
  ids.change = ch.body.data.id;

  const sql = h.tenants.a!.sql;
  const [p] = await sql`
    insert into payroll_periods (year, month, start_date, end_date, pay_date)
    values (2025, 1, '2025-01-01', '2025-01-31', '2025-01-31') returning id`;
  const [r] = await sql`insert into payroll_runs (period_id) values (${p!.id}) returning id`;
  const [s] = await sql`
    insert into payslips (run_id, employee_id, gross, total_deductions, net, employer_cost,
      epf_base, etf_base, apit_base, snapshot, trace)
    values (${r!.id}, ${ids.victim}, 100000, 8000, 92000, 115000, 100000, 100000, 100000, '{}', '[]')
    returning id`;
  ids.payslip = s!.id as string;
  await sql`update payroll_runs set status = 'locked' where id = ${r!.id}`;
  const [n] = await sql`
    insert into notifications (user_id, event, title, body)
    values (${ids.victimUser}, 'leave.decided', 'Private', 'Private') returning id`;
  ids.note = n!.id as string;
});

afterAll(async () => {
  await h?.close();
});

describe('IDOR: another employee in the same company', () => {
  const cases: [string, 'get' | 'post', () => string, number][] = [
    ['employee detail', 'get', () => `/api/v1/employees/${ids.victim}`, 404],
    ['job history', 'get', () => `/api/v1/employees/${ids.victim}/job-history`, 404],
    ['contacts', 'get', () => `/api/v1/employees/${ids.victim}/contacts`, 404],
    ['documents', 'get', () => `/api/v1/employees/${ids.victim}/documents`, 404],
    ['document url', 'get', () => `/api/v1/employees/${ids.victim}/documents/${ids.doc}/url`, 404],
    ['data export', 'get', () => `/api/v1/employees/${ids.victim}/data-export`, 403],
    ['leave balances', 'get', () => `/api/v1/leave/balances?employeeId=${ids.victim}`, 404],
    [
      'leave ledger',
      'get',
      () => `/api/v1/leave/ledger?employeeId=${ids.victim}&leaveTypeId=${ids.annual}&year=2026`,
      404,
    ],
    ['leave attachment', 'get', () => `/api/v1/leave/requests/${ids.leave}/attachment`, 404],
    ['cancel leave', 'post', () => `/api/v1/leave/requests/${ids.leave}/cancel`, 404],
    ['approve leave', 'post', () => `/api/v1/leave/requests/${ids.leave}/approve`, 403],
    [
      'attendance month',
      'get',
      () => `/api/v1/attendance/days?month=${T.slice(0, 7)}&employeeId=${ids.victim}`,
      404,
    ],
    [
      'punches',
      'get',
      () => `/api/v1/attendance/punches?employeeId=${ids.victim}&from=${T}&to=${T}`,
      404,
    ],
    [
      'cancel correction',
      'post',
      () => `/api/v1/attendance/regularizations/${ids.reg}/cancel`,
      404,
    ],
    [
      'approve correction',
      'post',
      () => `/api/v1/attendance/regularizations/${ids.reg}/approve`,
      403,
    ],
    ['payslip', 'get', () => `/api/v1/payslips/${ids.payslip}`, 404],
    ['payslip pdf', 'get', () => `/api/v1/payslips/${ids.payslip}/pdf`, 404],
    ['pay setup', 'get', () => `/api/v1/payroll/employees/${ids.victim}/setup`, 403],
    [
      'withdraw profile change',
      'post',
      () => `/api/v1/me/profile-changes/${ids.change}/withdraw`,
      404,
    ],
    ['approve profile change', 'post', () => `/api/v1/profile-changes/${ids.change}/approve`, 403],
    ['mark notification read', 'post', () => `/api/v1/notifications/${ids.note}/read`, 404],
  ];

  it.each(cases)('%s → %i', async (_name, method, path, status) => {
    const res =
      method === 'get' ? await as(attacker).get(path()) : await as(attacker).post(path(), {});
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
  });

  it('lists never include someone else’s rows', async () => {
    expect((await as(attacker).get(`/api/v1/payslips?employeeId=${ids.victim}`)).body.data).toEqual(
      [],
    );
    expect((await as(attacker).get('/api/v1/leave/requests')).body.data).toEqual([]);
    expect((await as(attacker).get('/api/v1/attendance/regularizations')).body.data).toEqual([]);
    expect((await as(attacker).get('/api/v1/notifications')).body.data.items).toEqual([]);
  });

  it('the owner of the data can read it', async () => {
    expect((await as(victim).get(`/api/v1/payslips/${ids.payslip}`)).status).toBe(200);
    expect((await as(victim).get(`/api/v1/employees/${ids.victim}/documents`)).status).toBe(200);
  });
});

describe('tenant isolation', () => {
  it('a token from another company is refused on this company’s host', async () => {
    const res = await as(outsider).get(`/api/v1/employees/${ids.victim}`);
    expect([401, 403]).toContain(res.status);
    expect((await as(outsider).get('/api/v1/me')).status).toBeGreaterThanOrEqual(401);
  });

  it('ids from one tenant are unknown in another', async () => {
    const res = await as(outsider, 'b.localhost').get(`/api/v1/employees/${ids.victim}`);
    expect(res.status).toBe(404);
  });
});

describe('uploads', () => {
  it('refuses a file whose bytes do not match its declared type', async () => {
    const res = await request(h.app)
      .post(`/api/v1/employees/${ids.victim}/documents?category=identity&title=Fake`)
      .set('host', A)
      .set('authorization', `Bearer ${hr}`)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('<html><script>alert(1)</script></html>'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/don’t match/);
  });

  it('refuses SVG logos with scripts', async () => {
    const res = await request(h.app)
      .put('/api/v1/company/logo')
      .set('host', A)
      .set('authorization', `Bearer ${hr}`)
      .set('content-type', 'image/svg+xml')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'));
    expect([400, 403]).toContain(res.status);
  });
});

describe('rate limiting', () => {
  it('fixed window counts per key and resets', () => {
    let t = 0;
    const b = new Bucket(2, 1000, () => t);
    expect([b.hit('x'), b.hit('x'), b.hit('y')]).toEqual([0, 0, 0]);
    expect(b.hit('x')).toBe(1);
    t = 1001;
    expect(b.hit('x')).toBe(0);
  });

  it('answers 429 with Retry-After when an IP sends too many requests', async () => {
    const app = createApp({
      env: loadEnv({ NODE_ENV: 'test', RATE_LIMIT_PER_IP: '3' }),
      logger: pino({ level: 'silent' }),
    });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await request(app).get('/health')).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    const last = await request(app).get('/health');
    expect(last.headers['retry-after']).toBeDefined();
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});
