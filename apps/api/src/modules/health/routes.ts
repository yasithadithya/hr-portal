import { Router } from 'express';

import { ok, type Health } from '@hr/shared';

export function healthRoutes(version: string): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const body: Health = { status: 'ok', version, time: new Date().toISOString() };
    res.json(ok(body));
  });
  return router;
}
