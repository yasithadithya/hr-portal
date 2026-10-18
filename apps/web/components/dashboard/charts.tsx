'use client';

import { useState, type ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Small single-series charts for dashboards. One hue (the tenant's primary colour), thin marks
 * with 4px rounded data ends, recessive axes, a hover value on every mark, and a table view so
 * identity and value never depend on colour or pointer alone.
 */

interface Datum {
  label: string;
  value: number;
  /** Text shown for the value (e.g. formatted money). */
  display?: string;
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
      onClick={() => onChange(!table)}
    >
      {table ? 'Show chart' : 'Show table'}
    </button>
  );
}

function DataTable({ data, valueLabel }: { data: Datum[]; valueLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">{valueLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((d) => (
          <TableRow key={d.label}>
            <TableCell>{d.label}</TableCell>
            <TableCell className="text-right tabular-nums">{d.display ?? d.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ChartCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Ranked magnitudes (headcount by department, cost by department). */
export function BarList({
  title,
  data,
  valueLabel,
  max = 8,
}: {
  title: string;
  data: Datum[];
  valueLabel: string;
  max?: number;
}) {
  const [table, setTable] = useState(false);
  const shown =
    data.length > max
      ? [
          ...data.slice(0, max - 1),
          {
            label: `Other (${data.length - max + 1})`,
            value: data.slice(max - 1).reduce((a, d) => a + d.value, 0),
          },
        ]
      : data;
  const top = Math.max(1, ...shown.map((d) => d.value));
  return (
    <ChartCard
      title={title}
      action={data.length > 0 && <ViewToggle table={table} onChange={setTable} />}
    >
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No data yet.</p>
      ) : table ? (
        <DataTable data={shown} valueLabel={valueLabel} />
      ) : (
        <ul className="space-y-2" aria-label={title}>
          {shown.map((d) => (
            <li key={d.label} className="group" title={`${d.label}: ${d.display ?? d.value}`}>
              <div className="mb-0.5 flex justify-between gap-2 text-xs">
                <span className="truncate">{d.label}</span>
                <span className="text-muted-foreground tabular-nums">{d.display ?? d.value}</span>
              </div>
              <div className="bg-muted h-2 rounded-full">
                <div
                  className="bg-primary h-2 rounded-full transition-opacity group-hover:opacity-80"
                  style={{ width: `${Math.max(2, (d.value / top) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Change over time for one measure (e.g. monthly employer cost). */
export function ColumnTrend({
  title,
  data,
  valueLabel,
}: {
  title: string;
  data: Datum[];
  valueLabel: string;
}) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...data.map((d) => d.value));
  const h = 140;
  return (
    <ChartCard
      title={title}
      action={data.length > 0 && <ViewToggle table={table} onChange={setTable} />}
    >
      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No approved payrolls yet.</p>
      ) : table ? (
        <DataTable data={data} valueLabel={valueLabel} />
      ) : (
        <div>
          <div className="text-muted-foreground mb-1 h-5 text-xs tabular-nums" aria-live="polite">
            {hover !== null
              ? `${data[hover]!.label}: ${data[hover]!.display ?? data[hover]!.value}`
              : `Latest: ${data.at(-1)!.display ?? data.at(-1)!.value}`}
          </div>
          <div
            className="flex items-end gap-[2px] border-b"
            style={{ height: h }}
            role="img"
            aria-label={`${title}, ${data.length} months`}
          >
            {data.map((d, i) => (
              <button
                type="button"
                key={d.label}
                className="flex h-full flex-1 items-end focus:outline-none"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.label}: ${d.display ?? d.value}`}
              >
                <span
                  className={cn(
                    'bg-primary w-full rounded-t-[4px] transition-opacity',
                    hover !== null && hover !== i && 'opacity-50',
                  )}
                  style={{ height: `${Math.max(2, (d.value / top) * 100)}%` }}
                />
              </button>
            ))}
          </div>
          <div className="text-muted-foreground mt-1 flex justify-between text-[11px]">
            <span>{data[0]!.label}</span>
            <span>{data.at(-1)!.label}</span>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

export function StatTile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-4" data-testid={testId}>
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </div>
  );
}
