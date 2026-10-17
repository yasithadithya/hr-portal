import { z } from 'zod';

/**
 * Bulk-import framework contracts (PLAN.md Phase 4; reused for leave balances, attendance,
 * salaries). The browser parses CSV/XLSX, the user maps file columns to fields, and the API
 * validates every row, previews errors, then commits the valid rows in one transaction.
 */
export const IMPORT_KINDS = ['employees', 'leave-balances'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const importFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
  example: z.string().optional(),
  /** Header spellings auto-matched to this field. */
  aliases: z.array(z.string()).default([]),
});
export type ImportField = z.infer<typeof importFieldSchema>;

export const importTemplateSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  title: z.string(),
  fields: z.array(importFieldSchema),
  maxRows: z.number().int(),
});
export type ImportTemplate = z.infer<typeof importTemplateSchema>;

export const MAX_IMPORT_ROWS = 5000;

export const importRequestSchema = z.object({
  /** Rows already mapped to field keys; `line` is the row's line number in the source file. */
  rows: z
    .array(z.object({ line: z.number().int().min(1), values: z.record(z.string(), z.string()) }))
    .min(1, 'The file has no data rows')
    .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows per import`),
});
export type ImportRequest = z.input<typeof importRequestSchema>;

export const importCommitSchema = importRequestSchema.extend({
  /** Import the valid rows and skip the rest. Without it, any error blocks the import. */
  skipInvalid: z.boolean().default(false),
});

export const rowErrorSchema = z.object({
  line: z.number().int(),
  field: z.string().nullable(),
  message: z.string(),
});
export type RowError = z.infer<typeof rowErrorSchema>;

export const importPreviewSchema = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  errors: z.array(rowErrorSchema),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importReportSchema = importPreviewSchema.extend({
  imported: z.number().int(),
  skippedLines: z.array(z.number().int()),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/** Normalises a header for auto-matching ("Employee No." → "employee_no"). */
export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
