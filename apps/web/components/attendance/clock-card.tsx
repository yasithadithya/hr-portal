'use client';

import { LogIn, LogOut, MapPin, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ClockResult } from '@hr/shared';

import {
  fmtDate,
  fmtMinutes,
  fmtTime,
  StatusBadge,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useClock, useToday } from '@/lib/queries/attendance';

/** Browser online state (punches are never queued offline: geofence integrity). */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

type Position = { lat: number; lng: number; accuracy: number } | { error: string };

/** Browser location with readable failure reasons (sent to the API so HR sees why). */
function locate(): Promise<Position> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ error: 'this browser cannot share location' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        resolve({
          error:
            err.code === err.PERMISSION_DENIED
              ? 'location permission denied'
              : err.code === err.TIMEOUT
                ? 'location timed out'
                : 'location unavailable',
        }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export function ClockCard() {
  const tz = useTenantTz();
  const today = useToday();
  const clock = useClock();
  const [result, setResult] = useState<ClockResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const t = today.data;
  const online = useOnline();

  async function onClock() {
    setResult(null);
    setError(null);
    let pos: Position | null = null;
    if (t?.checks.geofence) {
      setLocating(true);
      pos = await locate();
      setLocating(false);
    }
    const standalone =
      typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    clock.mutate(
      {
        source: standalone ? 'pwa' : 'web',
        ...(pos && 'lat' in pos
          ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }
          : pos
            ? { locationError: pos.error }
            : {}),
      },
      { onSuccess: setResult, onError: (e) => setError(errorMessage(e)) },
    );
  }

  if (today.error) return <ErrorAlert error={today.error} />;
  if (!t) return <Skeleton className="h-48" />;
  if (!t.linked)
    return (
      <Alert>
        <AlertTitle>No employee record</AlertTitle>
        <AlertDescription>
          Your account is not linked to an employee, so you cannot clock in.
        </AlertDescription>
      </Alert>
    );

  const accepted = t.punches.filter((p) => p.accepted);
  const busy = clock.isPending || locating;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Today · {fmtDate(t.date)}</CardTitle>
        <CardDescription>
          {t.shift
            ? `${t.shift.name}: ${t.shift.startTime}–${t.shift.endTime}`
            : 'No shift assigned'}
          {t.checks.geofence && (
            <span className="ml-2 inline-flex items-center gap-1">
              <MapPin className="size-3" /> location needed
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button
            size="lg"
            className="h-14 min-w-44 text-base"
            disabled={busy || !t.canClock || !online}
            onClick={onClock}
            data-testid="clock-button"
          >
            {t.nextAction === 'in' ? <LogIn /> : <LogOut />}
            {locating ? 'Getting location…' : t.nextAction === 'in' ? 'Clock in' : 'Clock out'}
          </Button>
          <div className="text-sm">
            <p>
              In: <span className="font-medium">{fmtTime(accepted[0]?.at ?? null, tz)}</span>
              {accepted.length > 1 && (
                <>
                  {' '}
                  · Out:{' '}
                  <span className="font-medium">
                    {fmtTime(accepted[accepted.length - 1]!.at, tz)}
                  </span>
                </>
              )}
            </p>
            {t.day && t.day.status !== 'absent' && (
              <p className="text-muted-foreground">
                <StatusBadge status={t.day.status} />{' '}
                {t.day.lateMinutes > 0 && `late ${fmtMinutes(t.day.lateMinutes)}`}
              </p>
            )}
          </div>
        </div>
        {!online && (
          <Alert data-testid="clock-offline">
            <WifiOff className="size-4" />
            <AlertTitle>You’re offline</AlertTitle>
            <AlertDescription>
              Clocking in needs a connection so your location and time can be checked. Try again
              when you’re back online.
            </AlertDescription>
          </Alert>
        )}
        {result && (
          <Alert
            variant={result.accepted ? 'default' : 'destructive'}
            data-testid={result.accepted ? 'clock-accepted' : 'clock-rejected'}
          >
            <AlertTitle>
              {result.accepted
                ? `Clocked ${t.nextAction === 'in' ? 'out' : 'in'} at ${fmtTime(result.punch.at, tz)}`
                : 'Clock-in not accepted'}
            </AlertTitle>
            {!result.accepted && <AlertDescription>{result.message}</AlertDescription>}
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {t.punches.some((p) => !p.accepted) && (
          <p className="text-muted-foreground text-xs">
            Rejected attempts today:{' '}
            {t.punches
              .filter((p) => !p.accepted)
              .map((p) => fmtTime(p.at, tz))
              .join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
