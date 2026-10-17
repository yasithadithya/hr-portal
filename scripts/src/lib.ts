import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { controlDb, parseMasterKey, type ControlDb } from '@hr/control-db';
import { connect } from '@hr/db';

// Load the repo-root .env (gitignored). Real env vars win over the file.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Reads a required env var. Secrets come from env/.env only, never from CLI args. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (add it to the repo-root .env)`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Opens the control plane. Migrations/scripts prefer the direct (session) URL. */
export function openControl(opts: { direct?: boolean } = {}) {
  const url =
    (opts.direct ? optionalEnv('CONTROL_DATABASE_DIRECT_URL') : undefined) ??
    requireEnv('CONTROL_DATABASE_URL');
  const sql = connect(url, { max: 2 });
  const db: ControlDb = controlDb(sql);
  return { sql, db };
}

export function masterKey(): Buffer {
  return parseMasterKey(process.env.MASTER_KEY);
}

export function log(msg: string): void {
  console.log(msg);
}

export async function main(fn: () => Promise<number | void>): Promise<void> {
  try {
    const code = await fn();
    process.exit(code ?? 0);
  } catch (err) {
    console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
