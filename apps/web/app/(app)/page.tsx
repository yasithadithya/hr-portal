import { HealthBadge } from '@/components/shell/health-badge';

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">
        The HR dashboard arrives in Phase 9. For now this page checks the API.
      </p>
      <HealthBadge />
    </div>
  );
}
