import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'My HR' };

export default function MePage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">My HR</h1>
      <p className="text-muted-foreground">
        Self-service (leave, attendance, payslips) arrives in Phase 8.
      </p>
    </div>
  );
}
