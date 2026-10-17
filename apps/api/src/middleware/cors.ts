import cors from 'cors';

/**
 * Decides whether a browser origin may call the API.
 * Phase 1 replaces the static allowlist with a tenant-domain lookup.
 */
export type OriginCheck = (origin: string) => boolean | Promise<boolean>;

export function allowlistOrigins(origins: readonly string[]): OriginCheck {
  const set = new Set(origins);
  return (origin) => set.has(origin);
}

export function corsMiddleware(isOriginAllowed: OriginCheck) {
  return cors({
    credentials: true,
    exposedHeaders: ['x-request-id'],
    origin: (origin, callback) => {
      // Non-browser clients (curl, server-to-server) send no Origin header.
      if (!origin) return callback(null, true);
      Promise.resolve(isOriginAllowed(origin)).then(
        (allowed) => callback(null, allowed),
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
      );
    },
  });
}
