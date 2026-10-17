'use client';

import { Paperclip, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import type { LeaveQuote, LeaveRequest } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { FormField, selectClass } from '@/components/employees/fields';
import { formatRange, LeaveTabs, STATUS_STYLE, unitLabel } from '@/components/leave/leave-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  openLeaveAttachment,
  useApplyLeave,
  useAttachLeave,
  useBalances,
  useCancelLeave,
  useLeaveTypes,
  useMyRequests,
  useQuote,
} from '@/lib/queries/leave';

const THIS_YEAR = new Date().getUTCFullYear();

function ApplyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const types = useLeaveTypes();
  const quote = useQuote();
  const apply = useApplyLeave();
  const [f, setF] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    startHalf: 'full',
    endHalf: 'full',
    hours: '',
    reason: '',
  });
  const [q, setQ] = useState<LeaveQuote | null>(null);
  const [qErr, setQErr] = useState<unknown>(null);
  const type = types.data?.find((t) => t.id === f.leaveTypeId);
  const single = f.startDate && f.startDate === (f.endDate || f.startDate);

  const body = () => ({
    leaveTypeId: f.leaveTypeId,
    startDate: f.startDate,
    endDate: type?.unit === 'hour' ? f.startDate : f.endDate || f.startDate,
    startHalf: (single ? f.startHalf : f.startHalf === 'second' ? 'second' : 'full') as 'full',
    endHalf: (single ? f.startHalf : f.endHalf === 'first' ? 'first' : 'full') as 'full',
    hours: type?.unit === 'hour' ? Number(f.hours) || null : null,
    reason: f.reason || null,
  });

  async function preview(next = f) {
    setQ(null);
    setQErr(null);
    if (!next.leaveTypeId || !next.startDate) return;
    try {
      setQ(await quote.mutateAsync(body()));
    } catch (err) {
      setQErr(err);
    }
  }

  const update = (patch: Partial<typeof f>) => {
    const next = { ...f, ...patch };
    setF(next);
    setQ(null);
    setQErr(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setF({
            leaveTypeId: '',
            startDate: '',
            endDate: '',
            startHalf: 'full',
            endHalf: 'full',
            hours: '',
            reason: '',
          });
          setQ(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>Weekends and holidays are not counted.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply.mutate(body(), { onSuccess: onClose });
          }}
        >
          <FormField id="lv-type" label="Leave type">
            <select
              id="lv-type"
              required
              className={selectClass}
              value={f.leaveTypeId}
              onChange={(e) => update({ leaveTypeId: e.target.value })}
            >
              <option value="">Choose…</option>
              {types.data
                ?.filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="lv-start" label={type?.unit === 'hour' ? 'Date' : 'From'}>
              <Input
                id="lv-start"
                type="date"
                required
                value={f.startDate}
                onChange={(e) => update({ startDate: e.target.value })}
              />
            </FormField>
            {type?.unit === 'hour' ? (
              <FormField id="lv-hours" label="Hours">
                <Input
                  id="lv-hours"
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="24"
                  required
                  value={f.hours}
                  onChange={(e) => update({ hours: e.target.value })}
                />
              </FormField>
            ) : (
              <FormField id="lv-end" label="To">
                <Input
                  id="lv-end"
                  type="date"
                  min={f.startDate}
                  value={f.endDate}
                  onChange={(e) => update({ endDate: e.target.value })}
                />
              </FormField>
            )}
          </div>
          {type && type.unit === 'half_day' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="lv-sh" label={single ? 'Which part of the day' : 'First day'}>
                <select
                  id="lv-sh"
                  className={selectClass}
                  value={f.startHalf}
                  onChange={(e) => update({ startHalf: e.target.value })}
                >
                  <option value="full">Full day</option>
                  {single && <option value="first">Morning only</option>}
                  <option value="second">{single ? 'Afternoon only' : 'From the afternoon'}</option>
                </select>
              </FormField>
              {!single && (
                <FormField id="lv-eh" label="Last day">
                  <select
                    id="lv-eh"
                    className={selectClass}
                    value={f.endHalf}
                    onChange={(e) => update({ endHalf: e.target.value })}
                  >
                    <option value="full">Full day</option>
                    <option value="first">Until midday</option>
                  </select>
                </FormField>
              )}
            </div>
          )}
          <FormField id="lv-reason" label="Reason (optional)">
            <Textarea
              id="lv-reason"
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
            />
          </FormField>

          {qErr ? <ErrorAlert error={qErr} title="Can't apply" /> : null}
          {q && (
            <div className="bg-muted/50 rounded-md p-3 text-sm" data-testid="leave-quote">
              <p className="font-medium">
                {unitLabel(q.unit, q.amount)}
                {q.balanceAfter !== null && (
                  <span className="text-muted-foreground font-normal">
                    {' '}
                    · {q.balanceAfter} left afterwards
                  </span>
                )}
              </p>
              {q.attachmentRequired && (
                <p className="text-amber-600">
                  A supporting document will be needed before approval.
                </p>
              )}
              {q.warnings.map((w) => (
                <p key={w} className="text-muted-foreground">
                  {w}
                </p>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!f.leaveTypeId || !f.startDate || quote.isPending}
              onClick={() => preview()}
            >
              Check
            </Button>
            <Button type="submit" disabled={apply.isPending || !f.leaveTypeId || !f.startDate}>
              {apply.isPending ? 'Sending…' : 'Request leave'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({ r }: { r: LeaveRequest }) {
  const cancel = useCancelLeave();
  const attach = useAttachLeave();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const canCancel = r.status === 'pending' || (r.status === 'approved' && r.startDate > today);
  return (
    <TableRow>
      <TableCell>
        <span
          className="mr-2 inline-block size-2 rounded-full"
          style={{ background: r.leaveType.color }}
        />
        {r.leaveType.name}
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatRange(r)}</TableCell>
      <TableCell>{unitLabel(r.leaveType.unit, r.amount)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_STYLE[r.status]}>{r.status}</Badge>
        {r.status === 'pending' && r.waitingFor && (
          <span className="text-muted-foreground ml-2 text-xs">with {r.waitingFor}</span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {r.hasAttachment ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="View document"
            onClick={() => openLeaveAttachment(r.id).catch((e) => toast.error(errorMessage(e)))}
          >
            <Paperclip className="size-4" />
          </Button>
        ) : (
          (r.status === 'pending' || r.status === 'approved') && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="hidden"
                aria-label="Supporting document"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) attach.mutate({ id: r.id, file });
                  e.target.value = '';
                }}
              />
              <Button
                size="sm"
                variant={r.attachmentRequired ? 'outline' : 'ghost'}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip /> {r.attachmentRequired ? 'Attach (required)' : 'Attach'}
              </Button>
            </>
          )
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ id: r.id })}
          >
            {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function MyLeavePage() {
  const { me } = useAuth();
  const [year, setYear] = useState(THIS_YEAR);
  const [applying, setApplying] = useState(false);
  const balances = useBalances(year);
  const requests = useMyRequests(year);
  const notLinked = balances.error instanceof ApiError && /not linked/.test(balances.error.message);

  return (
    <RequirePermission permission={['leave.apply', 'leave.approve', 'leave.manage']}>
      <PageHeader
        title="Leave"
        actions={
          me?.employee && (
            <Button onClick={() => setApplying(true)}>
              <Plus /> Apply for leave
            </Button>
          )
        }
      />
      <LeaveTabs />
      {notLinked ? (
        <p className="text-muted-foreground">
          Your account isn&apos;t linked to an employee record, so you have no leave of your own.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous year"
              onClick={() => setYear(year - 1)}
            >
              ‹
            </Button>
            <span className="font-medium" data-testid="leave-year">
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
          {balances.error && <ErrorAlert error={balances.error} />}
          {!balances.data ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Leave balances">
              {balances.data.map((b) => (
                <Card key={b.leaveType.id} data-testid={`balance-${b.leaveType.code}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: b.leaveType.color }}
                      />
                      {b.leaveType.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {b.allowNegative && b.entitled === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No balance needed · {unitLabel(b.leaveType.unit, b.taken)} taken
                      </p>
                    ) : (
                      <>
                        <p className="text-2xl font-semibold" data-testid="available">
                          {b.available}
                          <span className="text-muted-foreground text-sm font-normal">
                            {' '}
                            / {b.entitled}
                            {b.leaveType.unit === 'hour' ? ' h' : ''}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {b.taken} taken{b.pending ? ` · ${b.pending} pending` : ''}
                        </p>
                      </>
                    )}
                    {b.policyNeedsReview && (
                      <p className="mt-1 text-xs text-amber-600">Policy not yet set up by HR</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">My requests</CardTitle>
            </CardHeader>
            <CardContent>
              {!requests.data ? (
                <Skeleton className="h-24" />
              ) : requests.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No leave requests in {year}.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>Length</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.data.map((r) => (
                        <RequestRow key={r.id} r={r} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <ApplyDialog open={applying} onClose={() => setApplying(false)} />
    </RequirePermission>
  );
}
