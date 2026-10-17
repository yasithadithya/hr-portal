import { connect } from './connection';

/**
 * Test helpers: throwaway databases on a local Postgres (local Supabase by default, or the CI
 * service container). Never point TEST_DATABASE_URL at a shared or production server.
 */
export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function createTestDatabase(name: string): Promise<string> {
  if (!/^hr_test_[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe test database name: ${name}`);
  const admin = connect(TEST_ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  return withDatabase(TEST_ADMIN_URL, name);
}

export async function dropTestDatabase(name: string): Promise<void> {
  if (!/^hr_test_[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe test database name: ${name}`);
  const admin = connect(TEST_ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.end();
  }
}
