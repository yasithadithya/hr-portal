import { z } from 'zod';

/** Public, unauthenticated tenant config the web app needs before login. */
export const publicTenantSchema = z.object({
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  timezone: z.string(),
  supabaseUrl: z.string().nullable(),
  supabaseAnonKey: z.string().nullable(),
  theme: z.object({ primaryColor: z.string().nullable() }),
});
export type PublicTenant = z.infer<typeof publicTenantSchema>;

export const TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'archived'] as const;

export const platformTenantSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  region: z.string().nullable(),
  timezone: z.string(),
  supabaseProjectRef: z.string().nullable(),
  createdAt: z.string(),
  domains: z.array(z.string()),
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export const setTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});
