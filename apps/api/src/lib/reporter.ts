import { randomUUID } from 'node:crypto';

/**
 * Error reporting (PLAN.md Phase 10: Sentry, tagged with the tenant slug). Posts events to the
 * Sentry envelope endpoint directly — no SDK, so no extra transitive dependencies. Inactive unless
 * SENTRY_DSN is set. Sends only the error, its stack and tags: never request bodies (HR data).
 */
interface Dsn {
  url: string;
  key: string;
}

let dsn: Dsn | null = null;
let base = { environment: 'development', release: '0.0.0' };

function parseDsn(raw: string): Dsn {
  const u = new URL(raw);
  const project = u.pathname.replace(/^\//, '');
  return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
}

export function initReporter(opts: {
  dsn: string | undefined;
  environment: string;
  release: string;
}) {
  if (!opts.dsn) return;
  dsn = parseDsn(opts.dsn);
  base = { environment: opts.environment, release: opts.release };
}

function frames(stack: string | undefined) {
  return (stack ?? '')
    .split('\n')
    .slice(1, 30)
    .map((line) => {
      const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      return m
        ? { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }
        : { function: line.trim() };
    })
    .reverse();
}

export function reportError(
  err: unknown,
  context: {
    tenant?: string | null | undefined;
    requestId?: string | null | undefined;
    job?: string;
  },
) {
  if (!dsn) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    server_name: 'api',
    environment: base.environment,
    release: base.release,
    tags: {
      ...(context.tenant ? { tenant: context.tenant } : {}),
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.job ? { job: context.job } : {}),
    },
    exception: {
      values: [{ type: e.name, value: e.message, stacktrace: { frames: frames(e.stack) } }],
    },
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  // Fire and forget: reporting must never slow down or break a request.
  void fetch(dsn.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': `Sentry sentry_version=7, sentry_client=hr-portal/1.0, sentry_key=${dsn.key}`,
    },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
