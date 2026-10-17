'use client';

import { CheckCircle2, CircleAlert, Copy, FileUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  HOLIDAY_TYPES,
  type Holiday,
  type HolidayImportResult,
  type WorkCalendar,
} from '@hr/shared';
import { type DayPortion, type WorkWeek } from '@hr/shared/time';
import type { WEEKDAYS } from '@hr/shared/time';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import {
  useCalendars,
  useCopyHolidays,
  useDeleteCalendar,
  useDeleteHoliday,
  useHolidays,
  useImportHolidays,
  useSaveCalendar,
  useSaveHoliday,
} from '@/lib/queries/org';

const DAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const PORTIONS: DayPortion[] = ['full', 'half', 'off'];
const THIS_YEAR = new Date().getUTCFullYear();

function WorkWeekEditor({
  value,
  onChange,
  readOnly,
}: {
  value: WorkWeek;
  onChange: (w: WorkWeek) => void;
  readOnly: boolean;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Work week">
      {ORDER.map((d) => (
        <div key={d} className="text-center">
          <div className="text-muted-foreground mb-1 text-xs">{DAY_LABEL[d]}</div>
          <select
            aria-label={`${DAY_LABEL[d]} working`}
            disabled={readOnly}
            value={value[d]}
            onChange={(e) => onChange({ ...value, [d]: e.target.value as DayPortion })}
            className="border-input bg-background h-8 w-full rounded-md border px-1 text-xs"
          >
            {PORTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function CalendarCard({
  cal,
  selected,
  onSelect,
  readOnly,
}: {
  cal: WorkCalendar;
  selected: boolean;
  onSelect: () => void;
  readOnly: boolean;
}) {
  const save = useSaveCalendar();
  const del = useDeleteCalendar();
  const [week, setWeek] = useState<WorkWeek>(cal.workWeek);
  const [name, setName] = useState(cal.name);
  const dirty = name !== cal.name || JSON.stringify(week) !== JSON.stringify(cal.workWeek);
  return (
    <Card className={selected ? 'ring-primary ring-2' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Input
            aria-label="Calendar name"
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
            className="h-8 max-w-60 font-medium"
          />
          {cal.isDefault ? <Badge>Default</Badge> : null}
        </div>
        <CardDescription>{cal.holidayCount} holidays on file</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <WorkWeekEditor value={week} onChange={setWeek} readOnly={readOnly} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={selected ? 'default' : 'outline'} onClick={onSelect}>
            Holidays
          </Button>
          {!readOnly && dirty && (
            <Button
              size="sm"
              onClick={() =>
                save.mutate({ id: cal.id, name, workWeek: week, isDefault: cal.isDefault })
              }
            >
              Save
            </Button>
          )}
          {!readOnly && !cal.isDefault && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  save.mutate({
                    id: cal.id,
                    name: cal.name,
                    workWeek: cal.workWeek,
                    isDefault: true,
                  })
                }
              >
                Make default
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => del.mutate(cal.id)}
              >
                <Trash2 /> Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HolidayDialog({
  calendarId,
  holiday,
  open,
  onClose,
}: {
  calendarId: string;
  holiday: Holiday | null;
  open: boolean;
  onClose: () => void;
}) {
  const save = useSaveHoliday(calendarId);
  const [form, setForm] = useState({ date: '', name: '', type: 'public', isVerified: true });
  const [prev, setPrev] = useState<{ holiday: Holiday | null; open: boolean } | null>(null);
  if (prev?.holiday !== holiday || prev?.open !== open) {
    setPrev({ holiday, open });
    setForm(
      holiday
        ? {
            date: holiday.date,
            name: holiday.name,
            type: holiday.type,
            isVerified: holiday.isVerified,
          }
        : { date: '', name: '', type: 'public', isVerified: true },
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{holiday ? 'Edit holiday' : 'Add holiday'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ id: holiday?.id, ...form }, { onSuccess: onClose });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="h-date">Date</Label>
              <Input
                id="h-date"
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="h-type">Type</Label>
              <Input
                id="h-type"
                list="holiday-types"
                required
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              />
              <datalist id="holiday-types">
                {HOLIDAY_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="h-name">Name</Label>
            <Input
              id="h-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.isVerified}
              onCheckedChange={(v) => setForm({ ...form, isVerified: v })}
            />
            Checked against the official gazette
          </label>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  calendarId,
  open,
  onClose,
}: {
  calendarId: string;
  open: boolean;
  onClose: () => void;
}) {
  const imp = useImportHolidays(calendarId);
  const [csv, setCsv] = useState('date,name,type\n');
  const [preview, setPreview] = useState<HolidayImportResult | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPreview(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import holidays from CSV</DialogTitle>
          <DialogDescription>
            Columns: date (YYYY-MM-DD), name, type. Imported holidays are marked unverified until
            you check them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                setPreview(null);
              }
            }}
          />
          <Textarea
            aria-label="CSV content"
            className="h-40 font-mono text-xs"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
          />
          {preview && (
            <div className="space-y-2 text-sm" data-testid="import-preview">
              <p>
                <CheckCircle2 className="mr-1 inline size-4 text-green-600" />
                {preview.valid.length} valid row(s)
              </p>
              {preview.errors.length > 0 && (
                <ul className="text-destructive max-h-32 space-y-1 overflow-y-auto">
                  {preview.errors.map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      <CircleAlert className="mr-1 inline size-4" />
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={imp.isPending}
            onClick={() => imp.mutate({ csv, dryRun: true }, { onSuccess: setPreview })}
          >
            Check file
          </Button>
          <Button
            disabled={
              imp.isPending || !preview || preview.errors.length > 0 || preview.valid.length === 0
            }
            onClick={() =>
              imp.mutate(
                { csv, dryRun: false },
                {
                  onSuccess: () => {
                    setPreview(null);
                    onClose();
                  },
                },
              )
            }
          >
            Import {preview?.valid.length ?? ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HolidaysPanel({ cal, readOnly }: { cal: WorkCalendar; readOnly: boolean }) {
  const [year, setYear] = useState(THIS_YEAR);
  const list = useHolidays(cal.id, year);
  const del = useDeleteHoliday();
  const save = useSaveHoliday(cal.id);
  const copy = useCopyHolidays(cal.id);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const unverified = list.data?.filter((h) => !h.isVerified).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Holidays · {cal.name}</CardTitle>
            <CardDescription>
              Sri Lankan public, bank, mercantile and Poya holidays change every year. Check each
              date against the official government gazette and tick it as verified.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous year"
              onClick={() => setYear(year - 1)}
            >
              ‹
            </Button>
            <span className="w-12 text-center font-medium" data-testid="holiday-year">
              {year}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next year"
              onClick={() => setYear(year + 1)}
            >
              ›
            </Button>
          </div>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <FileUp /> Import CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={copy.isPending}
              onClick={() => copy.mutate({ fromYear: year - 1, toYear: year })}
            >
              <Copy /> Copy from {year - 1}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {unverified > 0 && (
          <p className="mb-3 text-sm text-amber-600 dark:text-amber-400">
            {unverified} holiday(s) not yet verified against the gazette.
          </p>
        )}
        {list.error && <ErrorAlert error={list.error} />}
        {!list.data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Verified</TableHead>
                  {!readOnly && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                      No holidays for {year}
                    </TableCell>
                  </TableRow>
                )}
                {list.data.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(`${h.date}T00:00:00Z`).toLocaleDateString(undefined, {
                        timeZone: 'UTC',
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </TableCell>
                    <TableCell>{h.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{h.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        aria-label={`Verified ${h.name}`}
                        checked={h.isVerified}
                        disabled={readOnly}
                        onCheckedChange={(v) =>
                          save.mutate({
                            id: h.id,
                            date: h.date,
                            name: h.name,
                            type: h.type,
                            isVerified: v,
                          })
                        }
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>
                          Edit
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${h.name}`}
                          onClick={() => del.mutate(h.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <HolidayDialog
        calendarId={cal.id}
        holiday={editing}
        open={adding || !!editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
      <ImportDialog calendarId={cal.id} open={importing} onClose={() => setImporting(false)} />
    </Card>
  );
}

export default function CalendarsPage() {
  const cals = useCalendars();
  const save = useSaveCalendar();
  const { can } = useAuth();
  const readOnly = !can('settings.manage', 'all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    cals.data?.find((c) => c.id === selectedId) ?? cals.data?.find((c) => c.isDefault);

  return (
    <RequirePermission permission={['settings.manage', 'users.manage', 'audit.read']}>
      <PageHeader
        title="Work week & holidays"
        description="Which days are worked, and the holidays leave and payroll skip"
        actions={
          !readOnly && (
            <Button
              variant="outline"
              onClick={() =>
                save.mutate({
                  name: `Calendar ${(cals.data?.length ?? 0) + 1}`,
                  isDefault: false,
                  workWeek: {
                    mon: 'full',
                    tue: 'full',
                    wed: 'full',
                    thu: 'full',
                    fri: 'full',
                    sat: 'half',
                    sun: 'off',
                  },
                })
              }
            >
              <Plus /> New calendar
            </Button>
          )
        }
      />
      {cals.error && <ErrorAlert error={cals.error} />}
      {!cals.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {cals.data.map((c) => (
              <CalendarCard
                key={`${c.id}-${c.name}-${JSON.stringify(c.workWeek)}`}
                cal={c}
                selected={c.id === selected?.id}
                onSelect={() => setSelectedId(c.id)}
                readOnly={readOnly}
              />
            ))}
          </div>
          {selected && <HolidaysPanel key={selected.id} cal={selected} readOnly={readOnly} />}
        </div>
      )}
    </RequirePermission>
  );
}
