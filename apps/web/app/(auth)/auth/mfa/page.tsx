'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import { ErrorAlert } from '@/components/common/error-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/utils';

interface MfaSetup {
  factorId: string;
  /** Present only when a new factor was just enrolled (show the QR code). */
  enrolment: { qrCode: string; secret: string } | null;
}

/** Uses the verified TOTP factor if there is one, otherwise enrols a new one. */
async function prepareMfa(supabase: SupabaseClient): Promise<MfaSetup> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const verified = data.totp.find((f) => f.status === 'verified');
  if (verified) return { factorId: verified.id, enrolment: null };
  const enrolled = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });
  if (enrolled.error) throw enrolled.error;
  return {
    factorId: enrolled.data.id,
    enrolment: { qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret },
  };
}

function Mfa() {
  const { supabase, session, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = safeNext(useSearchParams().get('next'));
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const setup = useQuery({
    queryKey: ['mfa-setup', session?.user.id],
    queryFn: () => prepareMfa(supabase!),
    enabled: !!supabase && !!session,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !setup.data) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: setup.data.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (err) {
      setError(new Error('That code did not work. Try the latest one from your app.'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    router.replace(next);
  }

  if (!setup.data) {
    return (
      <AuthCard title="Two-factor authentication">
        <ErrorAlert error={setup.error} />
        <Skeleton className="h-40 w-full" />
      </AuthCard>
    );
  }
  const { enrolment } = setup.data;
  return (
    <AuthCard
      title={enrolment ? 'Set up two-factor authentication' : 'Enter your authentication code'}
      description={
        enrolment
          ? 'Scan this with Google Authenticator, Microsoft Authenticator or similar, then enter the 6-digit code.'
          : 'Open your authenticator app and enter the 6-digit code.'
      }
    >
      <form className="space-y-4" onSubmit={verify}>
        <ErrorAlert error={error} />
        {enrolment && (
          <div className="space-y-2 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Supabase */}
            <img
              src={enrolment.qrCode}
              alt="QR code for your authenticator app"
              className="mx-auto size-44 rounded bg-white p-2"
            />
            <p className="text-muted-foreground text-xs break-all">
              Can&apos;t scan? Enter this key: <code>{enrolment.secret}</code>
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
          Verify
        </Button>
      </form>
    </AuthCard>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <Mfa />
    </Suspense>
  );
}
