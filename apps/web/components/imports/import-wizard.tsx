'use client';

import { CheckCircle2, CircleAlert, FileUp } from 'lucide-react';
import { useState } from 'react';

import {
  csvCell,
  normaliseHeader,
  parseCsv,
  type ImportKind,
  type ImportPreview,
  type ImportReport,
  type ImportTemplate,
} from '@hr/shared';

import { ErrorAlert } from '@/components/common/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { useCommitImport, useImportTemplate, usePreviewImport } from '@/lib/queries/employees';

const IGNORE = '';

/** Reads CSV or XLSX in the browser into a header row + data rows of strings. */
async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    return data.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (cell instanceof Date) {
          // Spreadsheet dates are wall-clock values parsed as UTC; keep the time when there is one.
          const iso = cell.toISOString();
          return iso.endsWith('T00:00:00.000Z')
            ? iso.slice(0, 10)
            : iso.slice(0, 19).replace('T', ' ');
        }
        return String(cell);
      }),
    );
  }
  return parseCsv(await file.text());
}

function autoMap(headers: string[], template: ImportTemplate): string[] {
  return headers.map((h) => {
    const n = normaliseHeader(h);
    const field = template.fields.find(
      (f) =>
        normaliseHeader(f.key) === n || normaliseHeader(f.label) === n || f.aliases.includes(n),
    );
    return field?.key ?? IGNORE;
  });
}

function templateCsv(t: ImportTemplate) {
  return `${t.fields.map((f) => csvCell(f.label)).join(',')}\r\n${t.fields.map((f) => csvCell(f.example ?? '')).join(',')}\r\n`;
}

export function ImportWizard({ kind }: { kind: ImportKind }) {
  const template = useImportTemplate(kind);
  const preview = usePreviewImport(kind);
  const commit = useCommitImport(kind);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);

  if (template.error) return <ErrorAlert error={template.error} />;
  if (!template.data) return <Skeleton className="h-64" />;
  const t = template.data;

  const payload = () => ({
    rows: rows.map((r, i) => ({
      line: i + 2,
      values: Object.fromEntries(mapping.flatMap((key, col) => (key ? [[key, r[col] ?? '']] : []))),
    })),
  });
  const missingRequired = t.fields.filter((f) => f.required && !mapping.includes(f.key));

  if (report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import finished</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="import-report">
          <p>
            <CheckCircle2 className="mr-1 inline size-4 text-green-600" />
            Imported {report.imported} of {report.total} rows.
          </p>
          {report.skippedLines.length > 0 && (
            <p className="text-sm">Skipped lines: {report.skippedLines.join(', ')}</p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setReport(null);
              setRows([]);
              setHeaders([]);
              setResult(null);
              setFileName('');
            }}
          >
            Import another file
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a file</CardTitle>
          <CardDescription>
            CSV or Excel (.xlsx) with a header row, up to {t.maxRows} rows.{' '}
            <a
              className="underline"
              download={`${kind}-template.csv`}
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(t))}`}
            >
              Download a template
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            type="file"
            aria-label="Import file"
            accept=".csv,.xlsx,text/csv"
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              setReadError(null);
              setResult(null);
              try {
                const [head = [], ...data] = await readFile(f);
                setFileName(f.name);
                setHeaders(head);
                setRows(data.filter((r) => r.some((c) => c.trim())));
                setMapping(autoMap(head, t));
              } catch (err) {
                setReadError(err);
              }
            }}
          />
          <ErrorAlert error={readError} title="Could not read the file" />
          {fileName && (
            <p className="text-muted-foreground text-sm">
              <FileUp className="mr-1 inline size-4" />
              {fileName}: {rows.length} data rows, {headers.length} columns
            </p>
          )}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Match columns</CardTitle>
            <CardDescription>
              We matched what we could. Columns set to “Ignore” are not imported.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {headers.map((h, i) => (
                <label key={`${h}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="w-40 truncate font-medium" title={h}>
                    {h || `(column ${i + 1})`}
                  </span>
                  <span aria-hidden>→</span>
                  <select
                    aria-label={`Field for column ${h}`}
                    className="border-input bg-background h-8 flex-1 rounded-md border px-2"
                    value={mapping[i] ?? IGNORE}
                    onChange={(ev) => {
                      const next = [...mapping];
                      next[i] = ev.target.value;
                      setMapping(next);
                      setResult(null);
                    }}
                  >
                    <option value={IGNORE}>Ignore</option>
                    {t.fields.map((f) => (
                      <option
                        key={f.key}
                        value={f.key}
                        disabled={mapping.includes(f.key) && mapping[i] !== f.key}
                      >
                        {f.label}
                        {f.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {missingRequired.length > 0 && (
              <p className="text-destructive text-sm">
                Required: {missingRequired.map((f) => f.label).join(', ')}
              </p>
            )}
            <Button
              disabled={missingRequired.length > 0 || preview.isPending || rows.length === 0}
              onClick={() => preview.mutate(payload(), { onSuccess: setResult })}
            >
              {preview.isPending ? 'Checking…' : 'Check rows'}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Review and import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" data-testid="import-preview">
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge variant="secondary">{result.total} rows</Badge>
              <Badge>{result.valid} ready</Badge>
              {result.errors.length > 0 && (
                <Badge variant="destructive">
                  {new Set(result.errors.map((e) => e.line)).size} with errors
                </Badge>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Line</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errors.map((e, i) => (
                      <TableRow key={`${e.line}-${i}`}>
                        <TableCell>{e.line}</TableCell>
                        <TableCell>
                          {t.fields.find((f) => f.key === e.field)?.label ?? e.field ?? '—'}
                        </TableCell>
                        <TableCell>
                          <CircleAlert className="text-destructive mr-1 inline size-4" />
                          {e.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {result.errors.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={skipInvalid}
                  onCheckedChange={setSkipInvalid}
                  aria-label="Skip rows with errors"
                />
                Import the {result.valid} valid rows and skip the rest
              </label>
            )}
            <Button
              disabled={
                commit.isPending || result.valid === 0 || (result.errors.length > 0 && !skipInvalid)
              }
              onClick={() => commit.mutate({ ...payload(), skipInvalid }, { onSuccess: setReport })}
            >
              {commit.isPending ? 'Importing…' : `Import ${result.valid} rows`}
            </Button>
            <p className="text-muted-foreground text-xs">
              The import is all-or-nothing: if anything fails, nothing is saved.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
