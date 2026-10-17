'use client';

import { Check, Paperclip, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { formatRange, LeaveTabs, unitLabel } from '@/components/leave/leave-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBulkDecide, useDecide, useInbox, openLeaveAttachment } from '@/lib/queries/leave';

export default function ApprovalsPage() {
  const inbox = useInbox(true);
  const decide = useDecide();
  const bulk = useBulkDecide();
  const [selected, setSelected] = useState<string[]>([]);
  const items = inbox.data ?? [];
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <RequirePermission permission="leave.approve" scope="team">
      <PageHeader
        title="Leave"
        actions={
          selected.length > 0 && (
            <>
              <Button
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate(
                    { ids: selected, action: 'approve' },
                    { onSuccess: () => setSelected([]) },
                  )
                }
              >
                <Check /> Approve {selected.length}
              </Button>
              <Button
                variant="outline"
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate(
                    { ids: selected, action: 'reject' },
                    { onSuccess: () => setSelected([]) },
                  )
                }
              >
                <X /> Reject {selected.length}
              </Button>
            </>
          )
        }
      />
      <LeaveTabs />
      {inbox.error && <ErrorAlert error={inbox.error} />}
      {!inbox.data ? (
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground" data-testid="inbox-empty">
          Nothing waiting for you. 🎉
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v ? items.map((i) => i.id) : [])}
                  />
                </TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id} data-testid={`inbox-${r.employeeNo}`}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${r.employeeName}`}
                      checked={selected.includes(r.id)}
                      onCheckedChange={(v) =>
                        setSelected(v ? [...selected, r.id] : selected.filter((x) => x !== r.id))
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      style={{ borderLeft: `3px solid ${r.leaveType.color}` }}
                    >
                      {r.leaveType.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatRange(r)}</TableCell>
                  <TableCell>{unitLabel(r.leaveType.unit, r.amount)}</TableCell>
                  <TableCell className="max-w-48 truncate" title={r.reason ?? ''}>
                    {r.reason ?? '—'}
                    {r.attachmentRequired && !r.hasAttachment && (
                      <span className="ml-1 text-xs text-amber-600">document missing</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.hasAttachment && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="View document"
                        onClick={() =>
                          openLeaveAttachment(r.id).catch((e) => toast.error(errorMessage(e)))
                        }
                      >
                        <Paperclip className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, action: 'approve' })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, action: 'reject' })}
                    >
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </RequirePermission>
  );
}
