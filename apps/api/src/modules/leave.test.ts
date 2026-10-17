import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { balanceSchema, leaveRequestSchema, type LeavePolicy, type LeaveType } from '@hr/shared';
import { addDays, weekdayOf } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let hr: string;
let mgr: string;
let staff: string;
let staff2: string;
const ids: Record<string, string> = {};
const types: Record<string, LeaveType> = {};
const policies: Record<string, LeavePolicy> = {};

/** Next year keeps every date in the future (notice rules) and independent of when tests run. */
const Y = new Date().getUTCFullYear() + 1;
/** First Monday on or after a date. */
function monday(from: string) {
  let d = from;
  while (weekdayOf(d) !== 'mon') d = addDays(d, 1);
  return d;
}
const MON = monday(`${Y}-02-01`);
const day = (offset: number) => addDays(MON, offset); // offset 0 = Mon … 4 = Fri

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
});

async function setPolicy(code: string, over: Partial<LeavePolicy> = {}) {
  const p = policies[code]!;
  const res = await as(hr).put(`/api/v1/leave/policies/${p.id}`, {
    leaveTypeId: p.leaveTypeId,
    name: p.name,
    appliesTo: p.appliesTo,
    entitlement: p.entitlement,
    accrual: p.accrual,
    prorationOnJoin: p.prorationOnJoin,
    rounding: p.rounding,
    eligibleAfterMonths: p.eligibleAfterMonths,
    carryForwardMax: p.carryForwardMax,
    carryForwardExpiryMonths: p.carryForwardExpiryMonths,
    encashable: p.encashable,
    effectiveFrom: p.effectiveFrom,
    priority: p.priority,
    isActive: p.isActive,
    ...over,
  });
  expect(res.status).toBe(200);
  policies[code] = res.body.data;
}

async function balance(token: string, code: string, year = Y, employeeId?: string) {
  const q = `/api/v1/leave/balances?year=${year}${employeeId ? `&employeeId=${employeeId}` : ''}`;
  const rows = (await as(token).get(q)).body.data.map((b: unknown) => balanceSchema.parse(b));
  return rows.find((b: { leaveType: { code: string } }) => b.leaveType.code === code)!;
}

const apply = (
  token: string,
  code: string,
  startDate: string,
  endDate = startDate,
  extra: object = {},
) =>
  as(token).post('/api/v1/leave/requests', {
    leaveTypeId: types[code]!.id,
    startDate,
    endDate,
    ...extra,
  });

beforeAll(async () => {
  h = await createHarness('leave', ['a']);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  ids.mgr = await h.createEmployee('a', 'L-MGR');
  ids.staff = await h.createEmployee('a', 'L-STAFF', ids.mgr);
  ids.staff2 = await h.createEmployee('a', 'L-STAFF2', ids.mgr);
  ids.loner = await h.createEmployee('a', 'L-LONER');
  mgr = (await h.createUser('a', { email: 'm@a.lk', roles: ['manager'], employeeId: ids.mgr }))
    .token;
  staff = (await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: ids.staff }))
    .token;
  staff2 = (
    await h.createUser('a', { email: 's2@a.lk', roles: ['employee'], employeeId: ids.staff2 })
  ).token;
  await h.tenants.a!
    .sql`update employees set gender = 'male' where employee_no in ('L-STAFF','L-STAFF2')`;

  for (const t of (await as(hr).get('/api/v1/leave/types')).body.data as LeaveType[])
    types[t.code] = t;
  for (const p of (await as(hr).get('/api/v1/leave/policies')).body.data as LeavePolicy[]) {
    const code = Object.values(types).find((t) => t.id === p.leaveTypeId)!.code;
    policies[code] = p;
  }
});

afterAll(async () => {
  await h?.close();
});

describe('seeded defaults', () => {
  it('seeds the leave types with zero, review-needed policies', () => {
    expect(Object.keys(types).sort()).toEqual([
      'ANNUAL',
      'CASUAL',
      'LIEU',
      'MATERNITY',
      'NOPAY',
      'SHORT',
      'SICK',
    ]);
    expect(policies.ANNUAL).toMatchObject({ entitlement: 0, needsReview: true });
    expect(policies.NOPAY).toMatchObject({ needsReview: false, accrual: 'none' });
  });

  it('applying under a zero policy is refused for lack of balance', async () => {
    const res = await apply(staff, 'ANNUAL', day(0));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Not enough/);
  });
});

describe('apply → manager approves → ledger', () => {
  beforeAll(async () => {
    await setPolicy('ANNUAL', { entitlement: 14 });
    await setPolicy('CASUAL', { entitlement: 7, accrual: 'upfront_yearly' });
  });

  it('accrues the year upfront (employee joined 2020) and HR review clears the flag', async () => {
    const b = await balance(staff, 'ANNUAL');
    expect(b).toMatchObject({ entitled: 14, balance: 14, available: 14, policyNeedsReview: false });
  });

  it('quotes working days with a half-day end, then applies and reserves the days', async () => {
    const q = await as(staff).post('/api/v1/leave/quote', {
      leaveTypeId: types.ANNUAL!.id,
      startDate: day(0),
      endDate: day(2),
      endHalf: 'first',
    });
    expect(q.body.data).toMatchObject({ amount: 2.5, balanceAfter: 11.5 });

    const res = await apply(staff, 'ANNUAL', day(0), day(2), {
      endHalf: 'first',
      reason: 'Family trip',
    });
    expect(res.status).toBe(201);
    const r = leaveRequestSchema.parse(res.body.data);
    expect(r).toMatchObject({ status: 'pending', amount: 2.5, waitingFor: 'manager' });
    expect(await balance(staff, 'ANNUAL')).toMatchObject({
      balance: 14,
      pending: 2.5,
      available: 11.5,
    });
    ids.req1 = r.id;
  });

  it('nobody approves their own leave; only the current approver acts', async () => {
    expect((await as(staff).post(`/api/v1/leave/requests/${ids.req1}/approve`, {})).status).toBe(
      403,
    );
    const other = await h.createUser('a', {
      email: 'om@a.lk',
      roles: ['manager'],
      employeeId: ids.loner,
    });
    expect(
      (await as(other.token).post(`/api/v1/leave/requests/${ids.req1}/approve`, {})).status,
    ).toBe(403);
  });

  it('the manager sees it in their inbox and approves; a taken entry hits the ledger', async () => {
    const inbox = await as(mgr).get('/api/v1/leave/inbox');
    expect(inbox.body.data.map((r: { id: string }) => r.id)).toContain(ids.req1);
    const res = await as(mgr).post(`/api/v1/leave/requests/${ids.req1}/approve`, { note: 'Enjoy' });
    expect(res.body.data.status).toBe('approved');
    expect(await balance(staff, 'ANNUAL')).toMatchObject({ balance: 11.5, taken: 2.5, pending: 0 });
    const ledger = await as(staff).get(
      `/api/v1/leave/ledger?employeeId=${ids.staff}&leaveTypeId=${types.ANNUAL!.id}&year=${Y}`,
    );
    expect(
      ledger.body.data.map((l: { entryType: string; amount: number }) => [l.entryType, l.amount]),
    ).toEqual([
      ['accrual', 14],
      ['taken', -2.5],
    ]);
  });

  it('rejects overlapping leave but allows the other half of a half day', async () => {
    expect((await apply(staff, 'CASUAL', day(1))).status).toBe(400);
    const other = await apply(staff, 'CASUAL', day(2), day(2), {
      startHalf: 'second',
      endHalf: 'second',
    });
    expect(other.status).toBe(201);
    expect(other.body.data.amount).toBe(0.5);
  });

  it('cancelling approved leave writes a reversal and restores the balance', async () => {
    const res = await as(staff).post(`/api/v1/leave/requests/${ids.req1}/cancel`, {
      note: 'Plans changed',
    });
    expect(res.body.data.status).toBe('cancelled');
    expect(await balance(staff, 'ANNUAL')).toMatchObject({ balance: 14, taken: 0 });
  });

  it('an employee without a manager goes straight to HR', async () => {
    const lonerEmp = await h.createEmployee('a', 'L-LONER2');
    const loner = await h.createUser('a', {
      email: 'lo@a.lk',
      roles: ['employee'],
      employeeId: lonerEmp,
    });
    const res = await apply(loner.token, 'ANNUAL', day(7));
    expect(res.body.data.waitingFor).toBe('hr');
    expect(
      (await as(mgr).post(`/api/v1/leave/requests/${res.body.data.id}/approve`, {})).status,
    ).toBe(403);
    expect(
      (await as(hr).post(`/api/v1/leave/requests/${res.body.data.id}/approve`, {})).body.data
        .status,
    ).toBe('approved');
  });

  it('bulk-approves several requests and reports per-request failures', async () => {
    const a = (await apply(staff2, 'ANNUAL', day(14))).body.data.id;
    const b = (await apply(staff2, 'ANNUAL', day(15))).body.data.id;
    const res = await as(mgr).post('/api/v1/leave/requests/bulk-decide', {
      ids: [a, b, ids.req1],
      action: 'approve',
    });
    expect(res.body.data.done.sort()).toEqual([a, b].sort());
    expect(res.body.data.failed.map((f: { id: string }) => f.id)).toEqual([ids.req1]);
  });
});

describe('rules', () => {
  it('enforces gender-restricted types, max consecutive days, notice and attachments', async () => {
    expect((await apply(staff, 'MATERNITY', day(21))).status).toBe(400);

    await as(hr).put(`/api/v1/leave/types/${types.SICK!.id}`, {
      ...types.SICK,
      requiresAttachmentAfterDays: 2,
      maxConsecutiveDays: 3,
      minNoticeDays: 0,
    });
    await setPolicy('SICK', { entitlement: 7 });
    expect((await apply(staff, 'SICK', day(21), day(25))).status).toBe(400); // 5 > 3
    const sick = await apply(staff, 'SICK', day(21), day(23)); // 3 days > 2 → attachment needed
    expect(sick.body.data.attachmentRequired).toBe(true);
    const blocked = await as(mgr).post(`/api/v1/leave/requests/${sick.body.data.id}/approve`, {});
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/supporting document/);
    const up = await request(h.app)
      .put(`/api/v1/leave/requests/${sick.body.data.id}/attachment`)
      .set('host', A)
      .set('authorization', `Bearer ${staff}`)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4'));
    expect(up.body.data.hasAttachment).toBe(true);
    expect(
      (await as(mgr).post(`/api/v1/leave/requests/${sick.body.data.id}/approve`, {})).body.data
        .status,
    ).toBe('approved');

    await as(hr).put(`/api/v1/leave/types/${types.CASUAL!.id}`, {
      ...types.CASUAL,
      minNoticeDays: 300,
    });
    expect((await apply(staff, 'CASUAL', day(28))).body.error.message).toMatch(/notice/);
    await as(hr).put(`/api/v1/leave/types/${types.CASUAL!.id}`, {
      ...types.CASUAL,
      minNoticeDays: 0,
    });
  });

  it('no-pay leave needs no balance; short leave is in hours on one day', async () => {
    expect((await apply(staff, 'NOPAY', day(35), day(39))).status).toBe(201);
    await setPolicy('SHORT', { entitlement: 4, rounding: 'none' });
    const s = await apply(staff, 'SHORT', day(42), day(42), { hours: 1.5 });
    expect(s.body.data).toMatchObject({ amount: 1.5 });
    expect((await apply(staff, 'SHORT', day(43), day(44), { hours: 1 })).status).toBe(400);
  });

  it('leave cannot span two years', async () => {
    expect(
      (await apply(staff, 'ANNUAL', `${Y}-12-30`, `${Y + 1}-01-02`)).body.error.message,
    ).toMatch(/two leave years/);
  });
});

describe('concurrency', () => {
  it('two simultaneous requests cannot overspend the balance', async () => {
    const emp = await h.createEmployee('a', 'L-RACE', ids.mgr);
    const u = await h.createUser('a', { email: 'race@a.lk', roles: ['employee'], employeeId: emp });
    await as(hr).post('/api/v1/leave/adjustments', {
      employeeId: emp,
      leaveTypeId: types.LIEU!.id,
      year: Y,
      amount: 3,
      note: 'Worked on Poya',
    });
    // Two 2-day requests against a 3-day balance, at the same time: exactly one may succeed.
    const [r1, r2] = await Promise.all([
      apply(u.token, 'LIEU', day(49), day(50)),
      apply(u.token, 'LIEU', day(56), day(57)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 400]);
    expect(await balance(u.token, 'LIEU')).toMatchObject({ balance: 3, pending: 2, available: 1 });
  });
});

describe('year-end carry forward and expiry', () => {
  const Y0 = Y - 1;

  it('previews, then carries forward up to the cap exactly once', async () => {
    await setPolicy('CASUAL', { entitlement: 7, carryForwardMax: 3, carryForwardExpiryMonths: 3 });
    const emp = await h.createEmployee('a', 'L-YE', ids.mgr);
    ids.ye = emp;
    const imp = await as(hr).post('/api/v1/imports/leave-balances/commit', {
      rows: [
        {
          line: 2,
          values: { employeeNo: 'L-YE', leaveTypeCode: 'casual', year: String(Y0), amount: '5' },
        },
      ],
    });
    expect(imp.body.data.imported).toBe(1);

    const preview = await as(hr).post('/api/v1/leave/year-end', { fromYear: Y0, dryRun: true });
    const row = preview.body.data.rows.find(
      (r: { employeeNo: string; leaveTypeCode: string }) =>
        r.employeeNo === 'L-YE' && r.leaveTypeCode === 'CASUAL',
    );
    expect(row).toMatchObject({ carryForward: 3, lapsed: 2 });

    expect(
      (await as(hr).post('/api/v1/leave/year-end', { fromYear: Y0, dryRun: false })).status,
    ).toBe(200);
    expect(
      (await as(hr).post('/api/v1/leave/year-end', { fromYear: Y0, dryRun: false })).status,
    ).toBe(409);

    const b = await balance(hr, 'CASUAL', Y, emp);
    expect(b.balance).toBe(7 + 3); // new year's entitlement + carried
  });

  it('carried days are used first and the unused carry expires after 3 months', async () => {
    const u = await h.createUser('a', {
      email: 'ye@a.lk',
      roles: ['employee'],
      employeeId: ids.ye,
    });
    const jan = monday(`${Y}-01-05`);
    const r = await apply(u.token, 'CASUAL', jan, addDays(jan, 1)); // 2 days before the April expiry
    await as(mgr).post(`/api/v1/leave/requests/${r.body.data.id}/approve`, {});
    // Quoting leave after expiry materialises the expiry: carried 3 − used 2 = 1 expires.
    const may = monday(`${Y}-05-04`);
    const q = await as(u.token).post('/api/v1/leave/quote', {
      leaveTypeId: types.CASUAL!.id,
      startDate: may,
      endDate: may,
    });
    expect(q.body.data.balanceAfter).toBe(10 - 2 - 1 - 1);
    const ledger = await as(hr).get(
      `/api/v1/leave/ledger?employeeId=${ids.ye}&leaveTypeId=${types.CASUAL!.id}&year=${Y}`,
    );
    expect(
      ledger.body.data.find((l: { entryType: string }) => l.entryType === 'expiry'),
    ).toMatchObject({ amount: -1, effectiveDate: `${Y}-04-01` });
  });

  it('opening balances cannot be imported twice', async () => {
    const res = await as(hr).post('/api/v1/imports/leave-balances/preview', {
      rows: [
        {
          line: 2,
          values: { employeeNo: 'L-YE', leaveTypeCode: 'CASUAL', year: String(Y0), amount: '1' },
        },
      ],
    });
    expect(res.body.data.errors[0].message).toMatch(/already imported/);
  });
});

describe('visibility', () => {
  it('a manager sees team leave on the calendar; an employee only their own requests', async () => {
    const month = MON.slice(0, 7);
    const cal = await as(mgr).get(`/api/v1/leave/calendar?month=${month}`);
    expect(cal.body.data.entries.length).toBeGreaterThan(0);
    const mine = await as(staff2).get('/api/v1/leave/requests');
    expect(new Set(mine.body.data.map((r: { employeeId: string }) => r.employeeId))).toEqual(
      new Set([ids.staff2]),
    );
    expect((await as(staff).get(`/api/v1/leave/balances?employeeId=${ids.staff2}`)).status).toBe(
      404,
    );
  });

  it('balance report for HR covers everyone; employees cannot run it', async () => {
    const rep = await as(hr).get(`/api/v1/leave/report/balances?year=${Y}`);
    expect(rep.body.data.rows.length).toBeGreaterThanOrEqual(4);
    expect((await as(staff).get(`/api/v1/leave/report/balances?year=${Y}`)).status).toBe(403);
  });
});
