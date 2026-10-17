'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { OrgChartNode } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgChart } from '@/lib/queries/employees';

function Node({
  node,
  children,
  depth,
  filter,
}: {
  node: OrgChartNode;
  children: Map<string | null, OrgChartNode[]>;
  depth: number;
  filter: string;
}) {
  const kids = children.get(node.id) ?? [];
  const [open, setOpen] = useState(depth < 2);
  const match = !filter || node.name.toLowerCase().includes(filter);
  return (
    <li className="space-y-1">
      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 ${match ? '' : 'opacity-40'}`}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            className="text-muted-foreground w-4 text-xs"
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <div className="min-w-0">
          <Link href={`/employees/${node.id}`} className="font-medium hover:underline">
            {node.name}
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            {[node.designation, node.department].filter(Boolean).join(' · ') || node.employeeNo}
          </p>
        </div>
        {kids.length > 0 && (
          <span className="text-muted-foreground ml-auto text-xs">{kids.length}</span>
        )}
      </div>
      {open && kids.length > 0 && (
        <ul className="ml-5 space-y-1 border-l pl-4">
          {kids.map((k) => (
            <Node key={k.id} node={k} children={children} depth={depth + 1} filter={filter} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChartPage() {
  const chart = useOrgChart();
  const [filter, setFilter] = useState('');
  const nodes = chart.data ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, OrgChartNode[]>();
  for (const n of nodes) {
    // Anyone whose manager isn't visible (or left) becomes a root.
    const parent = n.reportsToId && ids.has(n.reportsToId) ? n.reportsToId : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  return (
    <RequirePermission permission="employees.read" scope="team">
      <PageHeader title="Org chart" description="Who reports to whom (current staff)" />
      <Input
        aria-label="Find a person"
        placeholder="Find a person…"
        className="mb-4 max-w-sm"
        value={filter}
        onChange={(e) => setFilter(e.target.value.toLowerCase())}
      />
      {chart.error && <ErrorAlert error={chart.error} />}
      {!chart.data ? (
        <Skeleton className="h-64" />
      ) : (
        <ul className="space-y-1" aria-label="Org chart">
          {(children.get(null) ?? []).map((n) => (
            <Node key={n.id} node={n} children={children} depth={0} filter={filter} />
          ))}
        </ul>
      )}
    </RequirePermission>
  );
}
