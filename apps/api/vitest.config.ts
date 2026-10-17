import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
