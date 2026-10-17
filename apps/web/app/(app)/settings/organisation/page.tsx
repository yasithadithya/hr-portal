'use client';

import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import type { Department } from '@hr/shared';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorAlert } from '@/components/common/error-alert';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import {
  useArchiveRef,
  useCalendars,
  useRefList,
  useSaveRef,
  type RefPath,
} from '@/lib/queries/org';

type Option = { value: string; label: string };
type FieldDef =
  | {
      key: string;
      label: string;
      type: 'text' | 'number';
      required?: boolean;
      placeholder?: string;
    }
  | { key: string; label: string; type: 'select'; options: Option[] }
  | { key: string; label: string; type: 'list'; placeholder?: string };

type AnyRow = Record<string, unknown> & { id: string; archived: boolean };

function fromRow(fields: FieldDef[], row: AnyRow | null): Record<string, string> {
  return Object.fromEntries(
    fields.map((f) => {
      const v = row?.[f.key];
      if (f.type === 'list') return [f.key, Array.isArray(v) ? v.join(', ') : ''];
      return [f.key, v === null || v === undefined ? '' : String(v)];
    }),
  );
}

function toBody(fields: FieldDef[], values: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => {
      const v = values[f.key]?.trim() ?? '';
      if (f.type === 'number') return [f.key, v === '' ? null : Number(v)];
      if (f.type === 'select') return [f.key, v === '' ? null : v];
      if (f.type === 'list')
        return [
          f.key,
          v
            ? v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        ];
      return [f.key, v];
    }),
  );
}

function RefEditor({
  path,
  title,
  fields,
  columns,
  readOnly,
}: {
  path: RefPath;
  title: string;
  fields: FieldDef[];
  columns: { label: string; render: (row: AnyRow) => React.ReactNode }[];
  readOnly: boolean;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const list = useRefList(path, showArchived);
  const save = useSaveRef(path);
  const archive = useArchiveRef(path);
  const [editing, setEditing] = useState<AnyRow | 'new' | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  function open(row: AnyRow | 'new') {
    setValues(fromRow(fields, row === 'new' ? null : row));
    setEditing(row);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={showArchived}
            onCheckedChange={setShowArchived}
            aria-label="Show archived"
          />
          Show archived
        </label>
        {!readOnly && (
          <Button size="sm" onClick={() => open('new')}>
            <Plus /> Add {title.toLowerCase()}
          </Button>
        )}
      </div>
      {list.error && <ErrorAlert error={list.error} />}
      {!list.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.label}>{c.label}</TableHead>
                ))}
                {!readOnly && <TableHead className="w-28" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 1}
                    className="text-muted-foreground py-6 text-center"
                  >
                    Nothing here yet
                  </TableCell>
                </TableRow>
              )}
              {(list.data as AnyRow[]).map((row) => (
                <TableRow key={row.id} className={row.archived ? 'opacity-60' : ''}>
                  {columns.map((c) => (
                    <TableCell key={c.label}>{c.render(row)}</TableCell>
                  ))}
                  {!readOnly && (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit"
                        onClick={() => open(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={row.archived ? 'Restore' : 'Archive'}
                        onClick={() => archive.mutate({ id: row.id, archived: !row.archived })}
                      >
                        {row.archived ? (
                          <ArchiveRestore className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? `New ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const body = toBody(fields, values);
              save.mutate(editing && editing !== 'new' ? { id: editing.id, ...body } : body, {
                onSuccess: () => setEditing(null),
              });
            }}
          >
            {fields.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                {f.type === 'select' ? (
                  <select
                    id={`f-${f.key}`}
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  >
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`f-${f.key}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    step="any"
                    required={f.type !== 'list' && 'required' in f && f.required}
                    placeholder={'placeholder' in f ? f.placeholder : undefined}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DepartmentTree({ rows }: { rows: Department[] }) {
  const byParent = new Map<string | null, Department[]>();
  for (const d of rows) {
    const list = byParent.get(d.parentId) ?? [];
    list.push(d);
    byParent.set(d.parentId, list);
  }
  const ids = new Set(rows.map((d) => d.id));
  const roots = rows.filter((d) => !d.parentId || !ids.has(d.parentId));
  const render = (d: Department, depth: number): React.ReactNode => (
    <li key={d.id}>
      <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground font-mono text-xs">{d.code}</span>
        <span>{d.name}</span>
      </div>
      {(byParent.get(d.id) ?? []).length > 0 && (
        <ul>{byParent.get(d.id)!.map((c) => render(c, depth + 1))}</ul>
      )}
    </li>
  );
  return (
    <ul className="rounded-md border p-3 text-sm" aria-label="Department tree">
      {roots.map((d) => render(d, 0))}
    </ul>
  );
}

export default function OrganisationPage() {
  const { can } = useAuth();
  const readOnly = !can('org.manage', 'all');
  const grades = useRefList('grades');
  const departments = useRefList('departments');
  const calendars = useCalendars();
  const gradeOptions = (grades.data ?? []).map((g) => ({
    value: g.id,
    label: `${g.code} · ${g.name}`,
  }));
  const deptOptions = (departments.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.code} · ${d.name}`,
  }));
  const calOptions = (calendars.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  const nameOf = (opts: Option[], id: unknown) => opts.find((o) => o.value === id)?.label ?? '—';
  const archivedBadge = (r: AnyRow) =>
    r.archived ? <Badge variant="outline">archived</Badge> : null;

  return (
    <RequirePermission permission={['org.manage', 'settings.manage', 'users.manage']}>
      <PageHeader
        title="Organisation"
        description="Branches, departments, grades, designations and cost centres"
      />
      <Tabs defaultValue="departments">
        <TabsList className="flex-wrap">
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="designations">Designations</TabsTrigger>
          <TabsTrigger value="cost-centers">Cost centres</TabsTrigger>
        </TabsList>

        <TabsContent value="departments" className="space-y-4 pt-4">
          {departments.data && departments.data.length > 0 && (
            <DepartmentTree rows={departments.data} />
          )}
          <RefEditor
            path="departments"
            title="Department"
            readOnly={readOnly}
            fields={[
              { key: 'code', label: 'Code', type: 'text', required: true },
              { key: 'name', label: 'Name', type: 'text', required: true },
              { key: 'parentId', label: 'Parent department', type: 'select', options: deptOptions },
            ]}
            columns={[
              { label: 'Code', render: (r) => <span className="font-mono">{String(r.code)}</span> },
              {
                label: 'Name',
                render: (r) => (
                  <>
                    {String(r.name)} {archivedBadge(r)}
                  </>
                ),
              },
              { label: 'Parent', render: (r) => nameOf(deptOptions, r.parentId) },
            ]}
          />
        </TabsContent>

        <TabsContent value="branches" className="pt-4">
          <RefEditor
            path="branches"
            title="Branch"
            readOnly={readOnly}
            fields={[
              { key: 'code', label: 'Code', type: 'text', required: true },
              { key: 'name', label: 'Name', type: 'text', required: true },
              {
                key: 'calendarId',
                label: 'Work calendar (blank = default)',
                type: 'select',
                options: calOptions,
              },
              {
                key: 'geoLat',
                label: 'Latitude (for clock-in geofence)',
                type: 'number',
                placeholder: '6.9271',
              },
              { key: 'geoLng', label: 'Longitude', type: 'number', placeholder: '79.8612' },
              {
                key: 'geoRadiusM',
                label: 'Geofence radius (metres)',
                type: 'number',
                placeholder: '150',
              },
              {
                key: 'allowedIps',
                label: 'Allowed IPs / CIDR (comma-separated, optional)',
                type: 'list',
                placeholder: '203.0.113.0/24',
              },
            ]}
            columns={[
              { label: 'Code', render: (r) => <span className="font-mono">{String(r.code)}</span> },
              {
                label: 'Name',
                render: (r) => (
                  <>
                    {String(r.name)} {archivedBadge(r)}
                  </>
                ),
              },
              {
                label: 'Calendar',
                render: (r) => (r.calendarId ? nameOf(calOptions, r.calendarId) : 'Default'),
              },
              {
                label: 'Geofence',
                render: (r) => (r.geoLat !== null ? `${String(r.geoRadiusM ?? '?')} m` : '—'),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="grades" className="pt-4">
          <RefEditor
            path="grades"
            title="Grade"
            readOnly={readOnly}
            fields={[
              { key: 'code', label: 'Code', type: 'text', required: true },
              { key: 'name', label: 'Name', type: 'text', required: true },
              { key: 'rank', label: 'Rank (higher = more senior)', type: 'number', required: true },
            ]}
            columns={[
              { label: 'Code', render: (r) => <span className="font-mono">{String(r.code)}</span> },
              {
                label: 'Name',
                render: (r) => (
                  <>
                    {String(r.name)} {archivedBadge(r)}
                  </>
                ),
              },
              { label: 'Rank', render: (r) => String(r.rank) },
            ]}
          />
        </TabsContent>

        <TabsContent value="designations" className="pt-4">
          <RefEditor
            path="designations"
            title="Designation"
            readOnly={readOnly}
            fields={[
              { key: 'title', label: 'Title', type: 'text', required: true },
              { key: 'gradeId', label: 'Grade', type: 'select', options: gradeOptions },
            ]}
            columns={[
              {
                label: 'Title',
                render: (r) => (
                  <>
                    {String(r.title)} {archivedBadge(r)}
                  </>
                ),
              },
              { label: 'Grade', render: (r) => nameOf(gradeOptions, r.gradeId) },
            ]}
          />
        </TabsContent>

        <TabsContent value="cost-centers" className="pt-4">
          <RefEditor
            path="cost-centers"
            title="Cost centre"
            readOnly={readOnly}
            fields={[
              { key: 'code', label: 'Code', type: 'text', required: true },
              { key: 'name', label: 'Name', type: 'text', required: true },
            ]}
            columns={[
              { label: 'Code', render: (r) => <span className="font-mono">{String(r.code)}</span> },
              {
                label: 'Name',
                render: (r) => (
                  <>
                    {String(r.name)} {archivedBadge(r)}
                  </>
                ),
              },
            ]}
          />
        </TabsContent>
      </Tabs>
    </RequirePermission>
  );
}
