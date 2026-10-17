'use client';

import { Columns3, Download, FileUp, Network, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type EmployeeListItem,
  type EmployeeListQuery,
} from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/employees/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { exportEmployees, useEmployees } from '@/lib/queries/employees';
import { useRefList } from '@/lib/queries/org';

type ColKey =
  | 'employeeNo'
  | 'designation'
  | 'department'
  | 'branch'
  | 'status'
  | 'employmentType'
  | 'joinDate'
  | 'workEmail';
const COLUMNS: { key: ColKey; label: string; render: (e: EmployeeListItem) => React.ReactNode }[] =
  [
    {
      key: 'employeeNo',
      label: 'No',
      render: (e) => <span className="font-mono text-xs">{e.employeeNo}</span>,
    },
    { key: 'designation', label: 'Designation', render: (e) => e.designation ?? '—' },
    { key: 'department', label: 'Department', render: (e) => e.department ?? '—' },
    { key: 'branch', label: 'Branch', render: (e) => e.branch ?? '—' },
    { key: 'status', label: 'Status', render: (e) => <StatusBadge status={e.status} /> },
    { key: 'employmentType', label: 'Type', render: (e) => e.employmentType.replace('_', ' ') },
    { key: 'joinDate', label: 'Joined', render: (e) => e.joinDate },
    { key: 'workEmail', label: 'Work email', render: (e) => e.workEmail ?? '—' },
  ];
const DEFAULT_COLS: ColKey[] = ['employeeNo', 'designation', 'department', 'status', 'joinDate'];
const COLS_KEY = 'hr.employees.columns';

function loadCols(): ColKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as ColKey[] | null;
    return Array.isArray(v) && v.length ? v : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function EmployeesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [query, setQuery] = useState<EmployeeListQuery>({
    status: 'current',
    page: 1,
    pageSize: 25,
    sort: 'employeeNo',
    dir: 'asc',
  });
  const [search, setSearch] = useState('');
  const [cols, setCols] = useState<ColKey[]>(() =>
    typeof window === 'undefined' ? DEFAULT_COLS : loadCols(),
  );
  const list = useEmployees(query);
  const departments = useRefList('departments');
  const branches = useRefList('branches');
  const set = (patch: Partial<EmployeeListQuery>) => setQuery((q) => ({ ...q, page: 1, ...patch }));
  const toggleCol = (k: ColKey) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : [...cols, k];
    setCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode) — keep in memory only
    }
  };
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (query.pageSize ?? 25)));
  const page = query.page ?? 1;
  const sortBy = (sort: NonNullable<EmployeeListQuery['sort']>) =>
    set({ sort, dir: query.sort === sort && query.dir === 'asc' ? 'desc' : 'asc' });

  return (
    <RequirePermission permission="employees.read" scope="team">
      <PageHeader
        title="Employees"
        description={list.data ? `${total} ${total === 1 ? 'person' : 'people'}` : undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/employees/org-chart">
                <Network /> Org chart
              </Link>
            </Button>
            {can('employees.create', 'all') && (
              <>
                <Button variant="outline" asChild>
                  <Link href="/employees/import">
                    <FileUp /> Import
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/employees/new">
                    <UserPlus /> Add employee
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: search || undefined });
          }}
        >
          <Input
            aria-label="Search employees"
            placeholder="Search name, number or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => set({ q: search || undefined })}
            className="min-w-48"
          />
        </form>
        <Select
          label="Status"
          value={query.status ?? 'current'}
          onChange={(v) => set({ status: v as EmployeeListQuery['status'] })}
          options={[
            { value: 'current', label: 'Current staff' },
            { value: 'all', label: 'Everyone' },
            ...EMPLOYEE_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') })),
          ]}
        />
        <Select
          label="Department"
          value={query.departmentId ?? ''}
          onChange={(v) => set({ departmentId: v || undefined })}
          options={[
            { value: '', label: 'All departments' },
            ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <Select
          label="Branch"
          value={query.branchId ?? ''}
          onChange={(v) => set({ branchId: v || undefined })}
          options={[
            { value: '', label: 'All branches' },
            ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <Select
          label="Employment type"
          value={query.employmentType ?? ''}
          onChange={(v) =>
            set({ employmentType: (v || undefined) as EmployeeListQuery['employmentType'] })
          }
          options={[
            { value: '', label: 'All types' },
            ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') })),
          ]}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Choose columns">
              <Columns3 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={cols.includes(c.key)}
                onCheckedChange={() => toggleCol(c.key)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="icon"
          aria-label="Export CSV"
          onClick={() =>
            exportEmployees({ ...query, page: undefined, pageSize: undefined }).catch((e) =>
              toast.error(errorMessage(e)),
            )
          }
        >
          <Download />
        </Button>
      </div>

      {list.error && <ErrorAlert error={list.error} />}
      {!list.data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="font-medium" onClick={() => sortBy('name')}>
                      Name {query.sort === 'name' ? (query.dir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  </TableHead>
                  {COLUMNS.filter((c) => cols.includes(c.key)).map((c) => (
                    <TableHead key={c.key}>
                      {c.key === 'employeeNo' || c.key === 'joinDate' || c.key === 'department' ? (
                        <button
                          className="font-medium"
                          onClick={() => sortBy(c.key as 'employeeNo')}
                        >
                          {c.label} {query.sort === c.key ? (query.dir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      ) : (
                        c.label
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={cols.length + 1}
                      className="text-muted-foreground py-10 text-center"
                    >
                      No employees match
                    </TableCell>
                  </TableRow>
                )}
                {list.data.items.map((e) => (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/employees/${e.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/employees/${e.id}`} onClick={(ev) => ev.stopPropagation()}>
                        {e.name}
                      </Link>
                    </TableCell>
                    {COLUMNS.filter((c) => cols.includes(c.key)).map((c) => (
                      <TableCell key={c.key}>{c.render(e)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: page - 1 }))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setQuery((q) => ({ ...q, page: page + 1 }))}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </RequirePermission>
  );
}
