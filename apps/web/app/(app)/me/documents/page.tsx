'use client';

import { FileText } from 'lucide-react';
import { toast } from 'sonner';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { openDocument, useDocuments } from '@/lib/queries/employees';

export default function MyDocumentsPage() {
  const { me } = useAuth();
  const id = me?.employee?.id ?? '';
  const docs = useDocuments(id, !!id);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <RequirePermission permission="documents.read">
      <div className="mx-auto max-w-3xl">
        <PageHeader title="My documents" description="Documents HR keeps on your file." />
        {docs.error && <ErrorAlert error={docs.error} />}
        {!id ? (
          <p className="text-muted-foreground">Your account is not linked to an employee.</p>
        ) : !docs.data ? (
          <Skeleton className="h-40" />
        ) : docs.data.length === 0 ? (
          <p className="text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {docs.data.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
                  onClick={() => openDocument(id, d.id).catch((e) => toast.error(errorMessage(e)))}
                >
                  <FileText className="text-muted-foreground size-5 shrink-0" />
                  <span className="flex-1">
                    <span className="block font-medium">{d.title}</span>
                    <span className="text-muted-foreground text-xs capitalize">{d.category}</span>
                  </span>
                  {d.expiryDate && (
                    <Badge variant={d.expiryDate < today ? 'destructive' : 'outline'}>
                      {d.expiryDate < today ? 'Expired' : 'Expires'} {d.expiryDate}
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RequirePermission>
  );
}
