import { ShieldX } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function Forbidden({ message }: { message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-24 text-center"
      data-testid="forbidden"
    >
      <ShieldX className="text-muted-foreground size-10" />
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        {message ?? 'Ask an administrator if you think you should.'}
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
