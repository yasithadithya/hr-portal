import { createClient } from '@supabase/supabase-js';

import { AppError } from './errors';

/** The subset of Supabase Auth admin the API uses. Tests inject a fake. */
export interface AuthAdmin {
  /** Sends an invite email; returns the Auth user id. Re-inviting a pending user resends. */
  inviteUser(email: string, redirectTo: string): Promise<{ authUserId: string }>;
}

export function supabaseAuthAdmin(
  supabaseUrl: string | null,
  serviceRoleKey: string | null,
): AuthAdmin {
  return {
    async inviteUser(email, redirectTo) {
      if (!supabaseUrl || !serviceRoleKey) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Auth is not configured for this workspace');
      }
      const client = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error || !data.user) {
        if (error?.status === 422 || /already been registered/i.test(error?.message ?? '')) {
          throw new AppError(
            409,
            'CONFLICT',
            'This email already has an account in this workspace',
          );
        }
        throw new AppError(
          502,
          'INTERNAL_ERROR',
          `Could not send invite: ${error?.message ?? 'unknown'}`,
        );
      }
      return { authUserId: data.user.id };
    },
  };
}
