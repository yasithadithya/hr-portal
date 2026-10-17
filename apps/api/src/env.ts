import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** Express `trust proxy`: the web app (and any load balancer) forwards X-Forwarded-Host. */
  TRUST_PROXY: z.string().default('loopback'),
  /** Control-plane Postgres (runtime: transaction pooler URL). Required outside tests. */
  CONTROL_DATABASE_URL: z.string().optional(),
  /** 32 bytes, base64. Decrypts tenant secrets. */
  MASTER_KEY: z.string().optional(),
  /** Control-plane Supabase project URL; platform admins authenticate against its Auth. */
  CONTROL_SUPABASE_URL: z.string().optional(),
  TENANT_MAX_POOLS: z.coerce.number().int().positive().default(50),
  TENANT_POOL_SIZE: z.coerce.number().int().positive().default(5),
  TENANT_POOL_IDLE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60_000),
});

export type Env = z.infer<typeof envSchema>;

/** Parses env vars and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
