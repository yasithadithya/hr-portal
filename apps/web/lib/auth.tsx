'use client';

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { can, meSchema, type Me, type PermissionKey, type Scope } from '@hr/shared';

import { api, ApiError, setTokenProvider } from './api';
import { clearOfflineCache } from './offline';
import { getSupabase } from './supabase';
import { usePublicTenant } from './tenant';

interface AuthState {
  supabase: SupabaseClient | null;
  session: Session | null;
  /** True until the stored session (if any) has been read. */
  loading: boolean;
  me: Me | undefined;
  meError: ApiError | null;
  /** The workspace config itself could not be loaded (unknown host, server down). */
  tenantError: unknown;
  retryTenant: () => void;
  can: (key: PermissionKey, scope?: Scope) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: tenant, error: tenantError, refetch: refetchTenant } = usePublicTenant();
  const queryClient = useQueryClient();
  // getSupabase caches per project, so this is a stable reference across renders.
  const supabase =
    tenant?.supabaseUrl && tenant.supabaseAnonKey
      ? getSupabase(tenant.supabaseUrl, tenant.supabaseAnonKey)
      : null;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    setTokenProvider(
      async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    );
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, queryClient]);

  const meQuery = useQuery({
    queryKey: ['me', session?.user.id ?? null],
    queryFn: ({ signal }) => api.get('/api/v1/me', meSchema, { signal }),
    enabled: !!session,
    retry: false,
    staleTime: 60_000,
  });

  const value: AuthState = {
    supabase,
    session,
    loading: !tenantError && (loading || !supabase),
    tenantError,
    retryTenant: () => void refetchTenant(),
    me: session ? meQuery.data : undefined,
    meError: meQuery.error instanceof ApiError ? meQuery.error : null,
    can: (key, scope = 'self') => !!meQuery.data && can(meQuery.data.permissions, key, scope),
    signOut: async () => {
      clearOfflineCache();
      await supabase?.auth.signOut();
      queryClient.clear();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
