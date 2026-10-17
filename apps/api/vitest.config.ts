import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each integration file opens ~15 Postgres connections (control + tenant pools); running
    // files one at a time keeps us well under local Postgres's max_connections.
    fileParallelism: false,
  },
});
