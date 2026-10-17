import { execSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup() {
  execSync('pnpm dev:users', {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
  });
}
