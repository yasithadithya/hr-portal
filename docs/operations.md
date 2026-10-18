# HR Portal — Operations runbook

## Topology
- **API** (Express) + **web** (Next.js) — stateless; the API also runs the **pg-boss job worker** (`JOBS_ENABLED=true`).
- **Control plane** Postgres (schemas `platform` and `pgboss`).
- **One Supabase project per client** (database, auth, storage), region ap-southeast-1.

## Deploying a release
1. `pnpm typecheck && pnpm lint && pnpm test` (CI does this, plus Playwright).
2. **`pnpm control:migrate` first**, then **`pnpm tenants:migrate`** (the fan-out reads control-plane columns). Use `--dry-run` to preview; failures are recorded per tenant (`/platform/v1/tenants/:slug/migrations`).
3. Deploy API and web. Seeds re-run with the fan-out (idempotent; they never overwrite client configuration).

## Environment (see `.env.example`)
Required: `CONTROL_DATABASE_URL`, `MASTER_KEY`, `CONTROL_SUPABASE_URL`. Jobs: `JOBS_DATABASE_URL` (session/direct URL, **not** the 6543 transaction pooler). Email: `EMAIL_PROVIDER` (`smtp`/`resend`), `SMTP_URL` or `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`. Errors: `SENTRY_DSN` (API) and `NEXT_PUBLIC_SENTRY_DSN` (web, build time). Rate limits: `RATE_LIMIT_PER_IP` (1200/min), `RATE_LIMIT_PER_TENANT` (10000/min), `RATE_LIMIT_SENSITIVE_PER_IP` (120/min) — in-memory per instance. Web CSP: `CSP_CONNECT_EXTRA` (set to `""` in production unless another origin is needed).

## Backups and restore drill
Supabase backups are per project — **check each client project** when provisioning:
1. Dashboard → Project → Database → Backups: confirm **daily backups** are listed; enable **Point-in-Time Recovery (PITR)** on paid plans (recommended: 7+ days).
2. The control-plane project needs the same.
3. Record in the provisioning checklist: backup type, retention, date verified.

**Restore drill (quarterly, on a staging tenant):**
1. Note a recognisable change (e.g. create employee `DRILL-<date>`), wait 10 minutes, then delete it.
2. Restore the staging project to a point before the deletion (Supabase PITR → new project or in place).
3. If restored to a new project: `pnpm tenant:create --existing-project <new-ref> --slug staging-restore …` (credentials via env), then `pnpm tenants:migrate --tenant=staging-restore`.
4. Sign in, confirm `DRILL-<date>` exists, payroll runs and payslips open, and the audit log is intact.
5. Write the date, duration and any problems in the drill log. Delete the restored project.

Storage objects (documents, photos, logos) are backed up with the project's storage; verify a document downloads after the drill.

## Monitoring
- **Health**: `GET /health` (API), `/healthz` through the web app.
- **Errors**: Sentry, tagged `tenant` (slug), `request_id`, `job`. No request bodies or user identity are sent.
- **Logs**: pino JSON to stdout — ship with the platform's log drain (Render/Fly/Railway/…); every line has the request id; errors include the tenant slug.
- **Pools**: `GET /platform/v1/pools` (open pools, hits, evictions).
- **Jobs**: `GET /platform/v1/jobs` (counts per queue/state and the last 20 failures). Every job failure is also logged (`job failed`) and reported to Sentry — alert on it. Jobs retry 3 times with backoff.
- **Daily job** (01:30 Asia/Colombo): future-dated job changes, attendance for yesterday, HR reminders, PDPA retention. Check the `daily tenant job done` log line per tenant.

## Rotate the master key (tenant secrets)
1. Generate: `openssl rand -base64 32`. Store it in the secret manager as `NEW_MASTER_KEY` (never on a command line or in chat).
2. With both `MASTER_KEY` (current) and `NEW_MASTER_KEY` in the environment: `pnpm secrets:rotate-master-key --dry-run`, then without `--dry-run`. It decrypts everything first, verifies the new ciphertexts and writes all rows in **one transaction**.
3. Set `MASTER_KEY` to the new value on every API instance and restart. Keep the old key for 30 days in the secret manager (for restoring older backups), then destroy it.

**Client secrets** (Supabase DB password, service-role key): rotate in the Supabase dashboard, put the new values in the environment as `TENANT_DB_URL`, `TENANT_DB_DIRECT_URL`, `TENANT_SUPABASE_URL`, `TENANT_ANON_KEY`, `TENANT_SERVICE_ROLE_KEY`, run `pnpm tenant:update-secrets --slug <slug>`, then remove them from the environment. Running API instances use the new values within 60 s (registry cache). Web-push keys are kept.

## Billing (manual v1)
1. Set plan prices: `PUT /platform/v1/plans/standard` `{ "pricePerEmployee": "…", "minimumMonthly": "…" }`.
2. After month end: `POST /platform/v1/billing/snapshot { "month": "YYYY-MM" }` (counts employees employed at any time in the month, per active tenant; re-running replaces the month).
3. `GET /platform/v1/billing/invoices.csv?month=YYYY-MM` → raise invoices in the accounting system.

## Security notes
- Dependency audit: `pnpm audit --prod`. Accepted: `braces` advisory via `@next/eslint-plugin-next` (lint tooling only, never shipped; no patched version).
- Uploads are type-sniffed (magic bytes; SVG without scripts). Antivirus scanning of uploads is **not** in v1 — add a scanning step (e.g. ClamAV) before accepting documents from untrusted sources.
- Signed URLs: documents/attachments 60 s, logo 1 h.
