'use client';

import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { ImportWizard } from '@/components/imports/import-wizard';

export default function ImportEmployeesPage() {
  return (
    <RequirePermission permission="employees.create" scope="all">
      <PageHeader
        title="Import employees"
        description="Bring in your existing staff list from Excel or CSV"
      />
      <ImportWizard kind="employees" />
    </RequirePermission>
  );
}
