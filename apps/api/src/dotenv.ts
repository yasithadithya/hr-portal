import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Development convenience: load the repo-root .env (then apps/api/.env) if present.
// Real environment variables always win; production sets env directly.
if (process.env.NODE_ENV !== 'production') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [path.resolve(here, '../../../.env'), path.resolve(here, '../.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
