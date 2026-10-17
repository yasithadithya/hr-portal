'use client';

import { useQuery } from '@tanstack/react-query';

import { publicTenantSchema } from '@hr/shared';

import { api } from './api';

/** Branding + Supabase public config for the workspace on this host. */
export function usePublicTenant() {
  return useQuery({
    queryKey: ['public-tenant'],
    queryFn: ({ signal }) => api.get('/api/v1/public/tenant', publicTenantSchema, { signal }),
    staleTime: 5 * 60_000,
  });
}
