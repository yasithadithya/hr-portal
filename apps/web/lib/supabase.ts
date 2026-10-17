'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let clientKey = '';

/**
 * Browser Supabase client for THIS workspace's own project (URL + anon key come from
 * /api/v1/public/tenant). Used for Auth only; data always goes through the API (Hard Rule 5).
 * Implicit flow so invite / recovery / magic links work from any device.
 */
export function getSupabase(url: string, anonKey: string): SupabaseClient {
  const key = `${url}|${anonKey}`;
  if (!client || clientKey !== key) {
    client = createClient(url, anonKey, {
      auth: {
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `hr-auth-${new URL(url).host}`,
      },
    });
    clientKey = key;
  }
  return client;
}
