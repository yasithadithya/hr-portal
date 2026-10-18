import { eq } from 'drizzle-orm';

import { schema, type TenantDb, type Tx } from '@hr/db';

/** v1 approval flows (PLAN.md Phase 5): direct manager → (optional) HR. Shared by leave and attendance. */
export type Step = 'manager' | 'hr';
export type ApprovalModule = 'leave' | 'attendance';

export interface TrailEntry {
  step: number;
  by: string;
  action: string;
  at: string;
  note?: string;
}

export async function approvalSteps(db: TenantDb | Tx, module: ApprovalModule): Promise<Step[]> {
  const [f] = await db
    .select()
    .from(schema.approvalFlows)
    .where(eq(schema.approvalFlows.module, module));
  return (f?.steps as Step[] | undefined)?.length ? (f!.steps as Step[]) : ['manager'];
}

/**
 * First actionable step at or after `from`. A manager step is skipped when the employee has no
 * manager (falls through to HR); if nothing is left, the request is decided.
 */
export function nextStep(
  steps: Step[],
  from: number,
  e: { reportsToId: string | null },
): { step: number; approver: string | null } | null {
  for (let i = from; i < steps.length; i++) {
    if (steps[i] === 'manager' && e.reportsToId) return { step: i, approver: e.reportsToId };
    if (steps[i] === 'hr') return { step: i, approver: null };
  }
  // No manager and no HR step: HR still has to decide.
  return from === 0 ? { step: steps.length, approver: null } : null;
}

/** What a pending request is waiting for (for DTOs). */
export function waitingFor(
  status: string,
  currentApprover: string | null,
  steps: Step[],
  currentStep: number,
): string | null {
  if (status !== 'pending') return null;
  return currentApprover ? 'manager' : (steps[currentStep] ?? 'hr');
}
