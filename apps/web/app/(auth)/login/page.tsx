'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthCard } from '@/components/auth/auth-card';
import { ErrorAlert } from '@/components/common/error-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/utils';

const passwordSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Required'),
});
const linkSchema = z.object({ email: z.email('Enter a valid email') });

function LoginForm() {
  const { supabase, session, me, meError } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<unknown>(null);
  const [linkSent, setLinkSent] = useState(false);

  const pw = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  const link = useForm<z.infer<typeof linkSchema>>({ resolver: zodResolver(linkSchema) });

  useEffect(() => {
    if (!session) return;
    if (meError?.code === 'MFA_REQUIRED')
      router.replace(`/auth/mfa?next=${encodeURIComponent(next)}`);
    else if (me) router.replace(next);
  }, [session, me, meError, next, router]);

  async function signIn(values: z.infer<typeof passwordSchema>) {
    setError(null);
    const { error: err } = await supabase!.auth.signInWithPassword(values);
    if (err) {
      setError(
        new Error(
          err.message === 'Invalid login credentials' ? 'Wrong email or password' : err.message,
        ),
      );
    }
  }

  async function sendLink(values: z.infer<typeof linkSchema>) {
    setError(null);
    const { error: err } = await supabase!.auth.signInWithOtp({
      email: values.email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${next}` },
    });
    // Same message either way: don't reveal whether the address has an account.
    if (err && err.status !== 400 && err.status !== 422) setError(err);
    else setLinkSent(true);
  }

  const notMember = session && meError?.status === 403 && meError.code !== 'MFA_REQUIRED';

  return (
    <AuthCard title="Sign in" description="Use the email your HR team invited.">
      <div className="space-y-4">
        {notMember && <ErrorAlert error={meError} title="No access" />}
        <ErrorAlert error={error} title="Could not sign in" />
        <Tabs defaultValue="password">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="link">Email link</TabsTrigger>
          </TabsList>
          <TabsContent value="password">
            <form className="space-y-4 pt-2" onSubmit={pw.handleSubmit(signIn)} noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" {...pw.register('email')} />
                {pw.formState.errors.email && (
                  <p className="text-destructive text-sm">{pw.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-muted-foreground text-sm hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...pw.register('password')}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!supabase || pw.formState.isSubmitting}
              >
                {pw.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="link">
            {linkSent ? (
              <Alert className="mt-2">
                <AlertDescription>
                  If that address has an account, a sign-in link is on its way. Check your inbox.
                </AlertDescription>
              </Alert>
            ) : (
              <form className="space-y-4 pt-2" onSubmit={link.handleSubmit(sendLink)} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="link-email">Email</Label>
                  <Input
                    id="link-email"
                    type="email"
                    autoComplete="email"
                    {...link.register('email')}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!supabase || link.formState.isSubmitting}
                >
                  Email me a sign-in link
                </Button>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
