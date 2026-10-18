import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PayComponent, PayrollRun, PayslipSummary } from '@hr/shared';
import { money } from '@hr/shared/money';
import { addDays, monthRange, today as todayIn } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let owner: string;
let prep: string; // payroll admin (preparer)
let hr: string;
let staff: string;
let staff2: string;
const ids = {} as Record<'staff' | 'staff2' | 'nosal' | 'run' | 'adj' | 'statutory', string>;
const comps: Record<string, PayComponent> = {};

/** A finished month two months back (attendance can be locked). */
const T = todayIn('Asia/Colombo');
const [ty, tm] = T.split('-').map(Number) as [number, number];
const mIdx = ty * 12 + (tm - 1) - 2;
const Y = Math.floor(mIdx / 12);
const M = (mIdx % 12) + 1;
const MONTH = `${Y}-${String(M).padStart(2, '0')}`;
const RANGE = monthRange(Y, M);
const NEXT = (() => {
  const i = mIdx + 1;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
})();

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  del: (p: string) =>
    request(h.app).delete(p).set('host', A).set('authorization', `Bearer ${token}`),
});

const slips = async (runId: string) =>
  (await as(prep).get(`/api/v1/payroll/runs/${runId}/payslips`)).body.data as PayslipSummary[];

beforeAll(async () => {
  h = await createHarness('payroll', ['a']);
  owner = (await h.createUser('a', { email: 'owner@a.lk', roles: ['owner'] })).token;
  prep = (await h.createUser('a', { email: 'pay@a.lk', roles: ['payroll_admin'] })).token;
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  ids.staff = await h.createEmployee('a', 'P-STAFF');
  ids.staff2 = await h.createEmployee('a', 'P-STAFF2');
  ids.nosal = await h.createEmployee('a', 'P-NOSAL');
  staff = (await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: ids.staff }))
    .token;
  staff2 = (
    await h.createUser('a', { email: 's2@a.lk', roles: ['employee'], employeeId: ids.staff2 })
  ).token;
  await h.tenants.a!.sql`
    update employees set nic = '199012345678', epf_no = 'E100', bank_account_no = '0012345678',
      bank_account_name = 'P STAFF', bank_name = 'Sample Bank'
    where id = ${ids.staff}`;
  for (const c of (await as(prep).get('/api/v1/payroll/components')).body.data as PayComponent[])
    comps[c.code] = c;
});

afterAll(async () => {
  await h?.close();
});

describe('sample configuration', () => {
  it('seeds review-flagged sample components, statutory rates and the APIT table', async () => {
    expect(comps.BASIC).toMatchObject({ isSystem: true, needsReview: true });
    const stat = (await as(prep).get('/api/v1/payroll/statutory')).body.data;
    expect(stat[0]).toMatchObject({ epfEmployeeRate: '8', etfRate: '3', needsReview: true });
    ids.statutory = stat[0].id;
    const tables = (await as(prep).get('/api/v1/payroll/tax-tables')).body.data;
    expect(tables[0]).toMatchObject({ code: 'APIT_T1', needsReview: true });
    expect(tables[0].slabs).toHaveLength(6);
  });

  it('HR (no payroll permissions) and employees cannot see payroll config or pay', async () => {
    expect((await as(hr).get('/api/v1/payroll/components')).status).toBe(403);
    expect((await as(staff).get(`/api/v1/payroll/employees/${ids.staff}/setup`)).status).toBe(403);
  });

  it('validates formulas and tax slabs', async () => {
    const bad = await as(prep).post('/api/v1/payroll/components', {
      code: 'MEAL',
      name: 'Meal',
      kind: 'earning',
      calc: 'formula',
      formula: 'BASIC * process',
      isEpfApplicable: false,
      isEtfApplicable: false,
      isApitApplicable: true,
      isProrated: false,
      showOnPayslip: true,
      sortOrder: 4,
      isActive: true,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Unknown variable process/);
    const gap = await as(prep).post('/api/v1/payroll/tax-tables', {
      code: 'X',
      name: 'X',
      method: 'slab_monthly',
      effectiveFrom: '2030-01-01',
      slabs: [
        { from: '0', to: '100', rate: '0', deduct: '0' },
        { from: '200', to: null, rate: '10', deduct: '0' },
      ],
    });
    expect(gap.status).toBe(400);
  });
});

describe('pay setup', () => {
  it('records salary, a recurring allowance, a tax profile, bank codes and a loan', async () => {
    const base = `/api/v1/payroll/employees/${ids.staff}`;
    expect(
      (await as(prep).post(`${base}/salary`, { effectiveFrom: '2020-01-01', basic: '200000' }))
        .status,
    ).toBe(201);
    await as(prep).post(`${base}/recurring`, {
      componentId: comps.BUDGETARY_RELIEF!.id,
      amount: '3500',
      effectiveFrom: '2020-01-01',
    });
    await as(prep).put(`${base}/tax-profile`, {
      tableCode: 'APIT_T1',
      isResident: true,
      hasSecondaryEmployment: false,
      effectiveFrom: '2020-01-01',
    });
    await as(prep).put(`${base}/bank-codes`, { bankCode: '7010', branchCode: '1' });
    const loan = await as(prep).post(`${base}/loans`, {
      type: 'loan',
      principal: '15000',
      installmentAmount: '10000',
      startPeriod: MONTH,
    });
    expect(loan.status).toBe(201);
    expect(loan.body.data).toMatchObject({
      salaries: [expect.objectContaining({ basic: '200000.00' })],
      recurring: [expect.objectContaining({ code: 'BUDGETARY_RELIEF', amount: '3500.00' })],
      bank: expect.objectContaining({ bankCode: '7010', accountNo: '0012345678' }),
      loans: [expect.objectContaining({ principal: '15000.00', recovered: '0.00' })],
    });
    await as(prep).post(`/api/v1/payroll/employees/${ids.staff2}/salary`, {
      effectiveFrom: '2020-01-01',
      basic: '100000',
    });
  });

  it('a recurring item cannot be a system or variable component', async () => {
    const res = await as(prep).post(`/api/v1/payroll/employees/${ids.staff}/recurring`, {
      componentId: comps.BONUS!.id,
      amount: '1000',
      effectiveFrom: '2020-01-01',
    });
    expect(res.status).toBe(400);
  });
});

describe('payroll run', () => {
  it('opens a period once', async () => {
    const res = await as(prep).post('/api/v1/payroll/periods', {
      month: MONTH,
      payDate: RANGE.end,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'regular', status: 'draft', month: MONTH });
    ids.run = res.body.data.id;
    expect(
      (await as(prep).post('/api/v1/payroll/periods', { month: MONTH, payDate: RANGE.end })).status,
    ).toBe(409);
  });

  it('readiness blocks on unlocked attendance and flags sample config and missing data', async () => {
    const r = (await as(prep).get(`/api/v1/payroll/runs/${ids.run}/readiness`)).body.data;
    expect(r.ready).toBe(false);
    const codes = r.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'ATTENDANCE_NOT_LOCKED',
        'SAMPLE_CONFIG',
        'NO_SALARY',
        'NO_TAX_PROFILE',
      ]),
    );
    expect((await as(prep).post(`/api/v1/payroll/runs/${ids.run}/calculate`)).status).toBe(409);
  });

  it('calculates once attendance is locked', async () => {
    const lock = await as(hr).post(`/api/v1/attendance/periods/${MONTH}/lock`, { force: true });
    expect(lock.status).toBe(200);
    // A one-off bonus for staff.
    await as(prep).post(`/api/v1/payroll/runs/${ids.run}/inputs`, {
      employeeId: ids.staff,
      componentId: comps.BONUS!.id,
      amount: '20000',
      note: 'Performance',
    });
    const res = await as(prep).post(`/api/v1/payroll/runs/${ids.run}/calculate`);
    expect(res.status).toBe(200);
    const run = res.body.data as PayrollRun;
    expect(run).toMatchObject({ status: 'calculated', configNeedsReview: true });
    expect(run.totals!.employees).toBe(2);

    const list = await slips(ids.run);
    const s = list.find((x) => x.employeeId === ids.staff)!;
    // Basic 200,000 + relief 3,500 + bonus 20,000 = 223,500 gross.
    // EPF on 203,500 = 16,280. APIT on 223,500: 6% − 9,000 = 4,410. Loan 10,000.
    expect(s).toMatchObject({ gross: '223500.00', deductions: '30690.00', net: '192810.00' });
    const detail = (await as(prep).get(`/api/v1/payslips/${s.id}`)).body.data;
    const amt = (c: string) => detail.lines.find((l: { code: string }) => l.code === c)?.amount;
    expect([amt('EPF_EE'), amt('EPF_ER'), amt('ETF'), amt('APIT'), amt('LOAN_RECOVERY')]).toEqual([
      '16280.00',
      '24420.00',
      '6105.00',
      '4410.00',
      '10000.00',
    ]);
    expect(detail.trace.length).toBeGreaterThan(5);
  });

  it('recalculating is deterministic', async () => {
    const before = (await slips(ids.run)).map(({ id, ...rest }) => {
      void id;
      return rest;
    });
    await as(prep).post(`/api/v1/payroll/runs/${ids.run}/calculate`);
    const after = (await slips(ids.run)).map(({ id, ...rest }) => {
      void id;
      return rest;
    });
    expect(after).toEqual(before);
  });

  it('employees cannot see a payslip before the payroll is locked', async () => {
    const s = (await slips(ids.run)).find((x) => x.employeeId === ids.staff)!;
    expect((await as(staff).get(`/api/v1/payslips/${s.id}`)).status).toBe(404);
    expect((await as(staff).get('/api/v1/payslips')).body.data).toEqual([]);
  });

  it('maker-checker: the preparer cannot approve; payroll admins lack approval', async () => {
    const res = await as(prep).post(`/api/v1/payroll/runs/${ids.run}/approve`);
    expect(res.status).toBe(403);
    expect((await as(prep).get(`/api/v1/payroll/runs/${ids.run}/export/epf`)).status).toBe(400);
  });

  it('owner approves; preparer locks; inputs and recalculation are then refused', async () => {
    expect((await as(owner).post(`/api/v1/payroll/runs/${ids.run}/approve`)).body.data.status).toBe(
      'approved',
    );
    expect((await as(prep).post(`/api/v1/payroll/runs/${ids.run}/calculate`)).status).toBe(400);
    expect((await as(prep).post(`/api/v1/payroll/runs/${ids.run}/lock`)).body.data.status).toBe(
      'locked',
    );
    expect(
      (
        await as(prep).post(`/api/v1/payroll/runs/${ids.run}/inputs`, {
          employeeId: ids.staff,
          componentId: comps.BONUS!.id,
          amount: '1',
        })
      ).status,
    ).toBe(400);
  });

  it('locked payroll is immutable at the database level', async () => {
    const sql = h.tenants.a!.sql;
    await expect(sql`update payslips set net = 1 where run_id = ${ids.run}`).rejects.toThrow(
      /cannot change/,
    );
    await expect(
      sql`update payslip_lines set amount = 1 where payslip_id in (select id from payslips where run_id = ${ids.run})`,
    ).rejects.toThrow(/cannot change/);
    await expect(
      sql`update payroll_runs set status = 'draft' where id = ${ids.run}`,
    ).rejects.toThrow(/locked/);
    await expect(sql`delete from payroll_runs where id = ${ids.run}`).rejects.toThrow(/locked/);
    // Recording the PDF is still allowed.
    await sql`update payslips set pdf_path = 'x.pdf' where run_id = ${ids.run}`;
  });

  it('recovers the loan instalment on lock', async () => {
    const setup = (await as(prep).get(`/api/v1/payroll/employees/${ids.staff}/setup`)).body.data;
    expect(setup.loans[0]).toMatchObject({ recovered: '10000.00', status: 'active' });
  });

  it('settings used by a locked payroll cannot be edited (add a new version instead)', async () => {
    const stat = (await as(prep).get('/api/v1/payroll/statutory')).body.data[0];
    const { id, needsReview, ...body } = stat;
    void needsReview;
    expect((await as(prep).put(`/api/v1/payroll/statutory/${id}`, body)).status).toBe(409);
    const next = await as(prep).post('/api/v1/payroll/statutory', {
      ...body,
      effectiveFrom: `${NEXT}-01`,
    });
    expect(next.status).toBe(201);
  });

  it('salary changes cannot reach back into a locked month', async () => {
    const res = await as(prep).post(`/api/v1/payroll/employees/${ids.staff}/salary`, {
      effectiveFrom: RANGE.start,
      basic: '250000',
    });
    expect(res.status).toBe(409);
  });

  it('employees see their own locked payslip and PDF, never someone else’s', async () => {
    const list = (await as(staff).get('/api/v1/payslips')).body.data;
    expect(list).toHaveLength(1);
    const own = (await as(staff).get(`/api/v1/payslips/${list[0].id}`)).body.data;
    expect(own.trace).toBeNull();
    expect(own.net).toBe('192810.00');
    expect((await as(staff2).get(`/api/v1/payslips/${list[0].id}`)).status).toBe(404);
    expect((await as(staff2).get(`/api/v1/payslips?employeeId=${ids.staff}`)).body.data).toEqual(
      [],
    );
    const pdf = await as(staff).get(`/api/v1/payslips/${list[0].id}/pdf`).buffer(true);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('password-protected payslips need the NIC on file', async () => {
    await as(owner).put('/api/v1/settings/payroll.payslip_password', { value: 'nic' });
    const s2 = (await slips(ids.run)).find((x) => x.employeeId === ids.staff2)!;
    expect((await as(staff2).get(`/api/v1/payslips/${s2.id}/pdf`)).status).toBe(400);
    const own = (await as(staff).get('/api/v1/payslips')).body.data[0];
    const pdf = await as(staff).get(`/api/v1/payslips/${own.id}/pdf`).buffer(true);
    expect(pdf.body.toString('latin1')).toMatch(/\/Encrypt/);
    await as(owner).put('/api/v1/settings/payroll.payslip_password', { value: 'none' });
  });
});

describe('exports', () => {
  const text = async (kind: string) => {
    const res = await as(prep).get(`/api/v1/payroll/runs/${ids.run}/export/${kind}`).buffer(true);
    expect(res.status).toBe(200);
    const bom = String.fromCharCode(0xfeff);
    return res.text.startsWith(bom) ? res.text.slice(1) : res.text;
  };

  it('payroll register', async () => {
    const t = await text('register');
    expect(t).toMatch(/Employee no,Name,Department,Basic salary/);
    expect(t).toMatch(/P-STAFF,P-STAFF Test,,200000\.00/);
  });

  it('EPF, ETF and APIT schedules (sample layouts)', async () => {
    expect(await text('epf')).toMatch(
      /E100,199012345678,P-STAFF Test,203500\.00,16280\.00,24420\.00,40700\.00/,
    );
    expect(await text('etf')).toMatch(/203500\.00,6105\.00/);
    expect(await text('apit')).toMatch(/223500\.00,4410\.00/);
  });

  it('bank file: fixed width from the sample template; people without accounts are left out', async () => {
    const templates = (await as(prep).get('/api/v1/payroll/bank-templates')).body.data;
    const fixed = templates.find((t: { format: string }) => t.format === 'fixed_width');
    const res = await as(prep)
      .get(`/api/v1/payroll/runs/${ids.run}/export/bank?templateId=${fixed.id}`)
      .buffer(true);
    // Fixed-width lines end in padding spaces: split without trimming.
    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(78);
    expect(lines[0]!.slice(0, 23)).toBe('00007010001000012345678');
    expect(lines[0]).toContain('000019281000');
  });

  it('GL journal balances', async () => {
    const rows = (await text('gl'))
      .trim()
      .split('\r\n')
      .slice(1)
      .map((l) => l.split(','));
    const debit = rows.reduce((s, r) => s.plus(r[2]!), money(0));
    const credit = rows.reduce((s, r) => s.plus(r[3]!), money(0));
    expect(debit.toFixed(2)).toBe(credit.toFixed(2));
  });

  it('T-10 totals for the tax year', async () => {
    const startYear = M >= 4 ? Y : Y - 1;
    const res = await as(prep).get(`/api/v1/payroll/reports/t10?year=${startYear}`).buffer(true);
    expect(res.text).toMatch(/P-STAFF,P-STAFF Test,199012345678,,223500\.00,223500\.00,4410\.00/);
  });
});

describe('adjustment run', () => {
  it('pays only the employees with inputs (statutory on the adjustment only)', async () => {
    const [period] = await h.tenants.a!.sql`select id from payroll_periods limit 1`;
    const res = await as(prep).post('/api/v1/payroll/runs', {
      periodId: period!.id,
      type: 'adjustment',
      notes: 'Missed arrears',
    });
    expect(res.status).toBe(201);
    ids.adj = res.body.data.id;
    await as(prep).post(`/api/v1/payroll/runs/${ids.adj}/inputs`, {
      employeeId: ids.staff2,
      componentId: comps.ARREARS!.id,
      amount: '5000',
    });
    const calc = await as(prep).post(`/api/v1/payroll/runs/${ids.adj}/calculate`);
    expect(calc.body.data.totals.employees).toBe(1);
    const [s] = await slips(ids.adj);
    // EPF 8% of 5,000 = 400.
    expect(s).toMatchObject({ employeeId: ids.staff2, gross: '5000.00', net: '4600.00' });
  });
});

describe('scale', () => {
  it('calculates 500 employees in under 60 seconds', async () => {
    const sql = h.tenants.a!.sql;
    await sql`
      with e as (
        insert into employees (employee_no, first_name, last_name, join_date)
        select 'BULK-' || g, 'Bulk', 'Person ' || g, '2020-01-01' from generate_series(1, 500) g
        returning id)
      insert into employee_salary (employee_id, effective_from, basic)
      select id, '2020-01-01', 50000 + (random() * 300000)::int from e`;
    await sql`
      insert into employee_tax_profiles (employee_id, table_code, effective_from)
      select id, 'APIT_T1', '2020-01-01' from employees where employee_no like 'BULK-%'`;
    const p = await as(prep).post('/api/v1/payroll/periods', {
      month: NEXT,
      payDate: addDays(`${NEXT}-01`, 27),
    });
    expect(p.status).toBe(201);
    await as(owner).put('/api/v1/settings/payroll.require_locked_attendance', { value: false });
    const started = Date.now();
    const res = await as(prep).post(`/api/v1/payroll/runs/${p.body.data.id}/calculate`);
    const ms = Date.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.data.totals.employees).toBe(502);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
