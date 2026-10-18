import type { RequestHandler } from 'express';

import { AppError } from '../lib/errors';

/**
 * Fixed-window rate limiting (PLAN.md Phase 10: per tenant + per IP). In-memory per API instance:
 * with N instances the effective limit is N × the configured value, which is acceptable as abuse
 * protection (not billing). A shared store (Redis/Postgres) can replace `Bucket` later.
 */
interface Window {
  count: number;
  resetAt: number;
}

export class Bucket {
  private readonly windows = new Map<string, Window>();
  private sweepAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit; returns seconds to wait when over the limit, else 0. */
  hit(key: string): number {
    const t = this.now();
    if (t > this.sweepAt) {
      for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
      this.sweepAt = t + this.windowMs;
    }
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return w.count > this.limit ? Math.ceil((w.resetAt - t) / 1000) : 0;
  }
}

export interface RateLimitOptions {
  /** Requests per IP per minute (all routes). */
  perIp: number;
  /** Requests per tenant per minute (all users of one client together). */
  perTenant: number;
  /** Tighter per-IP limit for sensitive routes (exports, PDFs, clock-in, uploads). */
  sensitivePerIp: number;
  now?: () => number;
}

const SENSITIVE = [
  /\/export/,
  /\/pdf$/,
  /\/attendance\/clock$/,
  /\/documents$/,
  /\/photo$/,
  /\/attachment$/,
  /\/logo$/,
  /\/reports\/[^/]+$/,
  /\/data-export$/,
];

export function rateLimit(opts: RateLimitOptions): { ip: RequestHandler; tenant: RequestHandler } {
  const minute = 60_000;
  const ipBucket = new Bucket(opts.perIp, minute, opts.now);
  const sensitive = new Bucket(opts.sensitivePerIp, minute, opts.now);
  const tenantBucket = new Bucket(opts.perTenant, minute, opts.now);
  const tooMany = (retry: number, res: Parameters<RequestHandler>[1]) => {
    res.setHeader('Retry-After', String(retry));
    return new AppError(
      429,
      'RATE_LIMITED',
      'Too many requests — please wait a moment and try again',
    );
  };
  return {
    ip: (req, res, next) => {
      const ip = req.ip ?? 'unknown';
      const retry = ipBucket.hit(ip);
      if (retry) throw tooMany(retry, res);
      if (req.method !== 'OPTIONS' && SENSITIVE.some((r) => r.test(req.path))) {
        const r2 = sensitive.hit(ip);
        if (r2) throw tooMany(r2, res);
      }
      next();
    },
    /** Mounted after tenant resolution. */
    tenant: (req, res, next) => {
      const id = req.ctx?.tenant.id;
      if (id) {
        const retry = tenantBucket.hit(id);
        if (retry) throw tooMany(retry, res);
      }
      next();
    },
  };
}
