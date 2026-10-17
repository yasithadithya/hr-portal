import { defineConfig } from 'vitest/config';

// Unit tests only; Playwright owns e2e/.
export default defineConfig({
  test: { include: ['**/*.test.{ts,tsx}'], exclude: ['node_modules/**', 'e2e/**', '.next/**'] },
});
