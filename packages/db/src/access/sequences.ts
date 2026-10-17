import { eq, sql } from 'drizzle-orm';

import { formatSequence } from '@hr/shared';

import { numberSequences } from '../schema/index';

import type { Tx } from './audit';

/**
 * Takes the next number from a sequence (e.g. 'employee' → EMP-0042) inside the caller's
 * transaction. The UPDATE … RETURNING row-locks the sequence, so concurrent hires never get
 * the same number and a rolled-back hire doesn't burn one.
 */
export async function nextSequenceValue(tx: Tx, key: string): Promise<string> {
  const [row] = await tx
    .update(numberSequences)
    .set({ nextValue: sql`${numberSequences.nextValue} + 1`, updatedAt: new Date() })
    .where(eq(numberSequences.key, key))
    .returning();
  if (!row) throw new Error(`Number sequence "${key}" is not configured`);
  return formatSequence(row, row.nextValue - 1);
}
