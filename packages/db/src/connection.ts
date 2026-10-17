import postgres, { type Options, type Sql } from 'postgres';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

export interface ConnectOptions {
  /** Max connections in this pool. */
  max?: number;
  /** Seconds before an idle connection is closed. */
  idleTimeout?: number;
  /** Extra postgres.js options (tests use `onnotice`). */
  extra?: Options<Record<string, never>>;
}

/**
 * Normalises a Postgres URL for postgres.js:
 * - drops Prisma-only params (`pgbouncer`, `connection_limit`) that Postgres would reject
 * - decides SSL: honours `sslmode`, otherwise requires TLS for non-local hosts
 */
export function normaliseUrl(raw: string): { url: string; ssl: Options<never>['ssl'] } {
  const u = new URL(raw);
  for (const p of ['pgbouncer', 'connection_limit', 'pool_timeout', 'schema']) {
    u.searchParams.delete(p);
  }
  const sslmode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  const ssl: Options<never>['ssl'] = sslmode
    ? sslmode === 'disable'
      ? false
      : (sslmode as 'require' | 'prefer' | 'allow' | 'verify-full')
    : LOCAL_HOSTS.has(u.hostname)
      ? false
      : 'require';
  return { url: u.toString(), ssl };
}

/**
 * Opens a postgres.js pool. `prepare: false` keeps it compatible with Supavisor/PgBouncer
 * transaction mode (port 6543), which is how the API talks to every tenant (PLAN.md §1).
 */
export function connect(rawUrl: string, opts: ConnectOptions = {}): Sql {
  const { url, ssl } = normaliseUrl(rawUrl);
  return postgres(url, {
    ssl,
    prepare: false,
    max: opts.max ?? 5,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: 10,
    onnotice: () => {},
    ...opts.extra,
  });
}
