import { Router } from 'express';

import { schema } from '@hr/db';
import { ok, type PublicTenant } from '@hr/shared';

import { ctxOf } from '../../context';
import { getSettings, logoUrl } from '../company/routes';

export function publicRoutes(): Router {
  const router = Router();

  // Branding + Supabase public config for the tenant on this host (no auth).
  router.get('/public/tenant', async (req, res) => {
    const ctx = ctxOf(req);
    const [profile] = await ctx.db.select().from(schema.companyProfile);
    const settings = await getSettings(ctx.db);
    const body: PublicTenant = {
      slug: ctx.tenant.slug,
      name: profile?.name ?? ctx.tenant.name,
      logoUrl: await logoUrl(ctx, profile?.logoPath ?? null),
      timezone: profile?.timezone ?? ctx.tenant.timezone,
      supabaseUrl: ctx.supabase.url,
      supabaseAnonKey: ctx.supabase.anonKey,
      theme: { primaryColor: settings['branding.primary_color'] },
    };
    res.json(ok(body));
  });

  return router;
}
