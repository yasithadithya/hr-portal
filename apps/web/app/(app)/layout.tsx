import type { ReactNode } from 'react';

import { Brand, SidebarNav } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 border-r md:block">
        <Brand />
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
