import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-auth';
import { PrivacyGate } from '@/components/privacy/privacy-gate';
import { Brand, BrandColor, SidebarNav } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <BrandColor />
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 border-r md:block">
        <Brand />
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-4 md:p-6">
          <RequireAuth>
            <PrivacyGate />
            {children}
          </RequireAuth>
        </main>
      </div>
    </div>
  );
}
