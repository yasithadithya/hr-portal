import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-2 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-muted-foreground text-sm">Sign-in (Supabase Auth) arrives in Phase 2.</p>
      </div>
    </main>
  );
}
