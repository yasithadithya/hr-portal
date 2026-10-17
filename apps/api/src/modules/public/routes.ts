import { Router } from 'express';

import { ok, type PublicTenant } from '@hr/shared';

import { ctxOf } from '../../context';

export function publicRoutes(): Router {
  const router = Router();

  // Branding + Supabase public config for the tenant on this host (no auth).
  router.get('/public/tenant', (req, res) => {
    const { tenant, supabase } = ctxOf(req);
    const body: PublicTenant = {
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: null,
      timezone: tenant.timezone,
      supabaseUrl: supabase.url,
      supabaseAnonKey: supabase.anonKey,
      theme: { primaryColor: null },
    };
    res.json(ok(body));
  });

  return router;
}
