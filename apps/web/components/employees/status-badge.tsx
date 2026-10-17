import type { EmployeeStatus } from '@hr/shared';

import { Badge } from '@/components/ui/badge';

const VARIANT: Record<EmployeeStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  active: 'default',
  on_probation: 'secondary',
  notice: 'secondary',
  resigned: 'outline',
  terminated: 'destructive',
  retired: 'outline',
};

export function StatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={VARIANT[status]}>{status.replace('_', ' ')}</Badge>;
}
