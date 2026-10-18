import type { Sql } from 'postgres';

import { addDays, eachDay, weekdayOf, zonedInstant } from '@hr/shared/time';

/**
 * Realistic demo data for a sales/demo tenant and for performance tests (PLAN.md Phase 10).
 * Deterministic (seeded PRNG): the same options always produce the same company. Works on an
 * already-migrated and seeded tenant database. Holidays are NOT generated (gazetted dates are
 * never guessed), and payroll runs are left for the demo itself (open a month → Calculate).
 */
export interface DemoOptions {
  employees: number;
  /** Months of attendance history (punches) to generate, ending yesterday. */
  months: number;
  today: string;
  tz?: string;
  seed?: number;
  /** Allow running on a tenant that already has employees (adds DEMO-numbered staff). */
  force?: boolean;
  log?: (msg: string) => void;
}

export interface DemoSummary {
  employees: number;
  punches: number;
  leaveRequests: number;
  salaries: number;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE = [
  'Kasun',
  'Nuwan',
  'Chamara',
  'Tharindu',
  'Dinesh',
  'Ruwan',
  'Sanjeewa',
  'Lahiru',
  'Isuru',
  'Mohamed',
  'Rizwan',
  'Suresh',
  'Prakash',
  'Arjun',
  'Dilshan',
  'Pradeep',
  'Ashan',
  'Hasitha',
  'Janaka',
  'Roshan',
];
const FEMALE = [
  'Nimali',
  'Dilini',
  'Sanduni',
  'Thilini',
  'Ishara',
  'Kavindi',
  'Hiruni',
  'Fathima',
  'Ayesha',
  'Priya',
  'Kavitha',
  'Malsha',
  'Nadeesha',
  'Chathurika',
  'Hasini',
  'Sewwandi',
  'Anjali',
  'Gayani',
  'Rashmi',
  'Shalini',
];
const LAST = [
  'Perera',
  'Fernando',
  'Silva',
  'Jayasuriya',
  'Bandara',
  'Wickramasinghe',
  'Dissanayake',
  'Rajapaksha',
  'Gunawardena',
  'Herath',
  'Kumara',
  'Ratnayake',
  'Senanayake',
  'Abeysekera',
  'Karunaratne',
  'Rizvi',
  'Nadarajah',
  'Sivakumar',
  'Mendis',
  'Weerasinghe',
];

const DEPARTMENTS: [string, string, string[]][] = [
  ['FIN', 'Finance', ['Accountant', 'Accounts Executive', 'Finance Manager']],
  ['HR', 'Human Resources', ['HR Executive', 'HR Manager']],
  ['OPS', 'Operations', ['Operations Executive', 'Supervisor', 'Operations Manager']],
  ['SAL', 'Sales', ['Sales Executive', 'Area Sales Manager', 'Sales Manager']],
  ['IT', 'Information Technology', ['Software Engineer', 'IT Support Officer', 'IT Manager']],
  ['PRD', 'Production', ['Machine Operator', 'Production Supervisor', 'Production Manager']],
];
const BANKS = [
  ['Bank of Ceylon', '7010'],
  ["People's Bank", '7135'],
  ['Commercial Bank', '7056'],
  ['Hatton National Bank', '7083'],
  ['Sampath Bank', '7278'],
] as const;

export async function seedDemo(sql: Sql, o: DemoOptions): Promise<DemoSummary> {
  const rand = prng(o.seed ?? 20261018);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const tz = o.tz ?? 'Asia/Colombo';
  const log = o.log ?? (() => {});

  const [{ n: existing } = { n: 0 }] = await sql<
    { n: number }[]
  >`select count(*)::int as n from employees`;
  if (existing > 0 && !o.force)
    throw new Error(
      `This tenant already has ${existing} employees. Use --force to add demo staff anyway.`,
    );

  // ── Organisation ──────────────────────────────────────────────────────────
  const [cal] = await sql<{ id: string }[]>`select id from work_calendars where is_default limit 1`;
  if (!cal) throw new Error('No default work calendar (run the tenant seeds first)');
  await sql`
    insert into branches (code, name, calendar_id, geo_lat, geo_lng, geo_radius_m, address)
    values ('HQ', 'Colombo Head Office', ${cal.id}, 6.927100, 79.861200, 200, ${sql.json({ city: 'Colombo 03' })}),
           ('KDY', 'Kandy Branch', ${cal.id}, 7.290600, 80.633700, 200, ${sql.json({ city: 'Kandy' })})
    on conflict (code) do nothing`;
  const branchIds = (
    await sql<{ id: string }[]>`select id from branches where code in ('HQ','KDY') order by code`
  ).map((r) => r.id);
  for (let g = 1; g <= 5; g++)
    await sql`insert into grades (code, name, rank) values (${`G${g}`}, ${`Grade ${g}`}, ${g}) on conflict (code) do nothing`;
  const grades = await sql<
    { id: string; rank: number }[]
  >`select id, rank from grades where code like 'G_' order by rank`;
  const depts: {
    id: string;
    code: string;
    designations: { id: string; title: string }[];
    cc: string;
  }[] = [];
  for (const [code, name, titles] of DEPARTMENTS) {
    await sql`insert into departments (code, name) values (${code}, ${name}) on conflict (code) do nothing`;
    await sql`insert into cost_centers (code, name) values (${code}, ${name}) on conflict (code) do nothing`;
    const [d] = await sql<{ id: string }[]>`select id from departments where code = ${code}`;
    const [cc] = await sql<{ id: string }[]>`select id from cost_centers where code = ${code}`;
    const designations = [];
    for (const title of titles) {
      await sql`insert into designations (title) values (${title}) on conflict (title) do nothing`;
      const [x] = await sql<{ id: string }[]>`select id from designations where title = ${title}`;
      designations.push({ id: x!.id, title });
    }
    depts.push({ id: d!.id, code, designations, cc: cc!.id });
  }

  // ── Employees ─────────────────────────────────────────────────────────────
  const [{ n: offset } = { n: 0 }] = await sql<
    { n: number }[]
  >`select count(*)::int as n from employees where employee_no like 'DEMO-%'`;
  interface Person {
    no: string;
    first: string;
    last: string;
    gender: 'male' | 'female';
    dob: string;
    join: string;
    exit: string | null;
    status: string;
    probationEnd: string | null;
    dept: (typeof depts)[number];
    designation: string;
    grade: { id: string; rank: number };
    branch: string;
    managerIdx: number | null;
  }
  const people: Person[] = [];
  for (let i = 0; i < o.employees; i++) {
    const gender = rand() < 0.45 ? 'female' : 'male';
    const dept = i === 0 ? depts[0]! : depts[i % depts.length]!;
    const isHead = i > 0 && i <= depts.length;
    const join = i === 0 ? addDays(o.today, -6 * 365) : addDays(o.today, -int(30, 6 * 365));
    const recent = join > addDays(o.today, -180);
    const exited = !isHead && i > depts.length && rand() < 0.04;
    const exit = exited ? addDays(o.today, -int(10, 300)) : null;
    const rank = i === 0 ? 5 : isHead ? 4 : int(1, 3);
    people.push({
      no: `DEMO-${String(offset + i + 1).padStart(4, '0')}`,
      first: pick(gender === 'female' ? FEMALE : MALE),
      last: pick(LAST),
      gender,
      dob: addDays(o.today, -int(22 * 365, 55 * 365)),
      join: exit && exit <= join ? addDays(exit, -400) : join,
      exit,
      status: exit ? 'resigned' : recent ? 'on_probation' : 'active',
      probationEnd: recent && !exit ? addDays(join, 180) : null,
      dept,
      designation:
        dept.designations[
          Math.min(
            dept.designations.length - 1,
            isHead || i === 0 ? dept.designations.length - 1 : rand() < 0.8 ? 0 : 1,
          )
        ]!.id,
      grade: grades[rank - 1]!,
      branch: rand() < 0.75 ? branchIds[0]! : branchIds[1]!,
      managerIdx: i === 0 ? null : isHead ? 0 : 1 + (i % depts.length),
    });
  }
  const ids: string[] = [];
  for (let c = 0; c < people.length; c += 500) {
    const chunk = people.slice(c, c + 500);
    const rows = chunk.map((p, k) => {
      const year = Number(p.dob.slice(0, 4));
      const doy = Math.floor((Date.parse(p.dob) - Date.parse(`${year}-01-01`)) / 86_400_000) + 1;
      const bank = BANKS[(c + k) % BANKS.length]!;
      return {
        employee_no: p.no,
        first_name: p.first,
        last_name: p.last,
        gender: p.gender,
        dob: p.dob,
        nic: `${year}${String(doy + (p.gender === 'female' ? 500 : 0)).padStart(3, '0')}${String(1000 + ((offset + c + k) % 9000)).padStart(4, '0')}0`,
        work_email:
          `${p.first}.${p.last}.${p.no}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@demo.example',
        mobile: `+9477${String(1000000 + Math.floor(rand() * 8999999))}`,
        branch_id: p.branch,
        department_id: p.dept.id,
        designation_id: p.designation,
        grade_id: p.grade.id,
        cost_center_id: p.dept.cc,
        employment_type: p.probationEnd ? 'probation' : 'permanent',
        status: p.status,
        join_date: p.join,
        probation_end_date: p.probationEnd,
        exit_date: p.exit,
        bank_name: bank[0],
        bank_branch: 'Main',
        bank_account_no: String(10_000_000 + Math.floor(rand() * 89_999_999)),
        bank_account_name: `${p.first} ${p.last}`.toUpperCase(),
        epf_no: String(offset + c + k + 1),
      };
    });
    const out = await sql<{ id: string }[]>`insert into employees ${sql(rows)} returning id`;
    ids.push(...out.map((r) => r.id));
  }
  // Managers, then job history mirroring the projection.
  for (let i = 0; i < people.length; i++) {
    const m = people[i]!.managerIdx;
    if (m !== null)
      await sql`update employees set reports_to_id = ${ids[m]!} where id = ${ids[i]!}`;
  }
  for (let d = 0; d < depts.length; d++)
    if (ids[d + 1])
      await sql`update departments set head_employee_id = ${ids[d + 1]!} where id = ${depts[d]!.id} and head_employee_id is null`;
  const history = people.map((p, i) => ({
    employee_id: ids[i]!,
    effective_from: p.join,
    effective_to: p.exit,
    branch_id: p.branch,
    department_id: p.dept.id,
    designation_id: p.designation,
    grade_id: p.grade.id,
    cost_center_id: p.dept.cc,
    reports_to_id: p.managerIdx === null ? null : ids[p.managerIdx]!,
    employment_type: p.probationEnd ? 'probation' : 'permanent',
    reason: 'hire',
  }));
  for (let c = 0; c < history.length; c += 500)
    await sql`insert into employee_job_history ${sql(history.slice(c, c + 500))}`;
  log(`employees: ${people.length}`);

  // ── Shifts, pay setup ─────────────────────────────────────────────────────
  const [shift] = await sql<{ id: string }[]>`select id from shifts where code = 'GENERAL'`;
  if (shift)
    for (let c = 0; c < ids.length; c += 500)
      await sql`insert into shift_assignments ${sql(
        people.slice(c, c + 500).map((p, k) => ({
          employee_id: ids[c + k]!,
          shift_id: shift.id,
          effective_from: p.join,
        })),
      )} on conflict do nothing`;

  const basicFor = (rank: number) =>
    [0, 65000, 95000, 140000, 260000, 450000][rank]! + int(0, 20) * 1000;
  const salaries = people.map((p, i) => ({
    employee_id: ids[i]!,
    effective_from: p.join,
    basic: String(basicFor(p.grade.rank)),
    ot_eligible: p.grade.rank <= 2,
  }));
  for (let c = 0; c < salaries.length; c += 500)
    await sql`insert into employee_salary ${sql(salaries.slice(c, c + 500))}`;
  const [relief] = await sql<
    { id: string }[]
  >`select id from pay_components where code = 'BUDGETARY_RELIEF'`;
  if (relief) {
    const rows = salaries
      .filter((s) => Number(s.basic) < 150000)
      .map((s) => ({
        employee_id: s.employee_id,
        component_id: relief.id,
        amount: '3500',
        effective_from: s.effective_from,
      }));
    for (let c = 0; c < rows.length; c += 500)
      await sql`insert into employee_pay_components ${sql(rows.slice(c, c + 500))}`;
  }
  const taxRows = people.map((p, i) => ({
    employee_id: ids[i]!,
    table_code: 'APIT_T1',
    effective_from: p.join,
  }));
  for (let c = 0; c < taxRows.length; c += 500)
    await sql`insert into employee_tax_profiles ${sql(taxRows.slice(c, c + 500))} on conflict do nothing`;
  const codes = people.map((_, i) => ({
    employee_id: ids[i]!,
    bank_code: BANKS[i % BANKS.length]![1],
    branch_code: '001',
  }));
  for (let c = 0; c < codes.length; c += 500)
    await sql`insert into employee_bank_codes ${sql(codes.slice(c, c + 500))} on conflict do nothing`;

  // ── Leave: demo entitlements, some approved past leave ────────────────────
  for (const [code, days] of [
    ['ANNUAL', 14],
    ['CASUAL', 7],
    ['SICK', 7],
  ] as const)
    await sql`
      update leave_policies set entitlement = ${days}, needs_review = false,
        name = ${`${code.charAt(0)}${code.slice(1).toLowerCase()} leave — demo values`}
      where needs_review and leave_type_id = (select id from leave_types where code = ${code})`;
  const types = await sql<
    { id: string; code: string }[]
  >`select id, code from leave_types where code in ('ANNUAL','CASUAL','SICK')`;
  const from = addDays(o.today, -Math.round(o.months * 30.4));
  const yesterday = addDays(o.today, -1);
  const workdays = eachDay(from, yesterday).filter((d) => !['sat', 'sun'].includes(weekdayOf(d)));
  const onLeave = new Set<string>();
  let leaveCount = 0;
  for (let i = 0; i < people.length; i++) {
    const p = people[i]!;
    const mine = workdays.filter((d) => d >= p.join && (!p.exit || d <= p.exit));
    const n = Math.min(mine.length, int(0, Math.max(1, Math.round(o.months / 2))));
    for (let k = 0; k < n; k++) {
      const date = pick(mine);
      if (onLeave.has(`${i}:${date}`)) continue;
      onLeave.add(`${i}:${date}`);
      const t = pick(types);
      const year = Number(date.slice(0, 4));
      const [r] = await sql<{ id: string }[]>`
        insert into leave_requests (employee_id, leave_type_id, period_year, start_date, end_date, amount, status, reason, decided_at)
        values (${ids[i]!}, ${t.id}, ${year}, ${date}, ${date}, 1, 'approved', 'Personal', now())
        returning id`;
      await sql`insert into leave_request_days (request_id, date, portion) values (${r!.id}, ${date}, 1)`;
      await sql`
        insert into leave_ledger (employee_id, leave_type_id, period_year, entry_type, amount, idempotency_key, ref_type, ref_id, effective_date)
        values (${ids[i]!}, ${t.id}, ${year}, 'taken', -1, ${`taken:${r!.id}`}, 'leave_request', ${r!.id}, ${date})`;
      leaveCount++;
    }
  }

  // ── Attendance punches (fingerprint device) ───────────────────────────────
  let punches = 0;
  let batch: { employee_id: string; at: Date; source: string; device_id: string }[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await sql`insert into attendance_punches ${sql(batch)} on conflict do nothing`;
    punches += batch.length;
    batch = [];
  };
  const hhmm = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  for (let i = 0; i < people.length; i++) {
    const p = people[i]!;
    for (const d of workdays) {
      if (d < p.join || (p.exit && d > p.exit) || onLeave.has(`${i}:${d}`)) continue;
      const r = rand();
      if (r < 0.03) continue; // absent
      const inMin = 8 * 60 + (r < 0.12 ? int(41, 75) : int(5, 38));
      batch.push({
        employee_id: ids[i]!,
        at: zonedInstant(d, hhmm(inMin), tz),
        source: 'device',
        device_id: 'ZK-DEMO',
      });
      if (rand() < 0.01) continue; // forgot to punch out
      const outMin = 17 * 60 + (p.grade.rank <= 2 && rand() < 0.25 ? int(35, 150) : int(0, 25));
      batch.push({
        employee_id: ids[i]!,
        at: zonedInstant(d, hhmm(outMin), tz),
        source: 'device',
        device_id: 'ZK-DEMO',
      });
      if (batch.length >= 5000) await flush();
    }
  }
  await flush();
  log(`punches: ${punches}, leave requests: ${leaveCount}`);
  return {
    employees: people.length,
    punches,
    leaveRequests: leaveCount,
    salaries: salaries.length,
  };
}
