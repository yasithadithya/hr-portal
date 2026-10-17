import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

/**
 * Forward-only SQL migrator (CLAUDE.md Hard Rule 12).
 *
 * Reads drizzle-kit's journal so files apply in generated order, records each applied file with
 * a SHA-256 of its contents, and refuses to run if an applied file was edited or is missing.
 * Each migration runs in its own transaction holding a transaction-level advisory lock, which is
 * safe through transaction-mode poolers (session advisory locks are not).
 */

export const MIGRATIONS_SCHEMA = 'hr_migrations';

export interface MigrationFile {
  name: string;
  hash: string;
  statements: string[];
}

export interface MigrationResult {
  applied: string[];
  pending: string[];
}

export class MigrationIntegrityError extends Error {
  override name = 'MigrationIntegrityError';
}

export class MigrationFailedError extends Error {
  override name = 'MigrationFailedError';
  constructor(
    readonly migration: string,
    override readonly cause: unknown,
    /** Migrations applied earlier in the same run, before the failure. */
    readonly applied: string[] = [],
  ) {
    super(
      `Migration "${migration}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  let journal: Journal;
  try {
    journal = JSON.parse(
      await readFile(path.join(dir, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return Promise.all(
    entries.map(async ({ tag }) => {
      const raw = await readFile(path.join(dir, `${tag}.sql`), 'utf8');
      const content = raw.replace(/\r\n/g, '\n');
      return {
        name: tag,
        hash: createHash('sha256').update(content).digest('hex'),
        statements: content
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }),
  );
}

interface AppliedRow {
  name: string;
  hash: string;
}

async function readApplied(sql: Sql, table: string): Promise<AppliedRow[]> {
  const [exists] = await sql<{ t: string | null }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${table}`}) as t`;
  if (!exists?.t) return [];
  return sql<AppliedRow[]>`
    select name, hash from ${sql(MIGRATIONS_SCHEMA)}.${sql(table)} order by applied_at, name`;
}

function verify(files: MigrationFile[], applied: AppliedRow[]): MigrationFile[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (!file) {
      throw new MigrationIntegrityError(
        `Database has migration "${row.name}" that is not in the migrations folder`,
      );
    }
    if (file.hash !== row.hash) {
      throw new MigrationIntegrityError(
        `Migration "${row.name}" was edited after it was applied. Never edit an applied migration; add a new one.`,
      );
    }
  }
  const done = new Set(applied.map((r) => r.name));
  return files.filter((f) => !done.has(f.name));
}

/** Lock key derived from the ledger table name so control and tenant runs don't block each other. */
function lockKey(table: string): bigint {
  return createHash('sha256').update(`hr:${table}`).digest().readBigInt64BE(0);
}

export async function migrate(
  sql: Sql,
  files: MigrationFile[],
  opts: { table: 'control' | 'tenant'; dryRun?: boolean; log?: (msg: string) => void },
): Promise<MigrationResult> {
  const { table, dryRun = false, log = () => {} } = opts;
  const pending = verify(files, await readApplied(sql, table)).map((f) => f.name);
  if (dryRun || pending.length === 0) return { applied: [], pending };

  // `create ... if not exists` is not race-safe on its own, so take the same lock first.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${lockKey(table).toString()}::bigint)`;
    await tx`create schema if not exists ${tx(MIGRATIONS_SCHEMA)}`;
    await tx`
      create table if not exists ${tx(MIGRATIONS_SCHEMA)}.${tx(table)} (
        name text primary key,
        hash text not null,
        applied_at timestamptz not null default now()
      )`;
  });

  const applied: string[] = [];
  for (const name of pending) {
    const file = files.find((f) => f.name === name)!;
    const ran = await sql
      .begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${lockKey(table).toString()}::bigint)`;
        // Another runner may have applied it while we waited for the lock.
        const [already] = await tx`
        select 1 from ${tx(MIGRATIONS_SCHEMA)}.${tx(table)} where name = ${name}`;
        if (already) return false;
        for (const statement of file.statements) await tx.unsafe(statement);
        await tx`
        insert into ${tx(MIGRATIONS_SCHEMA)}.${tx(table)} (name, hash) values (${name}, ${file.hash})`;
        return true;
      })
      .catch((err: unknown) => {
        throw new MigrationFailedError(name, err, [...applied]);
      });
    if (ran) {
      applied.push(name);
      log(`applied ${name}`);
    }
  }
  return { applied, pending: [] };
}
