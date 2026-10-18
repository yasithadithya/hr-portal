'use client';

import * as Sentry from '@sentry/browser';

/**
 * Browser error reporting (PLAN.md Phase 10). Inactive unless NEXT_PUBLIC_SENTRY_DSN is set at
 * build time. No session replay, no breadcrumbs of inputs, no user identity: HR pages show
 * personal data, so only the error and the tenant slug are sent.
 */
let started = false;

export function startReporter(tenantSlug: string | null) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (!started) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      integrations: (defaults) => defaults.filter((i) => i.name !== 'Breadcrumbs'),
      beforeSend(event) {
        delete event.user;
        if (event.request) {
          delete event.request.headers;
          delete event.request.cookies;
        }
        return event;
      },
    });
    started = true;
  }
  if (tenantSlug) Sentry.setTag('tenant', tenantSlug);
}
