import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schema as controlSchema } from '@hr/control-db';
import { schema } from '@hr/db';
import { ok, publicTenantSchema } from '@hr/shared';

import { ctxOf } from '../context';
import { createHarness, type Harness } from '../test/harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness('iso', ['a', 'b', 'c'], {
    mountTenantPublic: (router) => {
      // A tenant-scoped route that reads whatever is in req.ctx.db.
      router.get('/_test/company', async (req, res) => {
        const rows = await ctxOf(req).db.select().from(schema.settings);
        res.json(ok(rows.map((r) => r.value)));
      });
    },
  });
  for (const slug of ['a', 'b']) {
    await h.tenants[slug]!.sql`
      insert into settings (key, value) values ('company.name', ${h.tenants[slug]!.sql.json({ name: `Company ${slug}` })})`;
  }
});

afterAll(async () => {
  await h?.close();
});

describe('tenant resolution and isolation', () => {
  it('serves each host only its own tenant data', async () => {
    const a = await request(h.app).get('/api/v1/_test/company').set('host', 'a.localhost:3000');
    const b = await request(h.app).get('/api/v1/_test/company').set('host', 'b.localhost');
    expect(a.body).toEqual({ success: true, data: [{ name: 'Company a' }] });
    expect(b.body).toEqual({ success: true, data: [{ name: 'Company b' }] });
  });

  it('never leaks across tenants under interleaved concurrent load', async () => {
    const hosts = Array.from({ length: 40 }, (_, i) => (i % 2 ? 'a.localhost' : 'b.localhost'));
    const results = await Promise.all(
      hosts.map((host) => request(h.app).get('/api/v1/_test/company').set('host', host)),
    );
    results.forEach((res, i) => {
      const slug = hosts[i]!.startsWith('a') ? 'a' : 'b';
      expect(res.body.data).toEqual([{ name: `Company ${slug}` }]);
    });
  });

  it('honours X-Forwarded-Host from the trusted web proxy', async () => {
    const res = await request(h.app)
      .get('/api/v1/public/tenant')
      .set('host', 'localhost:4000')
      .set('x-forwarded-host', 'b.localhost:3000');
    expect(publicTenantSchema.parse(res.body.data)).toMatchObject({
      slug: 'b',
      name: 'Tenant B',
      supabaseUrl: 'https://b.supabase.test',
      supabaseAnonKey: 'anon-b',
    });
  });

  it('returns 404 TENANT_NOT_FOUND for unknown hosts before any auth', async () => {
    const res = await request(h.app)
      .get('/api/v1/_test/company')
      .set('host', 'evil.localhost')
      .set('authorization', `Bearer ${await h.sign({ sub: 'x' })}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('blocks suspended tenants once the cache is invalidated', async () => {
    await h.control
      .update(controlSchema.tenants)
      .set({ status: 'suspended' })
      .where(eq(controlSchema.tenants.slug, 'c'));
    h.registry.invalidate(h.tenants.c!.id);
    const res = await request(h.app).get('/api/v1/public/tenant').set('host', 'c.localhost');
    expect(res.status).toBe(403);
  });

  it('keeps one pool per tenant', () => {
    expect(h.pools.getMetrics().open).toBeLessThanOrEqual(2);
    expect(h.pools.getMetrics().hits).toBeGreaterThan(0);
  });
});

describe('platform admin API', () => {
  beforeAll(async () => {
    await h.control.insert(controlSchema.platformAdmins).values({ email: 'ops@hrportal.lk' });
  });

  it('rejects missing, invalid and non-admin tokens', async () => {
    expect((await request(h.app).get('/platform/v1/tenants')).status).toBe(401);
    expect(
      (await request(h.app).get('/platform/v1/tenants').set('authorization', 'Bearer nope')).status,
    ).toBe(401);
    const notAdmin = await h.sign({ sub: 'u1', email: 'someone@acme.lk' });
    expect(
      (await request(h.app).get('/platform/v1/tenants').set('authorization', `Bearer ${notAdmin}`))
        .status,
    ).toBe(403);
  });

  it('lists tenants and suspends/activates one', async () => {
    const token = await h.sign({ sub: 'u2', email: 'ops@hrportal.lk' });
    const list = await request(h.app)
      .get('/platform/v1/tenants')
      .set('authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { slug: string }) => t.slug)).toEqual(['a', 'b', 'c']);

    const suspend = await request(h.app)
      .patch('/platform/v1/tenants/a/status')
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });
    expect(suspend.body.data.status).toBe('suspended');
    expect(
      (await request(h.app).get('/api/v1/public/tenant').set('host', 'a.localhost')).status,
    ).toBe(403);

    await request(h.app)
      .patch('/platform/v1/tenants/a/status')
      .set('authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(
      (await request(h.app).get('/api/v1/public/tenant').set('host', 'a.localhost')).status,
    ).toBe(200);
  });

  it('rejects expired tokens', async () => {
    const expired = await h.sign({ sub: 'u2', email: 'ops@hrportal.lk' }, { expiresIn: '-1m' });
    const res = await request(h.app)
      .get('/platform/v1/tenants')
      .set('authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Session expired');
  });
});
