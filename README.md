# HR Portal

Multi-client HR portal (Core HR, Leave, Attendance, Sri Lanka payroll, self-service PWA) for Sri Lankan mid-size companies.

- **Rules for contributors (and Claude Code):** [`CLAUDE.md`](CLAUDE.md)
- **Roadmap and phase checklists:** [`docs/PLAN.md`](docs/PLAN.md)

## Prerequisites

- Node.js 20+ (`.nvmrc`)
- pnpm via Corepack: `corepack enable` (version pinned in `package.json`)
- Docker Desktop, for the local Supabase stack

## Setup

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm supabase start -x realtime,logflare,vector,imgproxy,edge-runtime,supavisor,studio,postgres-meta
pnpm dev:setup             # writes .env, migrates the control plane, provisions the "dev" tenant
pnpm dev                   # API on :4000, web on :3000 → open http://localhost:3000
```

Local Supabase acts as both the control plane (schema `platform`) and the `dev` tenant (schema `public`).

### Using the remote Supabase project (control plane + dev tenant)

Put these in the repo-root `.env` (never commit it). URL-encode special characters in the password (`@` → `%40`, `!` → `%21`):

```sh
CONTROL_DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres
CONTROL_DATABASE_DIRECT_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
CONTROL_SUPABASE_URL=https://<ref>.supabase.co
MASTER_KEY=<openssl rand -base64 32>      # back this up; losing it makes tenant secrets unreadable
TENANT_DB_URL=<same as CONTROL_DATABASE_URL>
TENANT_DB_DIRECT_URL=<same as CONTROL_DATABASE_DIRECT_URL>
TENANT_SUPABASE_URL=https://<ref>.supabase.co
TENANT_ANON_KEY=<anon key>
TENANT_SERVICE_ROLE_KEY=<service role key>
```

Then `pnpm control:migrate` and `pnpm tenant:create --slug <slug> --name "<Company>" --admin-email <email> --existing-project <ref>`.

## Commands

| Command                                                        | What it does                                          |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                                                     | API (`tsx watch`) + web (`next dev`)                  |
| `pnpm build`                                                   | Build every package/app                               |
| `pnpm typecheck && pnpm lint && pnpm test`                     | Must pass before a slice is done                      |
| `pnpm test:e2e`                                                | Playwright smoke tests (builds web, starts api + web) |
| `pnpm format`                                                  | Prettier                                              |
| `pnpm db:generate`                                             | drizzle-kit generate for the tenant schema            |
| `pnpm supabase <cmd>`                                          | Supabase CLI (`start`, `stop`, `status`)              |
| `pnpm tenants:migrate`, `pnpm tenant:create`, `pnpm seed:demo` | Arrive in Phase 1                                     |

## Layout

```
apps/api           Express 5 API (src/modules/<module>/{routes,service,repo}.ts)
apps/web           Next.js App Router PWA
packages/shared    Zod contracts, envelope, tenant-timezone time and money helpers
packages/db        Tenant DB schema + migrations (Drizzle)
packages/control-db  Control-plane schema + migrations
packages/payroll   Pure payroll engine + golden fixtures
packages/config    tsconfig / ESLint / Prettier
reference/uqms-hr  Old implementation; read-only reference, never copied
```
