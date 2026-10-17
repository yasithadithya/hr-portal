import { z } from 'zod';

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  time: z.iso.datetime(),
});

export type Health = z.infer<typeof healthSchema>;
