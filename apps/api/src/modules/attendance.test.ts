import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attendanceDaySchema, type AttendanceDay, type LeaveType, type Shift } from '@hr/shared';
import { addDays, today as todayIn, weekdayOf, zonedInstant } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
const TZ = 'Asia/Colombo';
let hr: string;
let mgr: string;
let staff: string;
let staff2: string;
let outsider: string;
const ids = {} as Record<'mgr' | 'staff' | 'staff2' | 'loner' | 'reg' | 'branch', string>;
const shifts: Record<string, Shift> = {};

/** A fully finished month two months back (lockable), and its first Monday. */
const T = todayIn(TZ);
const [ty, tm] = T.split('-').map(Number) as [number, number];
const mIdx = ty * 12 + (tm - 1) - 2;
const MONTH = `${Math.floor(mIdx / 12)}-${String((mIdx % 12) + 1).padStart(2, '0')}`;
let MON = `${MONTH}-01`;
while (weekdayOf(MON) !== 'mon') MON = addDays(MON, 1);
const day = (offset: number) => addDays(MON, offset);
const iso = (date: string, time: string) => zonedInstant(date, time, TZ).toISOString();

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
});

const SHIFT_BASE = {
  isNightShift: false,
  breakMinutes: 60,
  breakAfterMinutes: 300,
  graceLateMinutes: 10,
  earlyLeaveGraceMinutes: 5,
  halfDayThresholdMinutes: 240,
  otAfterMinutes: 30,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  color: '#0ea5e9',
};

async function monthDays(token: string, employeeId: string): Promise<Map<string, AttendanceDay>> {
  const res = await as(token).get(
    `/api/v1/attendance/days?month=${MONTH}&employeeId=${employeeId}`,
  );
  expect(res.status).toBe(200);
  return new Map(
    res.body.data.map((d: unknown) => {
      const x = attendanceDaySchema.parse(d);
      return [x.date, x];
    }),
  );
}

beforeAll(async () => {
  h = await createHarness('attendance', ['a']);
  hr = (await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] })).token;
  ids.mgr = await h.createEmployee('a', 'A-MGR');
  ids.staff = await h.createEmployee('a', 'A-STAFF', ids.mgr);
  ids.staff2 = await h.createEmployee('a', 'A-STAFF2', ids.mgr);
  ids.loner = await h.createEmployee('a', 'A-LONER');
  mgr = (await h.createUser('a', { email: 'm@a.lk', roles: ['manager'], employeeId: ids.mgr }))
    .token;
  staff = (await h.createUser('a', { email: 's@a.lk', roles: ['employee'], employeeId: ids.staff }))
    .token;
  staff2 = (
    await h.createUser('a', { email: 's2@a.lk', roles: ['employee'], employeeId: ids.staff2 })
  ).token;
  outsider = (
    await h.createUser('a', { email: 'o@a.lk', roles: ['manager'], employeeId: ids.loner })
  ).token;
});

afterAll(async () => {
  await h?.close();
});

describe('shifts and assignments', () => {
  it('seeds one example shift flagged for review', async () => {
    const res = await as(staff).get('/api/v1/attendance/shifts');
    expect(res.body.data).toEqual([
      expect.objectContaining({ code: 'GENERAL', needsReview: true, startTime: '08:30' }),
    ]);
  });

  it('validates shifts: next-day end must be a night shift; windows must fit in 24 h', async () => {
    const bad1 = await as(hr).post('/api/v1/attendance/shifts', {
      ...SHIFT_BASE,
      code: 'X',
      name: 'X',
      startTime: '22:00',
      endTime: '06:00',
    });
    expect(bad1.status).toBe(400);
    const bad2 = await as(hr).post('/api/v1/attendance/shifts', {
      ...SHIFT_BASE,
      code: 'Y',
      name: 'Y',
      startTime: '08:00',
      endTime: '17:00',
      windowBeforeMinutes: 600,
      windowAfterMinutes: 600,
    });
    expect(bad2.status).toBe(400);
    expect(
      (
        await as(staff).post('/api/v1/attendance/shifts', {
          ...SHIFT_BASE,
          code: 'Z',
          name: 'Z',
          startTime: '08:00',
          endTime: '17:00',
        })
      ).status,
    ).toBe(403);
  });

  it('creates a day and a night shift and assigns them', async () => {
    for (const s of [
      { code: 'day', name: 'Day', startTime: '08:30', endTime: '17:00' },
      {
        code: 'night',
        name: 'Night',
        startTime: '22:00',
        endTime: '06:00',
        isNightShift: true,
        breakMinutes: 30,
      },
    ]) {
      const res = await as(hr).post('/api/v1/attendance/shifts', { ...SHIFT_BASE, ...s });
      expect(res.status).toBe(201);
      shifts[res.body.data.code] = res.body.data;
    }
    expect(shifts.DAY!.needsReview).toBe(false);
    const a1 = await as(hr).post('/api/v1/attendance/assignments', {
      employeeIds: [ids.staff, ids.mgr, ids.loner],
      shiftId: shifts.DAY!.id,
      effectiveFrom: '2020-01-01',
    });
    expect(a1.status).toBe(201);
    const a2 = await as(hr).post('/api/v1/attendance/assignments', {
      employeeIds: [ids.staff2],
      shiftId: shifts.NIGHT!.id,
      effectiveFrom: '2020-01-01',
    });
    expect(a2.status).toBe(201);
  });

  it('a later assignment closes the earlier one the day before (gap-free)', async () => {
    await as(hr).post('/api/v1/attendance/assignments', {
      employeeIds: [ids.loner],
      shiftId: shifts.NIGHT!.id,
      effectiveFrom: day(14),
    });
    const res = await as(hr).get(`/api/v1/attendance/assignments?employeeId=${ids.loner}`);
    expect(
      res.body.data.map((a: { shiftCode: string; effectiveFrom: string; effectiveTo: string }) => [
        a.shiftCode,
        a.effectiveFrom,
        a.effectiveTo,
      ]),
    ).toEqual([
      ['NIGHT', day(14), null],
      ['DAY', '2020-01-01', day(13)],
    ]);
  });

  it('roster overrides the assignment for a date (rest day or another shift)', async () => {
    const res = await as(hr).put('/api/v1/attendance/roster', {
      entries: [
        { employeeId: ids.loner, date: day(0), shiftId: null },
        { employeeId: ids.loner, date: day(5), shiftId: shifts.DAY!.id }, // Saturday
      ],
    });
    expect(res.status).toBe(200);
    const week = await as(hr).get(`/api/v1/attendance/roster?weekStart=${day(0)}`);
    const row = week.body.data.rows.find((r: { employeeId: string }) => r.employeeId === ids.loner);
    expect(row.cells[0]).toEqual({ date: day(0), shiftId: null, source: 'roster' });
    expect(row.cells[1]).toMatchObject({ shiftId: shifts.DAY!.id, source: 'assignment' });
    expect(row.cells[5]).toMatchObject({ shiftId: shifts.DAY!.id, source: 'roster' });
    const days = await monthDays(hr, ids.loner);
    expect(days.get(day(0))).toMatchObject({ dayType: 'weekend', expected: 0, status: 'weekend' });
    expect(days.get(day(5))).toMatchObject({ dayType: 'workday', expected: 1, status: 'absent' });
    // Clear the override again.
    await as(hr).put('/api/v1/attendance/roster', {
      entries: [{ employeeId: ids.loner, date: day(0), shiftId: 'clear' }],
    });
    expect((await monthDays(hr, ids.loner)).get(day(0))?.status).toBe('absent');
  });
});

describe('device import → computed days', () => {
  const file = () => ({
    rows: [
      { line: 2, values: { deviceUserId: '101', timestamp: `${day(0)} 08:25:00` } },
      { line: 3, values: { deviceUserId: '101', timestamp: `${day(0)} 17:05:00` } },
      { line: 4, values: { deviceUserId: '101', timestamp: `${day(1)} 08:45:00` } },
      { line: 5, values: { deviceUserId: '101', timestamp: `${day(1)} 19:00:00` } },
      { line: 6, values: { deviceUserId: '101', timestamp: `${day(2)} 08:30:00` } },
      { line: 7, values: { employeeNo: 'A-STAFF2', date: day(0), time: '21:55' } },
      { line: 8, values: { employeeNo: 'A-STAFF2', date: day(1), time: '07:00 AM' } },
    ],
  });

  it('maps device users, previews errors per line, then imports', async () => {
    const map = await as(hr).post('/api/v1/imports/attendance-device-users/commit', {
      rows: [{ line: 2, values: { deviceUserId: '101', employeeNo: 'A-STAFF' } }],
    });
    expect(map.body.data.imported).toBe(1);

    const preview = await as(hr).post('/api/v1/imports/attendance-punches/preview', {
      rows: [
        ...file().rows,
        { line: 9, values: { deviceUserId: '999', timestamp: `${day(0)} 08:00` } },
        { line: 10, values: { deviceUserId: '101', timestamp: '31/02/2026 08:00' } },
        { line: 11, values: { deviceUserId: '101', timestamp: `${day(0)} 08:25:00` } },
      ],
    });
    expect(preview.body.data.valid).toBe(7);
    expect(preview.body.data.errors.map((e: { line: number }) => e.line)).toEqual([9, 10, 11]);

    const res = await as(hr).post('/api/v1/imports/attendance-punches/commit', file());
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(7);
  });

  it('re-importing the same file adds nothing', async () => {
    const res = await as(hr).post('/api/v1/imports/attendance-punches/commit', file());
    expect(res.body.data.imported).toBe(0);
  });

  it('computes present / late + OT / incomplete / absent for a day shift', async () => {
    const d = await monthDays(hr, ids.staff);
    expect(d.get(day(0))).toMatchObject({
      status: 'present',
      workedMinutes: 520 - 60,
      lateMinutes: 0,
      otMinutes: 0,
      shift: expect.objectContaining({ code: 'DAY' }),
    });
    expect(d.get(day(1))).toMatchObject({ status: 'present', lateMinutes: 15, otMinutes: 120 });
    expect(d.get(day(2))).toMatchObject({ status: 'incomplete' });
    expect(d.get(day(3))).toMatchObject({ status: 'absent', absentPortion: 1 });
    expect(d.get(day(5))).toMatchObject({ status: 'weekend', dayType: 'weekend' });
  });

  it('night shift crossing midnight is one day with OT', async () => {
    const d = await monthDays(hr, ids.staff2);
    expect(d.get(day(0))).toMatchObject({
      status: 'present',
      workedMinutes: 545 - 30,
      otMinutes: 60,
      firstIn: iso(day(0), '21:55'),
      lastOut: iso(day(1), '07:00'),
    });
    expect(d.get(day(1))?.firstIn).toBeNull();
  });

  it('reprocessing is idempotent', async () => {
    const snap = async () =>
      (
        await h.tenants.a!.sql`
        select id, employee_id, date, status, worked_minutes, late_minutes, ot_minutes, first_in, last_out, absent_portion
        from attendance_days order by employee_id, date`
      ).map((r) => ({ ...r }));
    const before = await snap();
    for (let i = 0; i < 2; i++) {
      const res = await as(hr).post('/api/v1/attendance/process', {
        from: `${MONTH}-01`,
        to: addDays(MON, 27),
      });
      expect(res.status).toBe(200);
    }
    expect(await snap()).toEqual(before);
  });
});

describe('scope (IDOR)', () => {
  it('employees see only themselves; managers only their team', async () => {
    expect(
      (await as(staff2).get(`/api/v1/attendance/days?month=${MONTH}&employeeId=${ids.staff}`))
        .status,
    ).toBe(404);
    expect(
      (await as(outsider).get(`/api/v1/attendance/days?month=${MONTH}&employeeId=${ids.staff}`))
        .status,
    ).toBe(404);
    expect(
      (await as(mgr).get(`/api/v1/attendance/days?month=${MONTH}&employeeId=${ids.staff}`)).status,
    ).toBe(200);
    expect(
      (
        await as(staff2).get(
          `/api/v1/attendance/punches?employeeId=${ids.staff}&from=${day(0)}&to=${day(1)}`,
        )
      ).status,
    ).toBe(404);
    const board = await as(mgr).get(`/api/v1/attendance/days?date=${day(0)}`);
    const people = new Set(board.body.data.map((d: AttendanceDay) => d.employeeId));
    expect(people).toEqual(new Set([ids.mgr, ids.staff, ids.staff2]));
    const own = await as(staff).get(`/api/v1/attendance/days?date=${day(0)}`);
    expect(own.body.data.map((d: AttendanceDay) => d.employeeId)).toEqual([ids.staff]);
  });

  it('employees cannot run the board summary or manage shifts', async () => {
    expect((await as(staff).get(`/api/v1/attendance/summary?month=${MONTH}`)).status).toBe(403);
    expect(
      (await as(mgr).post('/api/v1/attendance/process', { from: day(0), to: day(0) })).status,
    ).toBe(403);
  });
});

describe('regularisation', () => {
  it('fixes a missing out punch through manager approval', async () => {
    const res = await as(staff).post('/api/v1/attendance/regularizations', {
      date: day(2),
      requestedOut: '17:10',
      reason: 'Forgot to punch out',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', waitingFor: 'manager' });
    ids.reg = res.body.data.id;

    const dup = await as(staff).post('/api/v1/attendance/regularizations', {
      date: day(2),
      requestedOut: '17:15',
      reason: 'Again',
    });
    expect(dup.status).toBe(400);

    expect(
      (await as(staff).post(`/api/v1/attendance/regularizations/${ids.reg}/approve`, {})).status,
    ).toBe(403);
    expect(
      (await as(outsider).post(`/api/v1/attendance/regularizations/${ids.reg}/approve`, {})).status,
    ).toBe(403);

    const inbox = await as(mgr).get('/api/v1/attendance/inbox');
    expect(inbox.body.data.map((r: { id: string }) => r.id)).toEqual([ids.reg]);
    const ok = await as(mgr).post(`/api/v1/attendance/regularizations/${ids.reg}/approve`, {});
    expect(ok.body.data.status).toBe('approved');

    const d = await monthDays(staff, ids.staff);
    expect(d.get(day(2))).toMatchObject({ status: 'present', lastOut: iso(day(2), '17:10') });
    const punches = await as(staff).get(
      `/api/v1/attendance/punches?employeeId=${ids.staff}&from=${day(2)}&to=${day(2)}`,
    );
    expect(punches.body.data.map((p: { source: string }) => p.source)).toEqual([
      'device',
      'manual',
    ]);
  });

  it('refuses future dates and an out before the in', async () => {
    expect(
      (
        await as(staff).post('/api/v1/attendance/regularizations', {
          date: addDays(T, 2),
          requestedIn: '08:30',
          reason: 'Future',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff).post('/api/v1/attendance/regularizations', {
          date: day(3),
          requestedIn: '09:00',
          requestedOut: '08:00',
          reason: 'Backwards',
        })
      ).status,
    ).toBe(400);
  });
});

describe('leave changes the day', () => {
  it('approved no-pay leave turns an absence into on_leave', async () => {
    const types = (await as(hr).get('/api/v1/leave/types')).body.data as LeaveType[];
    const nopay = types.find((t) => t.code === 'NOPAY')!;
    const req = await as(staff).post('/api/v1/leave/requests', {
      leaveTypeId: nopay.id,
      startDate: day(3),
      endDate: day(3),
    });
    expect(req.status).toBe(201);
    await as(mgr).post(`/api/v1/leave/requests/${req.body.data.id}/approve`, {});
    const d = await monthDays(staff, ids.staff);
    expect(d.get(day(3))).toMatchObject({ status: 'on_leave', leavePortion: 1, absentPortion: 0 });
  });
});

describe('overtime approval', () => {
  it('approval is capped at the worked OT and never self-approved', async () => {
    await as(hr).put('/api/v1/settings/attendance.ot_requires_approval', { value: true });
    const d = (await monthDays(mgr, ids.staff)).get(day(1))!;
    expect(
      (await as(mgr).post(`/api/v1/attendance/days/${d.id}/ot`, { approvedMinutes: 500 })).status,
    ).toBe(400);
    expect(
      (await as(staff).post(`/api/v1/attendance/days/${d.id}/ot`, { approvedMinutes: 60 })).status,
    ).toBe(403);
    const res = await as(mgr).post(`/api/v1/attendance/days/${d.id}/ot`, { approvedMinutes: 90 });
    expect(res.body.data.otApprovedMinutes).toBe(90);
    const sum = await as(hr).get(`/api/v1/attendance/summary?month=${MONTH}`);
    const row = sum.body.data.rows.find((r: { employeeId: string }) => r.employeeId === ids.staff);
    expect(row).toMatchObject({ otMinutes: 120, payableOtMinutes: 90, lateCount: 1 });
    expect(sum.body.data.otRequiresApproval).toBe(true);
  });
});

describe('clock in (PWA)', () => {
  beforeAll(async () => {
    const sql = h.tenants.a!.sql;
    const [b] = await sql`
      insert into branches (code, name, geo_lat, geo_lng, geo_radius_m)
      values ('HQ', 'Colombo HQ', 6.927100, 79.861200, 100) returning id`;
    ids.branch = b!.id as string;
    await sql`update employees set branch_id = ${ids.branch} where id = ${ids.staff}`;
  });

  it('reports the branch checks and next action', async () => {
    const res = await as(staff).get('/api/v1/attendance/today');
    expect(res.body.data).toMatchObject({
      linked: true,
      canClock: true,
      checks: { geofence: true, ip: false },
      nextAction: 'in',
    });
  });

  it('stores a rejected punch with a clear reason when outside the geofence', async () => {
    const res = await as(staff).post('/api/v1/attendance/clock', {
      source: 'pwa',
      lat: 6.9371,
      lng: 79.8612,
      accuracy: 15,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.accepted).toBe(false);
    expect(res.body.data.message).toMatch(/about 1112 m from Colombo HQ.*100 m/);
    const noLoc = await as(staff).post('/api/v1/attendance/clock', {
      source: 'pwa',
      locationError: 'permission denied',
    });
    expect(noLoc.body.data.message).toMatch(/Location is needed.*permission denied/);
  });

  it('accepts inside the geofence, then blocks a double tap', async () => {
    const res = await as(staff).post('/api/v1/attendance/clock', {
      source: 'pwa',
      lat: 6.9275,
      lng: 79.8613,
      accuracy: 10,
    });
    expect(res.body.data.accepted).toBe(true);
    expect(
      (await as(staff).post('/api/v1/attendance/clock', { lat: 6.9275, lng: 79.8613 })).status,
    ).toBe(400);
    const today = await as(staff).get('/api/v1/attendance/today');
    expect(today.body.data.nextAction).toBe('out');
    expect(today.body.data.punches.map((p: { accepted: boolean }) => p.accepted)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('an office-network IP passes when either check is enough', async () => {
    const sql = h.tenants.a!.sql;
    await sql`update branches set allowed_ips = '{127.0.0.1}' where id = ${ids.branch}`;
    // A different employee on the same branch (staff just clocked: double-tap guard).
    await sql`update employees set branch_id = ${ids.branch} where id = ${ids.mgr}`;
    const res = await as(mgr).post('/api/v1/attendance/clock', { source: 'web' });
    expect(res.body.data.accepted).toBe(true);
    await as(hr).put('/api/v1/settings/attendance.branch_check', { value: 'both' });
    await sql`update employees set branch_id = ${ids.branch} where id = ${ids.staff2}`;
    const both = await as(staff2).post('/api/v1/attendance/clock', { source: 'web' });
    expect(both.body.data.accepted).toBe(false);
  });
});

describe('period lock', () => {
  it('refuses to lock a month that has not ended', async () => {
    const res = await as(hr).post(`/api/v1/attendance/periods/${T.slice(0, 7)}/lock`, {});
    expect(res.status).toBe(400);
  });

  it('flags incomplete days, then locks with force', async () => {
    // One incomplete day for the loner.
    await as(hr).post('/api/v1/attendance/punches', {
      employeeId: ids.loner,
      at: iso(day(8), '08:30'),
      note: 'Card reader down',
    });
    const blocked = await as(hr).post(`/api/v1/attendance/periods/${MONTH}/lock`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details).toMatchObject({ incomplete: 1 });
    const res = await as(hr).post(`/api/v1/attendance/periods/${MONTH}/lock`, { force: true });
    expect(res.body.data).toMatchObject({ status: 'locked' });
  });

  it('a locked month cannot change', async () => {
    const before = await monthDays(hr, ids.staff);
    expect([...before.values()].every((d) => d.isLocked)).toBe(true);
    expect(
      (
        await as(hr).post('/api/v1/attendance/punches', {
          employeeId: ids.staff,
          at: iso(day(4), '08:30'),
          note: 'late fix',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(staff).post('/api/v1/attendance/regularizations', {
          date: day(4),
          requestedIn: '08:30',
          reason: 'Too late',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await as(hr).put('/api/v1/attendance/roster', {
          entries: [{ employeeId: ids.staff, date: day(4), shiftId: null }],
        })
      ).status,
    ).toBe(409);
    const imp = await as(hr).post('/api/v1/imports/attendance-punches/preview', {
      rows: [{ line: 2, values: { deviceUserId: '101', timestamp: `${day(4)} 08:30` } }],
    });
    expect(imp.body.data.errors[0].message).toMatch(/locked/);
    const proc = await as(hr).post('/api/v1/attendance/process', {
      from: `${MONTH}-01`,
      to: day(20),
    });
    expect(proc.body.data.processed).toBe(0);
    // Even a direct database write is refused by the trigger.
    await expect(
      h.tenants.a!.sql`update attendance_days set status = 'present' where date = ${day(3)}`,
    ).rejects.toThrow(/locked/);
    expect(await monthDays(hr, ids.staff)).toEqual(before);
  });

  it('unlocking needs a reason and reopens the month', async () => {
    expect((await as(hr).post(`/api/v1/attendance/periods/${MONTH}/unlock`, {})).status).toBe(400);
    const res = await as(hr).post(`/api/v1/attendance/periods/${MONTH}/unlock`, {
      reason: 'Payroll correction',
    });
    expect(res.body.data.status).toBe('open');
    const d = await monthDays(hr, ids.staff);
    expect(d.get(day(0))?.isLocked).toBe(false);
  });

  it('raw punches are append-only', async () => {
    await expect(h.tenants.a!.sql`delete from attendance_punches`).rejects.toThrow(/append-only/);
  });
});
