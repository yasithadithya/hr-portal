import { withAudit, type Tx } from '@hr/db';
import type { ImportField, ImportKind, ImportPreview, ImportReport, RowError } from '@hr/shared';

import type { AuthedUser, RequestContext } from '../../context';

export type ImportCtx = RequestContext & { user: AuthedUser };

export interface RawRow {
  line: number;
  values: Record<string, string>;
}

/**
 * One importer per kind. `prepare` loads lookups once; `validate` checks each row (including
 * cross-row rules like duplicates via `state`); `commit` writes the valid rows inside the single
 * import transaction.
 */
export interface ImportDefinition<Lookups, Valid> {
  kind: ImportKind;
  title: string;
  fields: ImportField[];
  /** Loads lookups once; sees all rows so rows can reference each other (e.g. managers). */
  prepare(ctx: ImportCtx, rows: RawRow[]): Promise<Lookups>;
  validate(
    row: RawRow,
    lookups: Lookups,
    state: Map<string, number>,
  ): { value?: Valid; errors: RowError[] };
  commit(
    ctx: ImportCtx,
    tx: Tx,
    rows: { line: number; value: Valid }[],
    lookups: Lookups,
  ): Promise<number>;
}

interface Checked<V> {
  valid: { line: number; value: V }[];
  errors: RowError[];
  invalidLines: number[];
}

async function check<L, V>(
  ctx: ImportCtx,
  def: ImportDefinition<L, V>,
  rows: RawRow[],
): Promise<Checked<V> & { lookups: L }> {
  const lookups = await def.prepare(ctx, rows);
  const state = new Map<string, number>();
  const out: Checked<V> = { valid: [], errors: [], invalidLines: [] };
  for (const row of rows) {
    const missing = def.fields
      .filter((f) => f.required && !(row.values[f.key] ?? '').trim())
      .map((f) => ({ line: row.line, field: f.key, message: `${f.label} is required` }));
    const res = missing.length ? { errors: missing } : def.validate(row, lookups, state);
    if (res.errors.length || res.value === undefined) {
      out.errors.push(...res.errors);
      out.invalidLines.push(row.line);
    } else {
      out.valid.push({ line: row.line, value: res.value });
    }
  }
  return { ...out, lookups };
}

export async function previewImport<L, V>(
  ctx: ImportCtx,
  def: ImportDefinition<L, V>,
  rows: RawRow[],
): Promise<ImportPreview> {
  const c = await check(ctx, def, rows);
  return { total: rows.length, valid: c.valid.length, errors: c.errors };
}

export class ImportBlockedError extends Error {
  constructor(readonly preview: ImportPreview) {
    super('Fix the errors (or choose to skip invalid rows) before importing');
  }
}

/** Validates again (never trust the preview) and writes all valid rows atomically. */
export async function commitImport<L, V>(
  ctx: ImportCtx,
  def: ImportDefinition<L, V>,
  rows: RawRow[],
  skipInvalid: boolean,
): Promise<ImportReport> {
  const c = await check(ctx, def, rows);
  const preview = { total: rows.length, valid: c.valid.length, errors: c.errors };
  if (c.errors.length && !skipInvalid) throw new ImportBlockedError(preview);
  const imported = await withAudit(ctx.db, ctx.actor, 'imports', async (tx) => {
    const n = c.valid.length ? await def.commit(ctx, tx, c.valid, c.lookups) : 0;
    return {
      action: `import_${def.kind}`,
      entityId: null,
      after: { total: rows.length, imported: n, skippedLines: c.invalidLines },
      result: n,
    };
  });
  return { ...preview, imported, skippedLines: c.invalidLines };
}
