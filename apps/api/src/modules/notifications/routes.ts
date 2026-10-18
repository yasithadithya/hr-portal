import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { getOrCreateVapidKeys, type ControlDb } from '@hr/control-db';
import { schema } from '@hr/db';
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  ok,
  preferencesUpdateSchema,
  pushSubscriptionInputSchema,
  type AppNotification,
} from '@hr/shared';

import { authedCtx } from '../../context';
import { AppError } from '../../lib/errors';
import { generateVapidKeys } from '../../lib/push';
import { parsed, validate } from '../../middleware/validate';

import { unreadCount } from './notify';

const { notificationPreferences, notifications, pushSubscriptions } = schema;
const idParams = { params: z.object({ id: z.uuid() }) };

const dto = (n: typeof notifications.$inferSelect): AppNotification => ({
  id: n.id,
  event: n.event,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/** Every signed-in user manages only their own notifications (no permission needed). */
export function notificationRoutes(deps: { control: ControlDb; masterKey: Buffer }): Router {
  const router = Router();

  const listSchemas = {
    query: z.object({
      unread: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  };
  router.get('/notifications', validate(listSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { query } = parsed(req, listSchemas);
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          query.unread === 'true' ? isNull(notifications.readAt) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(query.limit);
    res.json(ok({ unread: await unreadCount(ctx.db, ctx.user.id), items: rows.map(dto) }));
  });

  router.post('/notifications/:id/read', validate(idParams), async (req, res) => {
    const ctx = authedCtx(req);
    const { params } = parsed(req, idParams);
    const [row] = await ctx.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, params.id), eq(notifications.userId, ctx.user.id)))
      .returning();
    if (!row) throw AppError.notFound('Notification not found');
    res.json(ok(dto(row)));
  });

  router.post('/notifications/read-all', async (req, res) => {
    const ctx = authedCtx(req);
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    res.json(ok({ unread: 0 }));
  });

  router.get('/notifications/preferences', async (req, res) => {
    const ctx = authedCtx(req);
    const rows = await ctx.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id));
    res.json(
      ok(
        NOTIFICATION_EVENT_KEYS.map((event) => {
          const p = rows.find((r) => r.event === event);
          return {
            event,
            label: NOTIFICATION_EVENTS[event],
            email: p?.email ?? true,
            push: p?.push ?? true,
          };
        }),
      ),
    );
  });

  const prefSchemas = { body: preferencesUpdateSchema };
  router.put('/notifications/preferences', validate(prefSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, prefSchemas);
    for (const p of body.preferences) {
      await ctx.db
        .insert(notificationPreferences)
        .values({ userId: ctx.user.id, event: p.event, email: p.email, push: p.push })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.event],
          set: { email: p.email, push: p.push, updatedAt: new Date() },
        });
    }
    res.json(ok({ saved: body.preferences.length }));
  });

  // ── Web push ───────────────────────────────────────────────────────────────
  /** The tenant's VAPID public key (created on first request). */
  router.get('/push/public-key', async (req, res) => {
    const ctx = authedCtx(req);
    const keys = await getOrCreateVapidKeys(
      deps.control,
      ctx.tenant.id,
      deps.masterKey,
      generateVapidKeys,
    );
    res.json(ok({ publicKey: keys.publicKey }));
  });

  const subSchemas = { body: pushSubscriptionInputSchema };
  router.post('/push/subscriptions', validate(subSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, subSchemas);
    await ctx.db
      .insert(pushSubscriptions)
      .values({
        userId: ctx.user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      })
      // A browser endpoint belongs to whoever subscribed last on that device.
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: ctx.user.id,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          updatedAt: new Date(),
        },
      });
    res.status(201).json(ok({ subscribed: true }));
  });

  const unsubSchemas = { body: z.object({ endpoint: z.url().max(1000) }) };
  router.post('/push/unsubscribe', validate(unsubSchemas), async (req, res) => {
    const ctx = authedCtx(req);
    const { body } = parsed(req, unsubSchemas);
    await ctx.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, ctx.user.id),
        ),
      );
    res.json(ok({ subscribed: false }));
  });

  return router;
}
