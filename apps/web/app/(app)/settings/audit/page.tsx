'use client';

import { Fragment, useState } from 'react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuditLog } from '@/lib/queries/admin';

const ALL = '__all__';
const ENTITIES = ['app_users', 'roles', 'employees', 'settings'];

export default function AuditPage() {
  const [entity, setEntity] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);
  const log = useAuditLog({ entity: entity === ALL ? undefined : entity });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <RequirePermission permission="audit.read" scope="all">
      <PageHeader
        title="Audit log"
        description="Append-only record of changes. Entries cannot be edited or deleted."
        actions={
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-44" aria-label="Filter by record type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All records</SelectItem>
              {ENTITIES.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {log.error && <ErrorAlert error={log.error} />}
      {!log.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                      No entries yet
                    </TableCell>
                  </TableRow>
                )}
                {items.map((e) => (
                  <Fragment key={e.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setOpen(open === e.id ? null : e.id)}
                      aria-expanded={open === e.id}
                    >
                      <TableCell className="whitespace-nowrap">
                        {new Date(e.at).toLocaleString()}
                      </TableCell>
                      <TableCell>{e.actorEmail ?? 'system'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{e.action}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.entity}
                        {e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}
                      </TableCell>
                    </TableRow>
                    {open === e.id && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/40">
                          <div className="grid gap-3 md:grid-cols-2">
                            {(['before', 'after'] as const).map((k) => (
                              <div key={k} className="min-w-0">
                                <div className="text-muted-foreground mb-1 text-xs font-semibold uppercase">
                                  {k}
                                </div>
                                <pre className="overflow-x-auto rounded bg-background p-2 text-xs">
                                  {e[k] ? JSON.stringify(e[k], null, 2) : '—'}
                                </pre>
                              </div>
                            ))}
                          </div>
                          {e.ip && <p className="text-muted-foreground mt-2 text-xs">IP {e.ip}</p>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          {log.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void log.fetchNextPage()}
              disabled={log.isFetchingNextPage}
            >
              Load older entries
            </Button>
          )}
        </div>
      )}
    </RequirePermission>
  );
}
