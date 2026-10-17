import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4 text-center">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">You are offline</h1>
        <p className="text-muted-foreground text-sm">
          Check your connection and try again. Clock-in needs a connection.
        </p>
      </div>
    </main>
  );
}
