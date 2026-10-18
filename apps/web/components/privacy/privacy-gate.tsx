'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const privacySchema = z.object({
  notice: z.string().nullable(),
  version: z.number().int(),
  acknowledgedVersion: z.number().int().nullable(),
  acknowledgedAt: z.string().nullable(),
  mustAcknowledge: z.boolean(),
});

export const usePrivacy = (enabled = true) =>
  useQuery({
    queryKey: ['privacy'],
    queryFn: ({ signal }) => api.get('/api/v1/privacy', privacySchema, { signal }),
    enabled,
    staleTime: 5 * 60_000,
  });

/**
 * PDPA: when the company has published a privacy notice, every user reads and acknowledges the
 * current version once (again whenever HR raises the version). Cannot be dismissed otherwise.
 */
export function PrivacyGate() {
  const { me } = useAuth();
  const privacy = usePrivacy(!!me);
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: (version: number) =>
      api.post('/api/v1/privacy/acknowledge', z.unknown(), { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy'] }),
  });
  const p = privacy.data;
  if (!p?.mustAcknowledge || !p.notice) return null;
  return (
    <Dialog open>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Privacy notice</DialogTitle>
          <DialogDescription>How {me?.tenant.name} uses your personal data.</DialogDescription>
        </DialogHeader>
        <div className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="privacy-notice">
          {p.notice}
        </div>
        <DialogFooter>
          <Button disabled={ack.isPending} onClick={() => ack.mutate(p.version)}>
            I have read this notice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
