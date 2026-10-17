'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { ErrorAlert } from '@/components/common/error-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';

import { AuthCard } from './auth-card';
import { PasswordForm } from './password-form';

/** Invite acceptance and password recovery: the emailed link signs the user in, then they set a password. */
export function SetPasswordPage({ mode }: { mode: 'invite' | 'reset' }) {
  const { supabase, session, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);

  const title = mode === 'invite' ? 'Welcome! Set your password' : 'Choose a new password';

  if (loading) {
    return (
      <AuthCard title={title}>
        <Skeleton className="h-32 w-full" />
      </AuthCard>
    );
  }
  if (!session) {
    return (
      <AuthCard
        title="This link has expired"
        description="Links work once and expire after an hour."
      >
        <p className="text-sm">
          {mode === 'invite' ? 'Ask your HR team to resend the invite, or ' : ''}
          <Link href="/forgot-password" className="underline">
            request a new link
          </Link>
          .
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={title} description={session.user.email}>
      <div className="space-y-4">
        <ErrorAlert error={error} />
        <PasswordForm
          submitLabel={mode === 'invite' ? 'Set password and continue' : 'Update password'}
          onSubmit={async (password) => {
            setError(null);
            const { error: err } = await supabase!.auth.updateUser({ password });
            if (err) {
              setError(err);
              return;
            }
            toast.success('Password saved');
            router.replace('/');
          }}
        />
      </div>
    </AuthCard>
  );
}
