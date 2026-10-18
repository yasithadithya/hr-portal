'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { ReportInfo } from '@hr/shared';

import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { selectClass } from '@/components/employees/fields';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { apiDownload } from '@/lib/api';
import { useReport, useReportCatalog } from '@/lib/queries/notifications';
import { useRefList } from '@/lib/queries/org';
import { lkr, useRuns } from '@/lib/queries/payroll';
import { cn } from '@/lib/utils';

const PAGE = 200;

function Filters({
  info,
  value,
  onChange,
}: {
  info: ReportInfo;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const departments = useRefList('departments');
  const runs = useRuns();
  const set = (k: string, v: string) => {
    const next = { ...value };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      {info.filters.includes('departmentId') && (
        <select
          aria-label="Department"
          className={`${selectClass} w-48`}
          value={value.departmentId ?? ''}
          onChange={(e) => set('departmentId', e.target.value)}
        >
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {info.filters.includes('status') && (
        <select
          aria-label="Status"
          className={`${selectClass} w-44`}
          value={value.status ?? ''}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {['active', 'on_probation', 'notice', 'resigned', 'terminated', 'retired'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      )}
      {info.filters.includes('year') && (
        <Input
          aria-label="Year"
          type="number"
          className="w-28"
          placeholder="Year"
          value={value.year ?? ''}
          onChange={(e) => set('year', e.target.value)}
        />
      )}
      {info.filters.includes('month') && (
        <Input
          aria-label="Month"
          type="month"
          className="w-44"
          value={value.month ?? ''}
          onChange={(e) => set('month', e.target.value)}
        />
      )}
      {info.filters.includes('runId') && (
        <select
          aria-label="Payroll run"
          className={`${selectClass} w-56`}
          value={value.runId ?? ''}
          onChange={(e) => set('runId', e.target.value)}
        >
          <option value="">Latest payroll</option>
          {runs.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.month} · {r.type} · {r.status}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const catalog = useReportCatalog();
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(PAGE);
  const key = selected ?? catalog.data?.[0]?.key ?? null;
  const info = catalog.data?.find((r) => r.key === key);
  const result = useReport(key, filters);
  const r = result.data;
  const download = (format: 'csv' | 'xlsx') =>
    apiDownload(
      `/api/v1/reports/${key}?${new URLSearchParams({ ...filters, format }).toString()}`,
      `${key}.${format}`,
    ).catch((e) => toast.error(errorMessage(e)));

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Predefined reports with filters. Exports respect what you’re allowed to see."
      />
      {catalog.error && <ErrorAlert error={catalog.error} />}
      {catalog.data?.length === 0 && (
        <p className="text-muted-foreground">No reports are available for your role.</p>
      )}
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Reports" className="space-y-1">
          {catalog.data?.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setSelected(c.key);
                setFilters({});
                setLimit(PAGE);
              }}
              className={cn(
                'w-full rounded-md px-3 py-2 text-left text-sm',
                key === c.key ? 'bg-accent font-medium' : 'hover:bg-accent/60',
              )}
            >
              {c.title}
              <span className="text-muted-foreground block text-xs">{c.description}</span>
            </button>
          ))}
        </nav>
        {info && (
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{info.title}</CardTitle>
                  {r?.note && <CardDescription>{r.note}</CardDescription>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => download('csv')}>
                    <Download /> CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download('xlsx')}>
                    <Download /> Excel
                  </Button>
                </div>
              </div>
              <Filters info={info} value={filters} onChange={setFilters} />
            </CardHeader>
            <CardContent>
              {result.error && <ErrorAlert error={result.error} />}
              {!r ? (
                <Skeleton className="h-48" />
              ) : r.rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No rows for these filters.</p>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2 text-xs" data-testid="report-count">
                    {r.rows.length} row(s)
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {r.columns.map((c) => (
                            <TableHead
                              key={c.key}
                              className={
                                c.type === 'money' || c.type === 'number' ? 'text-right' : ''
                              }
                            >
                              {c.label}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.rows.slice(0, limit).map((row, i) => (
                          <TableRow key={i}>
                            {r.columns.map((c) => {
                              const v = row[c.key];
                              return (
                                <TableCell
                                  key={c.key}
                                  className={
                                    c.type === 'money' || c.type === 'number'
                                      ? 'text-right tabular-nums'
                                      : ''
                                  }
                                >
                                  {v === null || v === undefined || v === ''
                                    ? '—'
                                    : c.type === 'money'
                                      ? lkr(String(v))
                                      : String(v)}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {r.rows.length > limit && (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      onClick={() => setLimit(limit + PAGE)}
                    >
                      Show more ({r.rows.length - limit} left)
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
