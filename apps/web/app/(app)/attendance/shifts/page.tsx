'use client';

import { Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { shiftInputSchema, type Shift, type ShiftInput } from '@hr/shared';

import {
  AttendanceTabs,
  fmtDate,
  todayIn,
  useTenantTz,
} from '@/components/attendance/attendance-ui';
import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useEmployeeOptions } from '@/lib/queries/admin';
import { useAssignShift, useAssignments, useSaveShift, useShifts } from '@/lib/queries/attendance';

const EMPTY: ShiftInput = {
  code: '',
  name: '',
  startTime: '08:30',
  endTime: '17:00',
  isNightShift: false,
  breakMinutes: 60,
  breakAfterMinutes: 300,
  graceLateMinutes: 0,
  earlyLeaveGraceMinutes: 0,
  halfDayThresholdMinutes: 240,
  otAfterMinutes: 0,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  color: '#0ea5e9',
  archived: false,
};

const MINUTE_FIELDS: { key: keyof ShiftInput; label: string; hint: string }[] = [
  { key: 'breakMinutes', label: 'Unpaid break (min)', hint: 'Deducted from worked time' },
  {
    key: 'breakAfterMinutes',
    label: 'Deduct break after (min)',
    hint: 'Only when the day is at least this long',
  },
  { key: 'graceLateMinutes', label: 'Late grace (min)', hint: 'Arriving within this is on time' },
  {
    key: 'earlyLeaveGraceMinutes',
    label: 'Early-leave grace (min)',
    hint: 'Leaving within this is not early',
  },
  {
    key: 'halfDayThresholdMinutes',
    label: 'Full day from (min worked)',
    hint: 'Less than this counts as a half day',
  },
  {
    key: 'otAfterMinutes',
    label: 'OT counts after (min)',
    hint: 'Minimum stay past the end before OT is counted',
  },
  {
    key: 'windowBeforeMinutes',
    label: 'Punch window before start (min)',
    hint: 'Earlier punches belong to the previous day',
  },
  {
    key: 'windowAfterMinutes',
    label: 'Punch window after end (min)',
    hint: 'Later punches belong to the next day',
  },
];

function ShiftDialog({
  shift,
  onClose,
}: {
  shift: (ShiftInput & { id?: string }) | null;
  onClose: () => void;
}) {
  const save = useSaveShift();
  const [f, setF] = useState<ShiftInput & { id?: string }>(shift ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShift, setLastShift] = useState(shift);
  if (shift !== lastShift) {
    setLastShift(shift);
    setF(shift ?? EMPTY);
    setErrors({});
  }

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{f.id ? `Edit ${f.code}` : 'New shift'}</DialogTitle>
          <DialogDescription>
            These rules decide late, early, half-day and overtime. Check them against your company
            policy and employment contracts.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { id, ...body } = f;
            const parsed = shiftInputSchema.safeParse(body);
            if (!parsed.success) {
              setErrors(
                Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
              );
              return;
            }
            setErrors({});
            save.mutate({ ...body, ...(id ? { id } : {}) }, { onSuccess: onClose });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="sh-code" label="Code" error={errors.code}>
              <Input
                id="sh-code"
                required
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value })}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField id="sh-name" label="Name" error={errors.name}>
                <Input
                  id="sh-name"
                  required
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </FormField>
            </div>
            <FormField id="sh-start" label="Starts" error={errors.startTime}>
              <Input
                id="sh-start"
                type="time"
                required
                value={f.startTime}
                onChange={(e) => setF({ ...f, startTime: e.target.value })}
              />
            </FormField>
            <FormField id="sh-end" label="Ends" error={errors.endTime}>
              <Input
                id="sh-end"
                type="time"
                required
                value={f.endTime}
                onChange={(e) => setF({ ...f, endTime: e.target.value })}
              />
            </FormField>
            <FormField id="sh-color" label="Colour">
              <input
                id="sh-color"
                type="color"
                className="h-9 w-16 rounded border"
                value={f.color}
                onChange={(e) => setF({ ...f, color: e.target.value })}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.isNightShift}
              onCheckedChange={(v) => setF({ ...f, isNightShift: !!v })}
            />
            Night shift (ends the next day)
          </label>
          {errors.isNightShift && <p className="text-destructive text-sm">{errors.isNightShift}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {MINUTE_FIELDS.map((m) => (
              <FormField key={m.key} id={`sh-${m.key}`} label={m.label} error={errors[m.key]}>
                <Input
                  id={`sh-${m.key}`}
                  type="number"
                  min={0}
                  required
                  value={f[m.key] as number}
                  onChange={(e) => setF({ ...f, [m.key]: Number(e.target.value) })}
                />
                <p className="text-muted-foreground text-xs">{m.hint}</p>
              </FormField>
            ))}
          </div>
          {f.id && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!f.archived}
                onCheckedChange={(v) => setF({ ...f, archived: !!v })}
              />
              Archived (can no longer be assigned)
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save shift
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  open,
  shifts,
  onClose,
}: {
  open: boolean;
  shifts: Shift[];
  onClose: () => void;
}) {
  const tz = useTenantTz();
  const people = useEmployeeOptions(open);
  const assign = useAssignShift();
  const [shiftId, setShiftId] = useState('');
  const [from, setFrom] = useState(() => todayIn(tz));
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const list = (people.data ?? []).filter((p) =>
    `${p.employeeNo} ${p.name}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign a shift</DialogTitle>
          <DialogDescription>
            From the chosen date the shift replaces each person’s current one. Roster overrides
            still win on their dates.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            assign.mutate(
              { shiftId, effectiveFrom: from, employeeIds: selected },
              {
                onSuccess: () => {
                  setSelected([]);
                  onClose();
                },
              },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="as-shift" label="Shift">
              <select
                id="as-shift"
                required
                className={selectClass}
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
              >
                <option value="">Choose…</option>
                {shifts
                  .filter((s) => !s.archived)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.startTime}–{s.endTime}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField id="as-from" label="From">
              <Input
                id="as-from"
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </FormField>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Search employees"
                placeholder="Search…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelected([...new Set([...selected, ...list.map((p) => p.id)])])}
              >
                Select all
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {list.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={p.name}
                    checked={selected.includes(p.id)}
                    onCheckedChange={(v) =>
                      setSelected(v ? [...selected, p.id] : selected.filter((x) => x !== p.id))
                    }
                  />
                  <span className="text-muted-foreground w-20 font-mono text-xs">
                    {p.employeeNo}
                  </span>
                  {p.name}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{selected.length} selected</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!shiftId || !selected.length || assign.isPending}>
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ShiftsPage() {
  const shifts = useShifts();
  const assignments = useAssignments();
  const people = useEmployeeOptions();
  const [edit, setEdit] = useState<(ShiftInput & { id?: string }) | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const current = useMemo(() => {
    const byEmployee = new Map<string, { code: string; from: string }>();
    for (const a of assignments.data ?? [])
      if (!a.effectiveTo && !byEmployee.has(a.employeeId))
        byEmployee.set(a.employeeId, { code: a.shiftCode, from: a.effectiveFrom });
    return byEmployee;
  }, [assignments.data]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of current.values()) c.set(v.code, (c.get(v.code) ?? 0) + 1);
    return c;
  }, [current]);
  const unassigned = (people.data ?? []).filter((p) => !current.has(p.id));

  return (
    <RequirePermission permission="attendance.manage" scope="all">
      <PageHeader
        title="Attendance"
        actions={
          <>
            <Button variant="outline" onClick={() => setAssignOpen(true)}>
              <Users /> Assign shift
            </Button>
            <Button onClick={() => setEdit({ ...EMPTY })}>
              <Plus /> New shift
            </Button>
          </>
        }
      />
      <AttendanceTabs />
      {shifts.error && <ErrorAlert error={shifts.error} />}
      {!shifts.data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Break</TableHead>
                <TableHead>Late grace</TableHead>
                <TableHead>OT after</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.data.map((s) => (
                <TableRow
                  key={s.id}
                  className={s.archived ? 'opacity-60' : ''}
                  data-testid={`shift-${s.code}`}
                >
                  <TableCell>
                    <span
                      className="mr-2 inline-block size-3 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="font-medium">{s.code}</span> · {s.name}
                    {s.needsReview && (
                      <Badge variant="outline" className="ml-2 border-amber-500 text-amber-600">
                        Review
                      </Badge>
                    )}
                    {s.archived && (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.startTime}–{s.endTime}
                    {s.isNightShift && ' (+1)'}
                  </TableCell>
                  <TableCell>{s.breakMinutes} min</TableCell>
                  <TableCell>{s.graceLateMinutes} min</TableCell>
                  <TableCell>{s.otAfterMinutes} min</TableCell>
                  <TableCell>{counts.get(s.code) ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...s })}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {people.data && unassigned.length > 0 && (
        <p className="text-muted-foreground mt-4 text-sm">
          {unassigned.length} employee(s) have no shift — their attendance uses the calendar day
          with no late/OT rules:{' '}
          {unassigned
            .slice(0, 8)
            .map((p) => p.name)
            .join(', ')}
          {unassigned.length > 8 && '…'}
        </p>
      )}
      {assignments.data && assignments.data.some((a) => a.effectiveFrom > todayIn('UTC')) && (
        <p className="text-muted-foreground mt-2 text-sm">
          Upcoming changes:{' '}
          {assignments.data
            .filter((a) => a.effectiveFrom > todayIn('UTC'))
            .slice(0, 5)
            .map((a) => `${a.shiftCode} from ${fmtDate(a.effectiveFrom)}`)
            .join(', ')}
        </p>
      )}
      <ShiftDialog shift={edit} onClose={() => setEdit(null)} />
      <AssignDialog
        open={assignOpen}
        shifts={shifts.data ?? []}
        onClose={() => setAssignOpen(false)}
      />
    </RequirePermission>
  );
}
