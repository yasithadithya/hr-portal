'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { AuthCard } from '@/components/auth/auth-card';
import { ErrorAlert } from '@/components/common/error-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const { supabase } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setBusy(false);
    if (err && err.status !== 400) setError(err);
    else setSent(true);
  }

  return (
    <AuthCard title="Reset your password" description="We will email you a link to set a new one.">
      {sent ? (
        <Alert>
          <AlertDescription>
            If that address has an account, a reset link is on its way.
          </AlertDescription>
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <ErrorAlert error={error} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={!supabase || busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
