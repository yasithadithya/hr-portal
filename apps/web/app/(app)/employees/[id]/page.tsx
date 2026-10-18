'use client';

import { Camera, ExternalLink, MoreHorizontal, Plus, Trash2, Upload } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  DOCUMENT_CATEGORIES,
  GENDERS,
  JOB_CHANGE_REASONS,
  MARITAL_STATUSES,
  type EmployeeDetail,
} from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert, errorMessage } from '@/components/common/error-alert';
import {
  emptyJob,
  FormField,
  JobFields,
  selectClass,
  type JobFieldValues,
} from '@/components/employees/fields';
import { StatusBadge } from '@/components/employees/status-badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  openDocument,
  useAddContact,
  useContacts,
  useDeleteContact,
  useDeleteDocument,
  useDocuments,
  useEmployee,
  useEmployeeAction,
  useJobChange,
  useJobHistory,
  usePhoto,
  useUpdateBank,
  useUpdatePersonal,
  useUploadDocument,
  useUploadPhoto,
} from '@/lib/queries/employees';

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground text-xs">{k}</dt>
          <dd className="text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Header({ e, canEdit }: { e: EmployeeDetail; canEdit: boolean }) {
  const photo = usePhoto(e.id, e.hasPhoto);
  const upload = useUploadPhoto(e.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const initials = `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      <div className="relative">
        <Avatar className="size-16">
          {photo.data?.url && <AvatarImage src={photo.data.url} alt="" />}
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              aria-label="Photo file"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) upload.mutate(f);
                ev.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="Change photo"
              onClick={() => fileRef.current?.click()}
              className="bg-background absolute -right-1 -bottom-1 rounded-full border p-1"
            >
              <Camera className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {e.firstName} {e.lastName}
          {e.preferredName ? (
            <span className="text-muted-foreground font-normal"> ({e.preferredName})</span>
          ) : null}
        </h1>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono">{e.employeeNo}</span> ·{' '}
          {e.designation?.name ?? 'No designation'} · {e.department?.name ?? 'No department'}
        </p>
      </div>
      <StatusBadge status={e.status} />
      {canEdit && <LifecycleMenu e={e} />}
    </div>
  );
}

function LifecycleMenu({ e }: { e: EmployeeDetail }) {
  const act = useEmployeeAction(e.id);
  const [dialog, setDialog] = useState<'confirm' | 'notice' | 'exit' | null>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [exitStatus, setExitStatus] = useState<'resigned' | 'terminated' | 'retired'>('resigned');
  const close = () => {
    setDialog(null);
    setDate('');
    setReason('');
  };
  const current = ['active', 'on_probation', 'notice'].includes(e.status);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Employee actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {e.status === 'on_probation' && (
            <DropdownMenuItem onClick={() => setDialog('confirm')}>
              Confirm probation
            </DropdownMenuItem>
          )}
          {(e.status === 'active' || e.status === 'on_probation') && (
            <DropdownMenuItem onClick={() => setDialog('notice')}>Record notice</DropdownMenuItem>
          )}
          {current && (
            <DropdownMenuItem className="text-destructive" onClick={() => setDialog('exit')}>
              Exit employee
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              apiDownload(
                `/api/v1/employees/${e.id}/data-export`,
                `personal-data-${e.employeeNo}.json`,
              ).catch((err) => toast.error(errorMessage(err)))
            }
          >
            Download personal data (PDPA)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'confirm'
                ? 'Confirm probation'
                : dialog === 'notice'
                  ? 'Record notice'
                  : 'Exit employee'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              const body =
                dialog === 'confirm'
                  ? { confirmationDate: date }
                  : dialog === 'notice'
                    ? { exitDate: date, exitReason: reason }
                    : { exitDate: date, exitReason: reason, status: exitStatus };
              act.mutate({ action: dialog!, body }, { onSuccess: close });
            }}
          >
            <FormField
              id="lc-date"
              label={dialog === 'confirm' ? 'Confirmation date' : 'Last working day'}
            >
              <Input
                id="lc-date"
                type="date"
                required
                value={date}
                onChange={(ev) => setDate(ev.target.value)}
              />
            </FormField>
            {dialog !== 'confirm' && (
              <FormField id="lc-reason" label="Reason">
                <Input
                  id="lc-reason"
                  required
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              </FormField>
            )}
            {dialog === 'exit' && (
              <FormField id="lc-status" label="Leaving as">
                <select
                  id="lc-status"
                  className={selectClass}
                  value={exitStatus}
                  onChange={(ev) => setExitStatus(ev.target.value as typeof exitStatus)}
                >
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                  <option value="retired">Retired</option>
                </select>
              </FormField>
            )}
            <DialogFooter>
              <Button type="submit" disabled={act.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Overview({ e }: { e: EmployeeDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Facts
          items={[
            ['Work email', dash(e.workEmail)],
            ['Reports to', dash(e.reportsTo?.name)],
            ['Branch', dash(e.branch?.name)],
            ['Grade', dash(e.grade?.name)],
            ['Cost centre', dash(e.costCenter?.name)],
            ['Employment type', e.employmentType.replace('_', ' ')],
            ['Joined', e.joinDate],
            ['Probation ends', dash(e.probationEndDate)],
            ['Confirmed', dash(e.confirmationDate)],
            ['Contract ends', dash(e.contractEndDate)],
            ['Exit date', dash(e.exitDate)],
          ]}
        />
      </CardContent>
    </Card>
  );
}

function JobTab({ e, canEdit }: { e: EmployeeDetail; canEdit: boolean }) {
  const history = useJobHistory(e.id);
  const change = useJobChange(e.id);
  const [open, setOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState<string>('transfer');
  const [notes, setNotes] = useState('');
  const [job, setJob] = useState<JobFieldValues>(emptyJob);
  const start = () => {
    setJob({
      branchId: e.branch?.id ?? '',
      departmentId: e.department?.id ?? '',
      designationId: e.designation?.id ?? '',
      gradeId: e.grade?.id ?? '',
      costCenterId: e.costCenter?.id ?? '',
      reportsToId: e.reportsTo?.id ?? '',
      employmentType: e.employmentType,
    });
    setOpen(true);
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Job history</CardTitle>
        {canEdit && (
          <Button size="sm" onClick={start}>
            <Plus /> Job change
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {history.error && <ErrorAlert error={history.error} />}
        {!history.data ? (
          <Skeleton className="h-32" />
        ) : (
          <ol className="relative space-y-4 border-l pl-6" aria-label="Job history">
            {history.data.map((h) => (
              <li key={h.id}>
                <span className="bg-primary absolute -left-1.5 mt-1.5 size-3 rounded-full" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {h.effectiveFrom} → {h.effectiveTo ?? 'now'}
                  </span>
                  <Badge variant="secondary">{h.reason.replace('_', ' ')}</Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {[h.designation?.name, h.department?.name, h.branch?.name, h.grade?.name]
                    .filter(Boolean)
                    .join(' · ') || 'No details'}
                  {h.reportsTo ? ` · reports to ${h.reportsTo.name}` : ''} ·{' '}
                  {h.employmentType.replace('_', ' ')}
                </p>
                {h.notes && <p className="text-sm">{h.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job change</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              change.mutate(
                { effectiveFrom, reason: reason as 'transfer', notes, ...job } as never,
                { onSuccess: () => setOpen(false) },
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="jc-from" label="Effective from">
                <Input
                  id="jc-from"
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(ev) => setEffectiveFrom(ev.target.value)}
                />
              </FormField>
              <FormField id="jc-reason" label="Reason">
                <select
                  id="jc-reason"
                  className={selectClass}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                >
                  {JOB_CHANGE_REASONS.filter((r) => r !== 'hire').map((r) => (
                    <option key={r} value={r}>
                      {r.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <JobFields value={job} onChange={setJob} excludeEmployeeId={e.id} />
            <FormField id="jc-notes" label="Notes">
              <Input id="jc-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={change.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PersonalTab({ e, canEdit }: { e: EmployeeDetail; canEdit: boolean }) {
  const save = useUpdatePersonal(e.id);
  const p = e.personal!;
  const [f, setF] = useState({
    firstName: e.firstName,
    lastName: e.lastName,
    preferredName: e.preferredName ?? '',
    workEmail: e.workEmail ?? '',
    nameWithInitials: p.nameWithInitials ?? '',
    nic: p.nic ?? '',
    passportNo: p.passportNo ?? '',
    dob: p.dob ?? '',
    gender: p.gender ?? '',
    maritalStatus: p.maritalStatus ?? '',
    nationality: p.nationality ?? '',
    religion: p.religion ?? '',
    personalEmail: p.personalEmail ?? '',
    mobile: p.mobile ?? '',
  });
  const [address, setAddress] = useState(p.address ?? {});
  const text = (k: keyof typeof f, label: string, type = 'text') => (
    <FormField id={`p-${k}`} label={label}>
      <Input
        id={`p-${k}`}
        type={type}
        disabled={!canEdit}
        value={f[k]}
        onChange={(ev) => setF({ ...f, [k]: ev.target.value })}
      />
    </FormField>
  );
  const choice = (k: 'gender' | 'maritalStatus', label: string, opts: readonly string[]) => (
    <FormField id={`p-${k}`} label={label}>
      <select
        id={`p-${k}`}
        className={selectClass}
        disabled={!canEdit}
        value={f[k]}
        onChange={(ev) => setF({ ...f, [k]: ev.target.value })}
      >
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </FormField>
  );
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate({ ...f, address } as never);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {text('firstName', 'First name')}
            {text('lastName', 'Last name')}
            {text('preferredName', 'Preferred name')}
            {text('nameWithInitials', 'Name with initials')}
            {text('nic', 'NIC')}
            {text('passportNo', 'Passport no')}
            {text('dob', 'Date of birth', 'date')}
            {choice('gender', 'Gender', GENDERS)}
            {choice('maritalStatus', 'Marital status', MARITAL_STATUSES)}
            {text('nationality', 'Nationality')}
            {text('religion', 'Religion (optional)')}
            {text('mobile', 'Mobile', 'tel')}
            {text('workEmail', 'Work email', 'email')}
            {text('personalEmail', 'Personal email', 'email')}
            <FormField id="p-line1" label="Address">
              <Input
                id="p-line1"
                disabled={!canEdit}
                value={address.line1 ?? ''}
                onChange={(ev) => setAddress({ ...address, line1: ev.target.value })}
              />
            </FormField>
            <FormField id="p-city" label="City">
              <Input
                id="p-city"
                disabled={!canEdit}
                value={address.city ?? ''}
                onChange={(ev) => setAddress({ ...address, city: ev.target.value })}
              />
            </FormField>
          </div>
          {canEdit && (
            <Button type="submit" disabled={save.isPending}>
              Save personal details
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function BankTab({ e, canEdit }: { e: EmployeeDetail; canEdit: boolean }) {
  const save = useUpdateBank(e.id);
  const b = e.bank!;
  const [f, setF] = useState(
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v ?? ''])) as Record<
      keyof typeof b,
      string
    >,
  );
  const labels: Record<keyof typeof b, string> = {
    bankName: 'Bank',
    bankBranch: 'Bank branch',
    bankAccountNo: 'Account number',
    bankAccountName: 'Account name',
    epfNo: 'EPF number',
    etfNo: 'ETF number',
    taxFileNo: 'Tax file number',
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="space-y-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate(f);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(labels) as (keyof typeof b)[]).map((k) => (
              <FormField key={k} id={`b-${k}`} label={labels[k]}>
                <Input
                  id={`b-${k}`}
                  disabled={!canEdit}
                  value={f[k]}
                  onChange={(ev) => setF({ ...f, [k]: ev.target.value })}
                />
              </FormField>
            ))}
          </div>
          {canEdit && (
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function ContactsTab({ e, canEdit }: { e: EmployeeDetail; canEdit: boolean }) {
  const contacts = useContacts(e.id, true);
  const add = useAddContact(e.id);
  const del = useDeleteContact(e.id);
  const [f, setF] = useState({ type: 'emergency', name: '', relationship: '', phone: '', dob: '' });
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {contacts.error && <ErrorAlert error={contacts.error} />}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Relationship</TableHead>
                <TableHead>Phone</TableHead>
                {canEdit && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contacts.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Badge variant="secondary">{c.type}</Badge>
                  </TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{dash(c.relationship)}</TableCell>
                  <TableCell>{dash(c.phone)}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${c.name}`}
                        onClick={() => del.mutate(c.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {contacts.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                    No contacts recorded
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {canEdit && (
          <form
            className="grid items-end gap-3 sm:grid-cols-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              add.mutate(f as never, {
                onSuccess: () =>
                  setF({ type: 'emergency', name: '', relationship: '', phone: '', dob: '' }),
              });
            }}
          >
            <FormField id="c-type" label="Type">
              <select
                id="c-type"
                className={selectClass}
                value={f.type}
                onChange={(ev) => setF({ ...f, type: ev.target.value })}
              >
                <option value="emergency">Emergency</option>
                <option value="dependent">Dependent</option>
              </select>
            </FormField>
            <FormField id="c-name" label="Name">
              <Input
                id="c-name"
                required
                value={f.name}
                onChange={(ev) => setF({ ...f, name: ev.target.value })}
              />
            </FormField>
            <FormField id="c-rel" label="Relationship">
              <Input
                id="c-rel"
                value={f.relationship}
                onChange={(ev) => setF({ ...f, relationship: ev.target.value })}
              />
            </FormField>
            <FormField id="c-phone" label="Phone">
              <Input
                id="c-phone"
                value={f.phone}
                onChange={(ev) => setF({ ...f, phone: ev.target.value })}
              />
            </FormField>
            <Button type="submit" disabled={add.isPending}>
              <Plus /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentsTab({ e, canManage }: { e: EmployeeDetail; canManage: boolean }) {
  const docs = useDocuments(e.id);
  const upload = useUploadDocument(e.id);
  const del = useDeleteDocument(e.id);
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState({ category: 'identity', title: '', expiryDate: '' });
  const [file, setFile] = useState<File | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Documents</CardTitle>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Upload /> Upload
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {docs.error && <ErrorAlert error={docs.error} />}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(docs.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell>{d.category}</TableCell>
                  <TableCell>{dash(d.expiryDate)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Open ${d.title}`}
                      onClick={() =>
                        openDocument(e.id, d.id).catch((err) => toast.error(errorMessage(err)))
                      }
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${d.title}`}
                        onClick={() => del.mutate(d.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {docs.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                    No documents
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!file) return;
              upload.mutate(
                {
                  file,
                  category: meta.category,
                  title: meta.title || file.name,
                  expiryDate: meta.expiryDate || undefined,
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setFile(null);
                    setMeta({ category: 'identity', title: '', expiryDate: '' });
                  },
                },
              );
            }}
          >
            <FormField id="d-file" label="File (PDF, image or Word, up to 10 MB)">
              <Input
                id="d-file"
                type="file"
                required
                accept=".pdf,.png,.jpg,.jpeg,.webp,.docx"
                onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
              />
            </FormField>
            <FormField id="d-title" label="Title">
              <Input
                id="d-title"
                value={meta.title}
                onChange={(ev) => setMeta({ ...meta, title: ev.target.value })}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="d-cat" label="Category">
                <select
                  id="d-cat"
                  className={selectClass}
                  value={meta.category}
                  onChange={(ev) => setMeta({ ...meta, category: ev.target.value })}
                >
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="d-exp" label="Expiry date (optional)">
                <Input
                  id="d-exp"
                  type="date"
                  value={meta.expiryDate}
                  onChange={(ev) => setMeta({ ...meta, expiryDate: ev.target.value })}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={upload.isPending || !file}>
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const emp = useEmployee(id);
  const { can, me } = useAuth();
  const canEdit = can('employees.update', 'all');
  const isSelf = me?.user.employeeId === id;
  const canManageDocs = can('documents.manage', 'all') || (isSelf && can('documents.manage'));

  return (
    <RequirePermission permission="employees.read">
      {emp.error && <ErrorAlert error={emp.error} title="Could not load this employee" />}
      {!emp.data ? (
        !emp.error && <Skeleton className="h-96" />
      ) : (
        <>
          <Header e={emp.data} canEdit={canEdit} />
          <Tabs defaultValue="overview">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="job">Job</TabsTrigger>
              {emp.data.access === 'full' && <TabsTrigger value="personal">Personal</TabsTrigger>}
              {emp.data.access === 'full' && <TabsTrigger value="contacts">Contacts</TabsTrigger>}
              {emp.data.access === 'full' && (
                <TabsTrigger value="bank">Bank & statutory</TabsTrigger>
              )}
              {can('documents.read') && <TabsTrigger value="documents">Documents</TabsTrigger>}
            </TabsList>
            <TabsContent value="overview" className="pt-4">
              <Overview e={emp.data} />
            </TabsContent>
            <TabsContent value="job" className="pt-4">
              <JobTab e={emp.data} canEdit={canEdit} />
            </TabsContent>
            {emp.data.access === 'full' && (
              <>
                <TabsContent value="personal" className="pt-4">
                  <PersonalTab
                    key={JSON.stringify(emp.data.personal)}
                    e={emp.data}
                    canEdit={canEdit}
                  />
                </TabsContent>
                <TabsContent value="contacts" className="pt-4">
                  <ContactsTab e={emp.data} canEdit={canEdit} />
                </TabsContent>
                <TabsContent value="bank" className="pt-4">
                  <BankTab key={JSON.stringify(emp.data.bank)} e={emp.data} canEdit={canEdit} />
                </TabsContent>
              </>
            )}
            <TabsContent value="documents" className="pt-4">
              <DocumentsTab e={emp.data} canManage={canManageDocs} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </RequirePermission>
  );
}
