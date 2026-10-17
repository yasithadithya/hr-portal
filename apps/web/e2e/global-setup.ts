import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function globalSetup() {
  execSync('pnpm dev:users', {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
  });
  // Warm the web → API proxy and the tenant pool so the first test isn't a cold start.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:3000/api/v1/public/tenant', {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
