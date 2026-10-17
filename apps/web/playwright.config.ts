import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @hr/api dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !CI,
      env: { CORS_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'warn' },
    },
    {
      // Production build: dev-mode compiles on first visit are too slow for stable timeouts.
      command: 'pnpm --filter @hr/web build && pnpm --filter @hr/web start',
      url: 'http://localhost:3000',
      reuseExistingServer: !CI,
      timeout: 300_000,
    },
  ],
});
