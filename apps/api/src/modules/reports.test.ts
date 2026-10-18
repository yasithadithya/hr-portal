import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { HrDashboard, LeaveType, ReportResult } from '@hr/shared';
import { money } from '@hr/shared/money';
import { addDays, countWorkingDays, monthRange, today as todayIn } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let owner: string;
let hr: string;
let mgr: string;
let staff: string;
let pay: string;
const ids = {} as Record<'mgr' | 'staff' | 'other' | 'leaver' | 'dept', string>;
const T = todayIn('Asia/Colombo');

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
});
const report = async (token: string, key: string, q = '') =>
  (await as(token).get(`/api/v1/reports/${key}${q}`)).body.data as ReportResult;

beforeAll(async () => {
  h = await createHarness('reports', ['a']);
  owner = (await h.createUser('a', { email: 'owner@a.lk', roles: ['owner'] })).token;
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  pay = (await h.createUser('a', { email: 'pay@a.lk', roles: ['payroll_admin'] })).token;
  ids.mgr = await h.createEmployee('a', 'R-MGR');
  ids.staff = await h.createEmployee('a', 'R-STAFF', ids.mgr);
  ids.other = await h.createEmployee('a', 'R-OTHER');
  ids.leaver = await h.createEmployee('a', 'R-LEAVER');
  mgr = (await h.createUser('a', { email: 'm@a.lk', roles: ['manager'], employeeId: ids.mgr }))
    .token;
  staff = (await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: ids.staff }))
    .token;
  const sql = h.tenants.a!.sql;
  const [d] =
    await sql`insert into departments (code, name) values ('OPS', 'Operations') returning id`;
  ids.dept = d!.id as string;
  await sql`update employees set department_id = ${ids.dept} where id in (${ids.mgr}, ${ids.staff})`;
  await sql`update employees set nic = '199012345678' where id = ${ids.staff}`;
  await sql`update employees set status = 'resigned', exit_date = ${addDays(T, -40)} where id = ${ids.leaver}`;
  await sql`update employees set join_date = ${T} where id = ${ids.other}`;
});

afterAll(async () => {
  await h?.close();
});

describe('HR dashboard', () => {
  it('shows headcount, joiners, turnover, attendance and approvals for HR', async () => {
    const d = (await as(hr).get('/api/v1/dashboard/hr')).body.data as HrDashboard;
    expect(d.scope).toBe('all');
    expect(d.headcount.total).toBe(3);
    expect(d.headcount.byDepartment).toEqual(
      expect.arrayContaining([{ key: 'Operations', label: 'Operations', count: 2 }]),
    );
    expect(d.joinersThisMonth).toBeGreaterThanOrEqual(1);
    expect(d.turnover12m.leavers).toBe(1);
    expect(d.turnover12m.percent).toBeGreaterThan(0);
    expect(d.attendanceToday).not.toBeNull();
    expect(d.approvals.total).toBe(0);
  });

  it('managers see only their team; employees cannot open it', async () => {
    const d = (await as(mgr).get('/api/v1/dashboard/hr')).body.data as HrDashboard;
    expect(d.scope).toBe('team');
    expect(d.headcount.total).toBe(2);
    expect(d.turnover12m.leavers).toBe(0);
    expect((await as(staff).get('/api/v1/dashboard/hr')).status).toBe(403);
  });
});

describe('payroll dashboard', () => {
  it('is for payroll staff only', async () => {
    expect((await as(hr).get('/api/v1/dashboard/payroll')).status).toBe(403);
    const d = (await as(pay).get('/api/v1/dashboard/payroll')).body.data;
    expect(d).toMatchObject({ trend: [], latest: null });
  });
});

describe('reports', () => {
  it('lists only the reports the caller may run', async () => {
    const keys = async (t: string) =>
      ((await as(t).get('/api/v1/reports')).body.data as { key: string }[]).map((r) => r.key);
    expect(await keys(owner)).toEqual([
      'employee-master',
      'leave-balances',
      'leave-liability',
      'attendance-summary',
      'payroll-register',
    ]);
    expect(await keys(hr)).toEqual(['employee-master', 'leave-balances', 'attendance-summary']);
    expect(await keys(mgr)).toEqual(['employee-master', 'leave-balances', 'attendance-summary']);
    expect(await keys(staff)).toEqual([]);
    expect((await as(hr).get('/api/v1/reports/payroll-register')).status).toBe(403);
  });

  it('employee master: HR sees identifiers; managers see their team without them', async () => {
    const full = await report(hr, 'employee-master');
    expect(full.columns.map((c) => c.key)).toContain('nic');
    expect(full.rows.map((r) => r.employeeNo)).toEqual(['R-LEAVER', 'R-MGR', 'R-OTHER', 'R-STAFF']);
    const team = await report(mgr, 'employee-master');
    expect(team.columns.map((c) => c.key)).not.toContain('nic');
    expect(team.rows.map((r) => r.employeeNo)).toEqual(['R-MGR', 'R-STAFF']);
    expect(team.rows[0]).not.toHaveProperty('nic');
    const ops = await report(hr, 'employee-master', `?departmentId=${ids.dept}`);
    expect(ops.rows).toHaveLength(2);
  });

  it('exports CSV and XLSX', async () => {
    const csv = await as(hr).get('/api/v1/reports/employee-master?format=csv').buffer(true);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Employee no,Name,Department/);
    const xlsx = await as(hr)
      .get('/api/v1/reports/employee-master?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const [audit] = await h.tenants.a!.sql`
      select count(*)::int as n from audit_log where entity = 'reports' and action = 'export_employee-master'`;
    expect(audit!.n).toBe(2);
  });

  it('leave liability values unused paid leave at basic ÷ the no-pay divisor', async () => {
    const types = (await as(owner).get('/api/v1/leave/types')).body.data as LeaveType[];
    const annual = types.find((t) => t.code === 'ANNUAL')!;
    await as(owner).post('/api/v1/leave/adjustments', {
      employeeId: ids.staff,
      leaveTypeId: annual.id,
      year: Number(T.slice(0, 4)),
      amount: 10,
      note: 'Opening',
    });
    await as(owner).post(`/api/v1/payroll/employees/${ids.staff}/salary`, {
      effectiveFrom: '2020-01-01',
      basic: '66000',
    });
    const r = await report(owner, 'leave-liability');
    const [y, m] = T.split('-').map(Number) as [number, number];
    const range = monthRange(y, m);
    const wd = countWorkingDays(range.start, range.end, {
      sun: 'off',
      mon: 'full',
      tue: 'full',
      wed: 'full',
      thu: 'full',
      fri: 'full',
      sat: 'off',
    });
    const daily = money('66000').dividedBy(wd);
    expect(r.rows).toEqual([
      expect.objectContaining({
        employeeNo: 'R-STAFF',
        leaveType: 'Annual leave',
        days: 10,
        dailyRate: daily.toFixed(2),
        liability: daily.times(10).toFixed(2),
      }),
    ]);
    expect(r.note).toMatch(/working days/);
  });

  it('attendance summary and leave balances run for a manager (team only)', async () => {
    const att = await report(mgr, 'attendance-summary');
    expect(att.rows.map((r) => r.employeeNo)).toEqual(['R-MGR', 'R-STAFF']);
    const bal = await report(mgr, 'leave-balances');
    expect(bal.rows.find((r) => r.employeeNo === 'R-STAFF')).toMatchObject({ ANNUAL: 10 });
  });
});
