import { describe, expect, it } from 'vitest';

import {
  computeDay,
  distanceMetres,
  ipAllowed,
  parseDeviceTimestamp,
  shiftWindow,
  type DayInput,
  type ShiftRules,
} from './attendance';
import { zonedInstant } from './time/index';

const TZ = 'Asia/Colombo';
const DAY: ShiftRules = {
  startTime: '08:30',
  endTime: '17:00',
  isNightShift: false,
  breakMinutes: 60,
  breakAfterMinutes: 300,
  graceLateMinutes: 10,
  earlyLeaveGraceMinutes: 5,
  halfDayThresholdMinutes: 240,
  otAfterMinutes: 30,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
};
const NIGHT: ShiftRules = {
  ...DAY,
  startTime: '22:00',
  endTime: '06:00',
  isNightShift: true,
  breakMinutes: 30,
};

const at = (date: string, time: string) => zonedInstant(date, time, TZ);
const day = (over: Partial<DayInput>): DayInput => ({
  date: '2026-10-19', // Monday
  tz: TZ,
  shift: DAY,
  dayType: 'workday',
  expected: 1,
  leavePortion: 0,
  punches: [],
  ...over,
});

describe('computeDay', () => {
  it('on-time full day: worked minus break, no late/early/OT', () => {
    const r = computeDay(day({ punches: [at('2026-10-19', '08:25'), at('2026-10-19', '17:05')] }));
    expect(r).toMatchObject({
      workedMinutes: 520 - 60,
      lateMinutes: 0,
      earlyMinutes: 0,
      otMinutes: 0,
      status: 'present',
      absentPortion: 0,
    });
  });

  it('late within grace is not late; beyond grace counts from shift start', () => {
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:40'), at('2026-10-19', '17:00')] }))
        .lateMinutes,
    ).toBe(0);
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:41'), at('2026-10-19', '17:00')] }))
        .lateMinutes,
    ).toBe(11);
  });

  it('early leave beyond grace', () => {
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:30'), at('2026-10-19', '16:40')] }))
        .earlyMinutes,
    ).toBe(20);
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:30'), at('2026-10-19', '16:56')] }))
        .earlyMinutes,
    ).toBe(0);
  });

  it('OT only once the employee stays at least ot_after past the end, then counts from the end', () => {
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:30'), at('2026-10-19', '17:29')] }))
        .otMinutes,
    ).toBe(0);
    expect(
      computeDay(day({ punches: [at('2026-10-19', '08:30'), at('2026-10-19', '19:00')] }))
        .otMinutes,
    ).toBe(120);
  });

  it('short day is a half day; a half day with half leave is covered', () => {
    const r = computeDay(day({ punches: [at('2026-10-19', '08:30'), at('2026-10-19', '11:30')] }));
    expect(r).toMatchObject({ workedMinutes: 180, status: 'half_day', absentPortion: 0.5 });
    expect(
      computeDay(
        day({ leavePortion: 0.5, punches: [at('2026-10-19', '12:30'), at('2026-10-19', '15:30')] }),
      ),
    ).toMatchObject({
      absentPortion: 0,
      status: 'half_day',
    });
  });

  it('no punches: absent, or on leave when leave covers the day', () => {
    expect(computeDay(day({}))).toMatchObject({ status: 'absent', absentPortion: 1 });
    expect(computeDay(day({ leavePortion: 1 }))).toMatchObject({
      status: 'on_leave',
      absentPortion: 0,
    });
  });

  it('a single punch is incomplete (needs regularisation), not absent', () => {
    expect(computeDay(day({ punches: [at('2026-10-19', '08:30')] }))).toMatchObject({
      status: 'incomplete',
      absentPortion: 0,
    });
  });

  it('weekend/holiday: no punches is just a rest day; work there is all OT', () => {
    expect(computeDay(day({ dayType: 'weekend', expected: 0 })).status).toBe('weekend');
    expect(computeDay(day({ dayType: 'holiday', expected: 0 })).status).toBe('holiday');
    const worked = computeDay(
      day({
        dayType: 'holiday',
        expected: 0,
        punches: [at('2026-10-19', '09:00'), at('2026-10-19', '13:00')],
      }),
    );
    expect(worked).toMatchObject({ status: 'present', workedMinutes: 240, otMinutes: 240 });
  });

  it('half working day (Saturday): expected end is mid-shift', () => {
    const r = computeDay(
      day({
        date: '2026-10-24',
        expected: 0.5,
        punches: [at('2026-10-24', '08:30'), at('2026-10-24', '12:45')],
      }),
    );
    expect(r).toMatchObject({ status: 'present', earlyMinutes: 0, absentPortion: 0 });
  });

  it('night shift crossing midnight: punches on two calendar days belong to one shift', () => {
    const w = shiftWindow('2026-10-19', TZ, NIGHT);
    expect(w.end.getTime() - w.start.getTime()).toBe(8 * 3_600_000);
    const r = computeDay(
      day({ shift: NIGHT, punches: [at('2026-10-19', '21:55'), at('2026-10-20', '07:00')] }),
    );
    expect(r).toMatchObject({
      workedMinutes: 545 - 30,
      lateMinutes: 0,
      otMinutes: 60,
      status: 'present',
    });
    // The next night's punches don't leak into this one.
    const next = computeDay(
      day({ shift: NIGHT, punches: [at('2026-10-20', '21:58'), at('2026-10-21', '06:02')] }),
    );
    expect(next.firstIn).toBeNull();
  });

  it('is independent of the server timezone', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(
        computeDay(day({ punches: [at('2026-10-19', '08:41'), at('2026-10-19', '17:00')] }))
          .lateMinutes,
      ).toBe(11);
    } finally {
      process.env.TZ = before;
    }
  });
});

describe('location and network checks', () => {
  it('measures distance', () => {
    const colombo = { lat: 6.9271, lng: 79.8612 };
    expect(distanceMetres(colombo, colombo)).toBe(0);
    expect(Math.round(distanceMetres(colombo, { lat: 6.9281, lng: 79.8612 }))).toBe(111);
  });

  it('matches IPv4 CIDRs and exact addresses', () => {
    expect(ipAllowed('203.0.113.45', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('::ffff:203.0.113.45', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(ipAllowed('10.0.0.5', ['10.0.0.5'])).toBe(true);
    expect(ipAllowed('10.0.0.6', [])).toBe(false);
  });
});

describe('parseDeviceTimestamp', () => {
  it('reads common device export formats', () => {
    expect(parseDeviceTimestamp({ timestamp: '2026-10-19 08:15:30' })).toEqual({
      date: '2026-10-19',
      time: '08:15:30',
    });
    expect(parseDeviceTimestamp({ timestamp: '2026/10/19 8:15' })).toEqual({
      date: '2026-10-19',
      time: '08:15:00',
    });
    expect(parseDeviceTimestamp({ date: '19/10/2026', time: '5:30 PM' })).toEqual({
      date: '2026-10-19',
      time: '17:30:00',
    });
    expect(parseDeviceTimestamp({ date: '19.10.2026', time: '12:05 am' })).toEqual({
      date: '2026-10-19',
      time: '00:05:00',
    });
    expect(parseDeviceTimestamp({ date: '2026-10-19', time: '1899-12-30 08:15:00' })).toEqual({
      date: '2026-10-19',
      time: '08:15:00',
    });
  });

  it('rejects impossible values with a clear message', () => {
    expect(parseDeviceTimestamp({ date: '31/02/2026', time: '08:00' })).toHaveProperty('error');
    expect(parseDeviceTimestamp({ date: '2026-10-19', time: '25:00' })).toHaveProperty('error');
    expect(parseDeviceTimestamp({ date: '10-19-26', time: '08:00' })).toHaveProperty('error');
    expect(parseDeviceTimestamp({})).toHaveProperty('error');
  });
});
