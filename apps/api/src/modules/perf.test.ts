import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect } from '@hr/db';
import { seedDemo } from '@hr/db/demo';
import { addDays, today as todayIn } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

/**
 * PLAN.md Phase 10 performance target: 1,000 employees × 12 months, p95 < 300 ms for lists.
 * The full-size run is opt-in (PERF=1) because seeding ~500k punches takes a while; without it a
 * small company is seeded so the demo generator and the list endpoints are always exercised.
 */
const FULL = process.env.PERF === '1';
const EMPLOYEES = FULL ? 1000 : 40;
const MONTHS = FULL ? 12 : 1;
const RUNS = FULL ? 30 : 5;

let h: Harness;
let hr: string;
const A = 'a.localhost';
const T = todayIn('Asia/Colombo');
const results: { endpoint: string; p50: number; p95: number }[] = [];

beforeAll(async () => {
  h = await createHarness('perf', ['a']);
  const sql = connect(h.tenants.a!.dbUrl, { max: 2 });
  const started = Date.now();
  const summary = await seedDemo(sql, { employees: EMPLOYEES, months: MONTHS, today: T });
  await sql.end();
  console.log(`seeded ${JSON.stringify(summary)} in ${Date.now() - started} ms`);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['owner'] })).token;
}, 30 * 60_000);

afterAll(async () => {
  if (results.length) console.table(results);
  await h?.close();
});

async function measure(endpoint: string) {
  const get = () =>
    request(h.app).get(endpoint).set('host', A).set('authorization', `Bearer ${hr}`);
  const first = await get(); // warm-up (also processes attendance for the day/month)
  expect(first.status, endpoint).toBe(200);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const res = await get();
    times.push(performance.now() - t);
    expect(res.status).toBe(200);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) =>
    Math.round(times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)]!);
  results.push({ endpoint, p50: p(0.5), p95: p(0.95) });
  return p(0.95);
}

describe(`list endpoints with ${EMPLOYEES} employees × ${MONTHS} month(s)`, () => {
  const yesterday = addDays(T, -1);
  const lists = [
    '/api/v1/employees?pageSize=25',
    '/api/v1/employees?pageSize=25&q=perera',
    '/api/v1/leave/requests',
    '/api/v1/attendance/regularizations',
    `/api/v1/attendance/days?date=${yesterday}`,
    '/api/v1/notifications',
    '/api/v1/audit-log?limit=50',
  ];
  it.each(lists)(
    '%s p95 < 300 ms',
    async (endpoint) => {
      const p95 = await measure(endpoint);
      if (FULL) expect(p95).toBeLessThan(300);
    },
    120_000,
  );

  it('the demo company is realistic: dashboard and reports work', async () => {
    const d = (
      await request(h.app)
        .get('/api/v1/dashboard/hr')
        .set('host', A)
        .set('authorization', `Bearer ${hr}`)
    ).body.data;
    expect(d.headcount.total).toBeGreaterThan(EMPLOYEES * 0.9);
    expect(d.headcount.byDepartment.length).toBe(6);
    const r = await request(h.app)
      .get('/api/v1/reports/employee-master')
      .set('host', A)
      .set('authorization', `Bearer ${hr}`);
    expect(r.body.data.rows.length).toBe(EMPLOYEES);
  }, 120_000);
});
