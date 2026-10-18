'use client';

import { BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { NotificationPreference } from '@hr/shared';

import { errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  pushSupported,
  usePreferences,
  useSavePreferences,
} from '@/lib/queries/notifications';

/** HR-only reminder events are hidden from people who can't receive them. */
const HR_EVENTS = new Set([
  'profile.change_submitted',
  'reminder.document_expiring',
  'reminder.probation_ending',
  'reminder.contract_ending',
]);

function PushCard() {
  // Support is known on first client render; the current subscription is read asynchronously.
  const [supported] = useState(() => pushSupported());
  const [state, setState] = useState<'unknown' | 'unsupported' | 'on' | 'off'>(
    supported ? 'unknown' : 'unsupported',
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supported) return;
    void currentPushSubscription().then((s) => setState(s ? 'on' : 'off'));
  }, [supported]);
  const toggle = async () => {
    setBusy(true);
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
        toast.success('Notifications turned off on this device');
      } else {
        await enablePush();
        setState('on');
        toast.success('Notifications turned on for this device');
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4" /> Notifications on this device
        </CardTitle>
        <CardDescription>
          Get a phone or desktop notification when something needs you — even when the app is
          closed. On iPhone, add the app to your Home Screen first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state === 'unsupported' ? (
          <p className="text-muted-foreground text-sm">
            This browser doesn’t support push notifications.
          </p>
        ) : (
          <Button
            onClick={toggle}
            disabled={busy || state === 'unknown'}
            variant={state === 'on' ? 'outline' : 'default'}
            data-testid="push-toggle"
          >
            {state === 'on' ? 'Turn off on this device' : 'Turn on for this device'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function NotificationSettingsPage() {
  const { can } = useAuth();
  const prefs = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<NotificationPreference[] | null>(null);
  const isHr = can('employees.update', 'all') || can('documents.manage', 'all');
  const rows = (draft ?? prefs.data ?? []).filter((p) => isHr || !HR_EVENTS.has(p.event));
  const set = (event: string, k: 'email' | 'push', v: boolean) =>
    setDraft((draft ?? prefs.data ?? []).map((p) => (p.event === event ? { ...p, [k]: v } : p)));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Notifications"
        description="You always see notifications in the app (the bell)."
      />
      <PushCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What to send</CardTitle>
        </CardHeader>
        <CardContent>
          {!prefs.data ? (
            <Skeleton className="h-48" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead className="w-20 text-center">Email</TableHead>
                    <TableHead className="w-20 text-center">Push</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.event}>
                      <TableCell>{p.label}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          aria-label={`Email: ${p.label}`}
                          checked={p.email}
                          onCheckedChange={(v) => set(p.event, 'email', v)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          aria-label={`Push: ${p.label}`}
                          checked={p.push}
                          onCheckedChange={(v) => set(p.event, 'push', v)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                className="mt-4"
                disabled={!draft || save.isPending}
                onClick={() =>
                  save.mutate(
                    draft!.map(({ event, email, push }) => ({ event, email, push })),
                    { onSuccess: () => setDraft(null) },
                  )
                }
              >
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
