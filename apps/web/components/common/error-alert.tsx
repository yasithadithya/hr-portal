import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export function ErrorAlert({
  error,
  title = 'Something went wrong',
}: {
  error: unknown;
  title?: string;
}) {
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}
