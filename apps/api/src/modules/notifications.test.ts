import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schema as controlSchema } from '@hr/control-db';
import type { AppNotification, LeaveType } from '@hr/shared';
import { addDays, today as todayIn, weekdayOf } from '@hr/shared/time';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';
let hr: string;
let mgr: string;
let staff: string;
let other: string;
const ids = {} as Record<'mgr' | 'staff' | 'other' | 'staffUser' | 'mgrUser' | 'hrUser', string>;
const T = todayIn('Asia/Colombo');
/** A Monday at least `n` days ahead (a working day). */
const mondayAfter = (n: number) => {
  let d = addDays(T, n);
  while (weekdayOf(d) !== 'mon') d = addDays(d, 1);
  return d;
};

const as = (token: string) => ({
  get: (p: string) => request(h.app).get(p).set('host', A).set('authorization', `Bearer ${token}`),
  post: (p: string, b?: object) =>
    request(h.app).post(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
  put: (p: string, b?: object) =>
    request(h.app).put(p).set('host', A).set('authorization', `Bearer ${token}`).send(b),
});
const inbox = async (token: string) => {
  await h.jobs.drain();
  return (await as(token).get('/api/v1/notifications')).body.data as {
    unread: number;
    items: AppNotification[];
  };
};

beforeAll(async () => {
  h = await createHarness('notify', ['a']);
  const hrU = await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin'] });
  hr = hrU.token;
  ids.hrUser = hrU.id;
  ids.mgr = await h.createEmployee('a', 'N-MGR');
  ids.staff = await h.createEmployee('a', 'N-STAFF', ids.mgr);
  ids.other = await h.createEmployee('a', 'N-OTHER');
  const m = await h.createUser('a', { email: 'm@a.lk', roles: ['manager'], employeeId: ids.mgr });
  mgr = m.token;
  ids.mgrUser = m.id;
  const s = await h.createUser('a', {
    email: 's@a.lk',
    roles: ['employee'],
    employeeId: ids.staff,
  });
  staff = s.token;
  ids.staffUser = s.id;
  other = (await h.createUser('a', { email: 'o@a.lk', roles: ['employee'], employeeId: ids.other }))
    .token;
});

afterAll(async () => {
  await h?.close();
});

describe('leave notifications', () => {
  let nopay: LeaveType;
  beforeAll(async () => {
    nopay = ((await as(hr).get('/api/v1/leave/types')).body.data as LeaveType[]).find(
      (t) => t.code === 'NOPAY',
    )!;
  });

  it('the manager is notified in-app and by email when leave is submitted', async () => {
    h.email.sent.length = 0;
    const d = mondayAfter(20);
    const res = await as(staff).post('/api/v1/leave/requests', {
      leaveTypeId: nopay.id,
      startDate: d,
      endDate: d,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const n = await inbox(mgr);
    expect(n.unread).toBe(1);
    expect(n.items[0]).toMatchObject({ event: 'leave.submitted', link: '/approvals' });
    expect(n.items[0]!.title).toMatch(/N-STAFF Test requested no-pay leave/);
    const mail = h.email.sent.find((e) => e.to === 'm@a.lk')!;
    expect(mail.subject).toMatch(/requested no-pay leave/);
    expect(mail.html).toContain('http://app.test/approvals');
    expect(mail.html).toContain('Tenant A');
    // Nobody else hears about it.
    expect((await inbox(other)).unread).toBe(0);
  });

  it('respects preferences: email off still keeps the in-app notification; push goes to subscribers', async () => {
    await as(staff).put('/api/v1/notifications/preferences', {
      preferences: [{ event: 'leave.decided', email: false, push: true }],
    });
    await as(staff).post('/api/v1/push/subscriptions', {
      endpoint: 'https://push.example/sub-1',
      keys: { p256dh: 'p', auth: 'a' },
    });
    h.email.sent.length = 0;
    const req = (await as(mgr).get('/api/v1/leave/inbox')).body.data[0];
    await as(mgr).post(`/api/v1/leave/requests/${req.id}/approve`, {});
    const n = await inbox(staff);
    expect(n.items[0]).toMatchObject({ event: 'leave.decided', link: '/leave' });
    expect(n.items[0]!.title).toMatch(/approved/);
    expect(h.email.sent.filter((e) => e.to === 's@a.lk')).toHaveLength(0);
    expect(h.push.sent.at(-1)).toMatchObject({
      target: expect.objectContaining({ endpoint: 'https://push.example/sub-1' }),
      payload: expect.objectContaining({ url: '/leave' }),
    });
    const prefs = (await as(staff).get('/api/v1/notifications/preferences')).body.data;
    expect(prefs.find((p: { event: string }) => p.event === 'leave.decided')).toMatchObject({
      email: false,
      push: true,
    });
  });

  it('expired push subscriptions are removed', async () => {
    h.push.gone.add('https://push.example/sub-1');
    const d = mondayAfter(30);
    await as(staff).post('/api/v1/leave/requests', {
      leaveTypeId: nopay.id,
      startDate: d,
      endDate: d,
    });
    const req = (await as(mgr).get('/api/v1/leave/inbox')).body.data[0];
    await as(mgr).post(`/api/v1/leave/requests/${req.id}/reject`, { note: 'Busy week' });
    await h.jobs.drain();
    const [row] = await h.tenants.a!.sql`select count(*)::int as n from push_subscriptions`;
    expect(row!.n).toBe(0);
    expect(h.jobs.errors).toEqual([]);
  });

  it('users only read and mark their own notifications', async () => {
    const mine = (await inbox(mgr)).items[0]!;
    expect((await as(staff).post(`/api/v1/notifications/${mine.id}/read`)).status).toBe(404);
    expect(
      (await as(mgr).post(`/api/v1/notifications/${mine.id}/read`)).body.data.readAt,
    ).not.toBeNull();
    await as(mgr).post('/api/v1/notifications/read-all');
    expect((await inbox(mgr)).unread).toBe(0);
  });
});

describe('web push keys', () => {
  it('creates one VAPID key pair per tenant, private key encrypted', async () => {
    const a = (await as(staff).get('/api/v1/push/public-key')).body.data.publicKey;
    const b = (await as(mgr).get('/api/v1/push/public-key')).body.data.publicKey;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(60);
    const [s] = await h.control.select().from(controlSchema.tenantSecrets).limit(1);
    expect(s!.vapidPublicKey).toBe(a);
    expect(s!.vapidPrivateKeyEnc).toBeTruthy();
    expect(s!.vapidPrivateKeyEnc!.length).toBeGreaterThan(50);
  });
});

describe('profile change requests', () => {
  it('employee asks, HR is notified, approves, and the change is applied and audited', async () => {
    const res = await as(staff).post('/api/v1/me/profile-changes', {
      section: 'contact',
      values: { mobile: '+94 77 123 4567' },
      note: 'New number',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.changes).toEqual({ mobile: { from: null, to: '+94 77 123 4567' } });
    expect(
      (
        await as(staff).post('/api/v1/me/profile-changes', {
          section: 'contact',
          values: { mobile: '+94 71 000 0000' },
        })
      ).status,
    ).toBe(400);
    expect((await as(staff).get('/api/v1/profile-changes')).status).toBe(403);
    const hrInbox = await inbox(hr);
    expect(hrInbox.items.some((n) => n.event === 'profile.change_submitted')).toBe(true);

    const ok = await as(hr).post(`/api/v1/profile-changes/${res.body.data.id}/approve`, {});
    expect(ok.body.data.status).toBe('approved');
    const [e] = await h.tenants.a!.sql`select mobile from employees where id = ${ids.staff}`;
    expect(e!.mobile).toBe('+94 77 123 4567');
    const [audit] = await h.tenants.a!.sql`
      select action, after from audit_log where entity = 'employees' and entity_id = ${ids.staff}
      order by at desc limit 1`;
    expect(audit).toMatchObject({
      action: 'profile_change_applied',
      after: { mobile: '+94 77 123 4567' },
    });
    expect((await inbox(staff)).items[0]).toMatchObject({ event: 'profile.change_decided' });
  });

  it('a change with nothing new is refused; employees can withdraw', async () => {
    expect(
      (
        await as(staff).post('/api/v1/me/profile-changes', {
          section: 'contact',
          values: { mobile: '+94 77 123 4567' },
        })
      ).status,
    ).toBe(400);
    const r = await as(staff).post('/api/v1/me/profile-changes', {
      section: 'bank',
      values: { bankAccountNo: '123456789' },
    });
    expect(
      (await as(other).post(`/api/v1/me/profile-changes/${r.body.data.id}/withdraw`)).status,
    ).toBe(404);
    expect(
      (await as(staff).post(`/api/v1/me/profile-changes/${r.body.data.id}/withdraw`)).body.data
        .status,
    ).toBe('withdrawn');
  });
});

describe('approvals summary', () => {
  it('counts what is waiting for the caller', async () => {
    await as(staff).post('/api/v1/attendance/regularizations', {
      date: addDays(T, -3),
      requestedIn: '08:30',
      reason: 'Card reader down',
    });
    const s = (await as(mgr).get('/api/v1/approvals/summary')).body.data;
    expect(s).toMatchObject({ regularizations: 1, leave: 0, profileChanges: 0 });
    expect((await as(staff).get('/api/v1/approvals/summary')).body.data.total).toBe(0);
    expect((await inbox(mgr)).items[0]).toMatchObject({
      event: 'attendance.regularization_submitted',
    });
  });
});

describe('daily job', () => {
  it('sends HR reminders once, applies future job changes and processes yesterday', async () => {
    const sql = h.tenants.a!.sql;
    await sql`update employees set status = 'on_probation', probation_end_date = ${addDays(T, 5)} where id = ${ids.other}`;
    await sql`
      insert into employee_documents (employee_id, title, category, storage_path, mime, size, expiry_date)
      values (${ids.staff}, 'Passport', 'id', 'x/passport.pdf', 'application/pdf', 10, ${addDays(T, 3)})`;
    const before = (await inbox(hr)).items.length;
    for (let i = 0; i < 2; i++) {
      await h.jobs.send('daily.tenant', { tenantId: h.tenants.a!.id });
      await h.jobs.drain();
    }
    expect(h.jobs.errors).toEqual([]);
    const items = (await inbox(hr)).items;
    expect(items.length - before).toBe(2);
    expect(items.map((n) => n.event)).toEqual(
      expect.arrayContaining(['reminder.probation_ending', 'reminder.document_expiring']),
    );
    const [day] =
      await sql`select count(*)::int as n from attendance_days where date = ${addDays(T, -1)}`;
    expect(day!.n).toBeGreaterThan(0);
  });

  it('the sweep fans out one daily job per active tenant', async () => {
    const n = h.jobs.sent.length;
    await h.jobs.send('daily.sweep', {});
    await h.jobs.drain();
    const fanned = h.jobs.sent.slice(n).filter((j) => j.name === 'daily.tenant');
    expect(fanned.map((j) => j.data.tenantId)).toEqual([h.tenants.a!.id]);
  });
});
