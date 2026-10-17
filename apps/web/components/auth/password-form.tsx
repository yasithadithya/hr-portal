'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z
  .object({
    password: z
      .string()
      .min(10, 'At least 10 characters')
      .regex(/[a-z]/, 'Add a lowercase letter')
      .regex(/[A-Z]/, 'Add an uppercase letter')
      .regex(/\d/, 'Add a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

/** New-password form shared by invite acceptance and password reset. */
export function PasswordForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit((v) => onSubmit(v.password))}
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...form.register('password')}
        />
        {errors.password && <p className="text-destructive text-sm">{errors.password.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          {...form.register('confirm')}
        />
        {errors.confirm && <p className="text-destructive text-sm">{errors.confirm.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
