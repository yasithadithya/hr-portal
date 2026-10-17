import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditPageSchema, meSchema, roleSchema, userSchema } from '@hr/shared';

import { createHarness, type Harness } from '../test/harness';

let h: Harness;
const A = 'a.localhost';

type U = Awaited<ReturnType<Harness['createUser']>>;
let owner: U;
let hr: U;
let mgr: U;
let emp: U;
let outsider: U;
const ids: Record<string, string> = {};

const get = (path: string, token?: string, host = A) => {
  const r = request(h.app).get(path).set('host', host);
  return token ? r.set('authorization', `Bearer ${token}`) : r;
};
const send = (method: 'post' | 'patch' | 'delete', path: string, token: string, body?: object) =>
  request(h.app)[method](path).set('host', A).set('authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  h = await createHarness('auth', ['a', 'b']);
  // Org: ceo → mgr → (lead → dev), other reports to ceo
  ids.ceo = await h.createEmployee('a', 'E-CEO');
  ids.mgr = await h.createEmployee('a', 'E-MGR', ids.ceo);
  ids.lead = await h.createEmployee('a', 'E-LEAD', ids.mgr);
  ids.dev = await h.createEmployee('a', 'E-DEV', ids.lead);
  ids.other = await h.createEmployee('a', 'E-OTHER', ids.ceo);

  owner = await h.createUser('a', { email: 'owner@a.lk', roles: ['owner'], employeeId: ids.ceo });
  hr = await h.createUser('a', { email: 'hr@a.lk', roles: ['hr_admin', 'employee'] });
  mgr = await h.createUser('a', { email: 'mgr@a.lk', roles: ['manager'], employeeId: ids.mgr });
  emp = await h.createUser('a', { email: 'dev@a.lk', roles: ['employee'], employeeId: ids.dev });
  outsider = await h.createUser('b', { email: 'someone@b.lk', roles: ['owner'] });
});

afterAll(async () => {
  await h?.close();
});

describe('authentication', () => {
  it('requires a token', async () => {
    expect((await get('/api/v1/me')).status).toBe(401);
  });

  it('rejects tokens signed by an unknown key', async () => {
    const res = await get('/api/v1/me', 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig');
    expect(res.status).toBe(401);
  });

  it("rejects another tenant's token on this host (issuer mismatch)", async () => {
    expect((await get('/api/v1/me', outsider.token)).status).toBe(401);
  });

  it('rejects a valid token for someone who is not a user of this workspace', async () => {
    const stranger = await h.tokenFor('a', randomUUID());
    const res = await get('/api/v1/me', stranger);
    expect(res.status).toBe(403);
  });

  it('rejects disabled users', async () => {
    const d = await h.createUser('a', {
      email: 'gone@a.lk',
      roles: ['employee'],
      status: 'disabled',
    });
    expect((await get('/api/v1/me', d.token)).status).toBe(403);
  });

  it('first sign-in activates an invited user', async () => {
    const inv = await h.createUser('a', {
      email: 'new@a.lk',
      roles: ['employee'],
      status: 'invited',
    });
    const res = await get('/api/v1/me', inv.token);
    expect(res.status).toBe(200);
    expect(meSchema.parse(res.body.data).user.status).toBe('active');
  });

  it('/me returns roles and effective permissions', async () => {
    const me = meSchema.parse((await get('/api/v1/me', mgr.token)).body.data);
    expect(me.roles.map((r) => r.key)).toEqual(['manager']);
    expect(me.permissions['leave.approve']).toBe('team');
    expect(me.permissions['users.manage']).toBeUndefined();
    expect(me.employee?.employeeNo).toBe('E-MGR');
  });
});

describe('IDOR: employees (self / team / all)', () => {
  it('an employee sees only themselves', async () => {
    const list = await get('/api/v1/employees', emp.token);
    expect(list.body.data.items.map((e: { employeeNo: string }) => e.employeeNo)).toEqual([
      'E-DEV',
    ]);
    expect((await get(`/api/v1/employees/${ids.lead}`, emp.token)).status).toBe(404);
    expect((await get(`/api/v1/employees/${ids.dev}`, emp.token)).status).toBe(200);
  });

  it('a manager sees their recursive team and nobody outside it', async () => {
    const list = await get('/api/v1/employees', mgr.token);
    expect(list.body.data.items.map((e: { employeeNo: string }) => e.employeeNo).sort()).toEqual([
      'E-DEV',
      'E-LEAD',
      'E-MGR',
    ]);
    expect((await get(`/api/v1/employees/${ids.dev}`, mgr.token)).status).toBe(200);
    expect((await get(`/api/v1/employees/${ids.other}`, mgr.token)).status).toBe(404);
    expect((await get(`/api/v1/employees/${ids.ceo}`, mgr.token)).status).toBe(404);
  });

  it('HR (all) sees everyone', async () => {
    const list = await get('/api/v1/employees', hr.token);
    expect(list.body.data.items).toHaveLength(5);
  });

  it('out-of-scope and non-existent look the same (no ID oracle)', async () => {
    const missing = await get(`/api/v1/employees/${randomUUID()}`, emp.token);
    const hidden = await get(`/api/v1/employees/${ids.ceo}`, emp.token);
    expect([missing.status, missing.body.error.code]).toEqual([
      hidden.status,
      hidden.body.error.code,
    ]);
  });
});

describe('users & invites', () => {
  let employeeRoleId: string;
  let ownerRoleId: string;

  beforeAll(async () => {
    const roles = (await get('/api/v1/roles', hr.token)).body.data as { id: string; key: string }[];
    employeeRoleId = roles.find((r) => r.key === 'employee')!.id;
    ownerRoleId = roles.find((r) => r.key === 'owner')!.id;
  });

  it('only users.manage can list users', async () => {
    expect((await get('/api/v1/users', emp.token)).status).toBe(403);
    expect((await get('/api/v1/users', mgr.token)).status).toBe(403);
    const res = await get('/api/v1/users', hr.token);
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: unknown) => userSchema.parse(u).email)).toContain('owner@a.lk');
  });

  it('HR invites a user: Supabase invite with this host, invited row, audit entry', async () => {
    const res = await send('post', '/api/v1/users/invite', hr.token, {
      email: 'Newbie@A.lk',
      roleIds: [employeeRoleId],
      employeeId: ids.other,
    });
    expect(res.status).toBe(201);
    const user = userSchema.parse(res.body.data);
    expect(user).toMatchObject({ email: 'newbie@a.lk', status: 'invited', employeeId: ids.other });
    expect(h.invites.at(-1)).toMatchObject({
      email: 'newbie@a.lk',
      redirectTo: 'http://a.localhost/auth/accept',
    });

    const audit = auditPageSchema.parse(
      (await get(`/api/v1/audit-log?entity=app_users&entityId=${user.id}`, hr.token)).body.data,
    );
    expect(audit.items[0]).toMatchObject({ action: 'invite', actorEmail: 'hr@a.lk' });
  });

  it('cannot link an employee who already has a user', async () => {
    const res = await send('post', '/api/v1/users/invite', hr.token, {
      email: 'dup@a.lk',
      roleIds: [employeeRoleId],
      employeeId: ids.dev,
    });
    expect(res.status).toBe(409);
  });

  it('HR cannot grant the owner role (privilege escalation)', async () => {
    const res = await send('post', '/api/v1/users/invite', hr.token, {
      email: 'evil@a.lk',
      roleIds: [ownerRoleId],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.permissions).toContain('payroll.approve:all');
  });

  it('HR cannot edit an owner, but an owner can', async () => {
    expect(
      (await send('patch', `/api/v1/users/${owner.id}`, hr.token, { status: 'disabled' })).status,
    ).toBe(403);
    const res = await send('patch', `/api/v1/users/${emp.id}`, owner.token, {
      roleIds: [employeeRoleId],
    });
    expect(res.status).toBe(200);
  });

  it('nobody can disable themselves or change their own roles', async () => {
    expect(
      (await send('patch', `/api/v1/users/${owner.id}`, owner.token, { status: 'disabled' }))
        .status,
    ).toBe(400);
    expect(
      (await send('patch', `/api/v1/users/${owner.id}`, owner.token, { roleIds: [employeeRoleId] }))
        .status,
    ).toBe(400);
  });

  it('the last active owner cannot be disabled or demoted', async () => {
    // Workspace b: `outsider` is the only owner. A full-permission custom role (not "owner")
    // passes the escalation guard, so only the last-owner rule stands in the way.
    const bHost = 'b.localhost';
    const asB = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: object) => {
      const agent = request(h.app);
      return agent[method](path)
        .set('host', bHost)
        .set('authorization', `Bearer ${token}`)
        .send(body);
    };

    const roles = (await asB('get', '/api/v1/roles', outsider.token)).body.data as {
      id: string;
      key: string;
    }[];
    const ownerRole = roles.find((r) => r.key === 'owner')!;
    const employeeRole = roles.find((r) => r.key === 'employee')!;
    const custom = await asB('post', '/api/v1/roles', outsider.token, {
      name: 'Co-admin',
      copyFromRoleId: ownerRole.id,
    });
    expect(custom.status).toBe(201);
    const coAdmin = await h.createUser('b', { email: 'co@b.lk', roles: ['custom_co_admin'] });

    const disable = await asB('patch', `/api/v1/users/${outsider.id}`, coAdmin.token, {
      status: 'disabled',
    });
    expect([disable.status, disable.body.error?.code]).toEqual([409, 'CONFLICT']);
    const demote = await asB('patch', `/api/v1/users/${outsider.id}`, coAdmin.token, {
      roleIds: [employeeRole.id],
    });
    expect(demote.status).toBe(409);

    // With a second active owner the same change is allowed.
    await h.createUser('b', { email: 'owner2@b.lk', roles: ['owner'] });
    expect(
      (await asB('patch', `/api/v1/users/${outsider.id}`, coAdmin.token, { status: 'disabled' }))
        .status,
    ).toBe(200);
  });
});

describe('roles', () => {
  it('copies a system role into an editable custom role', async () => {
    const roles = (await get('/api/v1/roles', hr.token)).body.data as { id: string; key: string }[];
    const managerId = roles.find((r) => r.key === 'manager')!.id;
    const res = await send('post', '/api/v1/roles', hr.token, {
      name: 'Shift supervisor',
      copyFromRoleId: managerId,
    });
    expect(res.status).toBe(201);
    const role = roleSchema.parse(res.body.data);
    expect(role).toMatchObject({ key: 'custom_shift_supervisor', isSystem: false });
    expect(role.permissions.find((p) => p.key === 'leave.approve')?.scope).toBe('team');

    const edited = await send('patch', `/api/v1/roles/${role.id}`, hr.token, {
      permissions: [{ key: 'attendance.approve', scope: 'team' }],
    });
    expect(roleSchema.parse(edited.body.data).permissions).toEqual([
      { key: 'attendance.approve', scope: 'team' },
    ]);
  });

  it('system roles are read-only', async () => {
    const roles = (await get('/api/v1/roles', hr.token)).body.data as { id: string; key: string }[];
    const res = await send(
      'patch',
      `/api/v1/roles/${roles.find((r) => r.key === 'employee')!.id}`,
      hr.token,
      {
        name: 'Staff',
      },
    );
    expect(res.status).toBe(400);
  });

  it('cannot create a role with permissions you lack', async () => {
    const res = await send('post', '/api/v1/roles', hr.token, {
      name: 'Sneaky',
      permissions: [{ key: 'payroll.run', scope: 'all' }],
    });
    expect(res.status).toBe(403);
  });

  it('rejects scopes a permission does not support', async () => {
    const res = await send('post', '/api/v1/roles', hr.token, {
      name: 'Odd',
      permissions: [{ key: 'attendance.clock', scope: 'all' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('audit log', () => {
  it('is restricted to audit.read', async () => {
    expect((await get('/api/v1/audit-log', mgr.token)).status).toBe(403);
  });

  it('pages with a stable cursor', async () => {
    const first = auditPageSchema.parse(
      (await get('/api/v1/audit-log?limit=2', hr.token)).body.data,
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = auditPageSchema.parse(
      (
        await get(
          `/api/v1/audit-log?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
          hr.token,
        )
      ).body.data,
    );
    expect(second.items.map((i) => i.id)).not.toContain(first.items[0]!.id);
  });
});

describe('MFA', () => {
  it('when required, aal1 sessions get MFA_REQUIRED and aal2 sessions pass', async () => {
    await h.tenants.a!
      .sql`insert into settings (key, value) values ('security.mfa_required', 'true'::jsonb)`;
    try {
      const aal1 = await get('/api/v1/me', emp.token);
      expect(aal1.status).toBe(403);
      expect(aal1.body.error.code).toBe('MFA_REQUIRED');
      const aal2 = await get('/api/v1/me', await h.tokenFor('a', emp.authUserId, { aal: 'aal2' }));
      expect(aal2.status).toBe(200);
    } finally {
      await h.tenants.a!.sql`delete from settings where key = 'security.mfa_required'`;
    }
  });
});
