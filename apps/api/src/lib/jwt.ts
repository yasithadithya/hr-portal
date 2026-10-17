import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import { AppError } from './errors';

/**
 * Verifies Supabase Auth access tokens against a project's JWKS (asymmetric keys).
 * Key sets are cached per URL; jose handles key rotation and refetch cooldown.
 */
export interface SupabaseClaims extends JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  aal?: string;
  session_id?: string;
}

export type JwksResolver = (jwksUrl: string) => JWTVerifyGetKey;

const remoteSets = new Map<string, JWTVerifyGetKey>();

export const remoteJwks: JwksResolver = (url) => {
  let set = remoteSets.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000 });
    remoteSets.set(url, set);
  }
  return set;
};

/** For tests: resolve every URL to a fixed local key set. */
export function localJwks(jwks: JSONWebKeySet): JwksResolver {
  const set = createLocalJWKSet(jwks);
  return () => set;
}

export async function verifySupabaseToken(
  token: string,
  jwksUrl: string,
  resolver: JwksResolver = remoteJwks,
): Promise<SupabaseClaims> {
  try {
    const { payload } = await jwtVerify(token, resolver(jwksUrl), {
      audience: 'authenticated',
      algorithms: ['ES256', 'RS256', 'EdDSA'],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string')
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid token');
    return payload as SupabaseClaims;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof errors.JWTExpired) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Session expired');
    }
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid token');
  }
}

export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m?.[1] ?? null;
}
