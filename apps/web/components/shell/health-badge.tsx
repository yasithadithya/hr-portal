'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { healthSchema } from '@hr/shared';

export function HealthBadge() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.get('/health', healthSchema, { signal }),
    refetchInterval: 30_000,
  });

  const state = isPending ? 'checking' : isError ? 'down' : 'ok';
  const label = {
    checking: 'Checking API…',
    down: 'API unreachable',
    ok: `API OK · v${data?.version ?? ''}`,
  }[state];

  return (
    <span
      data-testid="api-health"
      data-state={state}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          state === 'ok' && 'bg-success',
          state === 'down' && 'bg-destructive',
          state === 'checking' && 'bg-muted-foreground animate-pulse',
        )}
      />
      {label}
    </span>
  );
}
