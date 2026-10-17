'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';

import { Forbidden } from './forbidden';

/** Signed-in gate for the app shell. Sends people to /login or /auth/mfa as needed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, me, meError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (meError?.code === 'MFA_REQUIRED')
      router.replace(`/auth/mfa?next=${encodeURIComponent(pathname)}`);
    else if (meError?.status === 401) router.replace('/login');
  }, [loading, session, meError, router, pathname]);

  if (meError && meError.status === 403 && meError.code !== 'MFA_REQUIRED') {
    return <Forbidden message={meError.message} />;
  }
  if (loading || !session || !me) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}
