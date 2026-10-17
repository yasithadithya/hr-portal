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
pnpm supabase start        # local Postgres/Auth/Storage in Docker (prints URLs and keys)
pnpm dev                   # API on :4000, web on :3000
```

The local Supabase instance is both the "platform" (control plane) and a single dev tenant until Phase 1 adds provisioning.

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
