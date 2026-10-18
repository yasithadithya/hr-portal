# HR Portal — Development Plan (v1)

Owner: Yasith · Built with Claude Code · Target: Sri Lankan mid-size companies
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 0. Decisions already made

| Topic | Decision |
|---|---|
| Market | Sri Lanka only. **Every statutory value configurable** (rates, tax tables, entitlements, formulas), effective-dated. |
| v1 scope | Core HR + Leave + Attendance + full SL Payroll + Self-service PWA. |
| Tenancy | **One Supabase project per client.** Separate control-plane project for the platform. |
| UQMS | Stays on its own module. No data migration. Old code is reference only (`reference/uqms-hr/`), not copied. |
| Stack | Next.js (PWA) + Express/TS + Supabase Postgres/Auth/Storage, Drizzle ORM, pnpm/Turborepo monorepo. |

### Deferred to v1.1+ (do NOT build in v1)
Performance & appraisals, training, on/offboarding checklists, announcements, recruitment/ATS, expense claims, assets, HR letter generation, gratuity, disciplinary/grievance, surveys, SSO, native mobile apps, self-serve signup & online billing.

---

## 1. Architecture

```
                 ┌──────────────────────────── Control plane (Supabase project "platform") ───┐
                 │ tenants, tenant_domains, tenant_secrets(enc), plans, migrations_status,    │
                 │ platform_admins, pg-boss jobs                                             │
                 └───────────────▲───────────────────────────────────────────────────────────┘
                                 │ resolve tenant by host, get DB URL + Supabase keys
 acme.hrportal.lk ──► Next.js (Vercel) ──► Express API (Railway/Fly, Singapore)
        │                 │                     │  pool per tenant (LRU, max N)
        │  Supabase Auth  │                     ▼
        └──── (tenant's own project) ◄──  Tenant DB: Supabase project "acme"  (Postgres + Auth + Storage)
                                          Tenant DB: Supabase project "beta"  ...
```

### Tenant resolution
1. Request arrives with `Host: acme.hrportal.lk` (or custom domain).
2. Express `tenantMiddleware` looks up `tenant_domains` (cached 60 s) → `tenant` (status must be `active`).
3. Gets/creates a postgres.js pool for that tenant (Supavisor **transaction mode**, port 6543, `prepare: false`). LRU-evict idle pools.
4. Web app gets tenant public config from `GET /api/v1/public/tenant` → `{ name, logoUrl, supabaseUrl, supabaseAnonKey, theme }` and initialises Supabase Auth client for **that** project.

### Auth
- Users live in each tenant's Supabase Auth. Login = email+password or magic link; MFA (TOTP) optional per tenant setting.
- Express verifies the bearer JWT against the tenant's JWKS (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`), cached.
- `app_users` table in tenant DB maps `auth_user_id → employee_id, role_ids, status`.
- No public signup. Users are **invited** by HR (Supabase admin `inviteUserByEmail` using the tenant's service-role key from `tenant_secrets`).

### Secrets
`tenant_secrets` stores DB URL + service-role key encrypted with AES-256-GCM using `MASTER_KEY` from env (never in DB). Only the API can decrypt.

### Why this shape
- Per-client project gives hard isolation (your choice). The cost is operational: provisioning automation, a migration fan-out runner, per-tenant pools, per-tenant auth config. These are Phase 1 work, not afterthoughts.

---

## 2. Repository layout

```
hr-portal/
  apps/
    api/            Express app (src/modules/<module>/{routes,service,repo}.ts)
    web/            Next.js app (app/(auth), app/(app)/..., app/(app)/me/...)
  packages/
    shared/         zod schemas, types, permission keys, time & money helpers
    db/             tenant Drizzle schema + migrations + seeds (SL defaults)
    control-db/     control-plane schema + migrations
    payroll/        pure calculation engine + golden fixtures
    config/         tsconfig/eslint/prettier
  scripts/          tenant:create, tenants:migrate, seed:demo
  reference/uqms-hr/   (optional, read-only, not built)
  docs/PLAN.md  CLAUDE.md
```

---

## 3. Phase overview

| # | Phase | Outcome | Rough size* |
|---|---|---|---|
| 0 | Foundations | Monorepo, CI, lint, test, envs, API skeleton, web shell | S |
| 1 | Control plane & provisioning | Create a client with one command; migrate all clients | L |
| 2 | Auth, RBAC, audit | Invite → login → role/scope-checked API; audit log | M |
| 3 | Company settings & org | Work week, timezone, branches, departments, grades, numbering | M |
| 4 | Employee core | Employee master, history, documents, CSV import/export, org chart | L |
| 5 | Leave | Policy-driven leave with ledger, approvals, calendar | L |
| 6 | Attendance | Shifts, PWA clock-in, device import, regularisation, monthly lock | L |
| 7 | Payroll (SL) | Configurable engine, runs, payslips, statutory & bank exports | XL |
| 8 | Self-service PWA & notifications | Installable app, approvals inbox, web push, email | M |
| 9 | Dashboards & reports | HR/payroll dashboards, exports | M |
| 10 | Hardening & launch | Security, PDPA, backups, observability, demo tenant | M |

*S ≈ 2–4 days, M ≈ 1–2 weeks, L ≈ 2–3 weeks, XL ≈ 4–6 weeks, solo with Claude Code. Treat as guesses.

Order matters: 0 → 1 → 2 → 3 → 4, then 5 and 6 (any order), then 7 (needs 4, 5, 6), then 8–10.

---

## Phase 0 — Foundations

**Goal:** an empty but production-shaped monorepo where every later phase just adds modules.

- [x] pnpm + Turborepo workspace with packages listed in §2; strict TS everywhere
- [x] ESLint + Prettier + lint-staged + husky; commitlint (conventional commits)
- [x] `apps/api`: Express 5, helmet, cors (tenant-aware origin check), pino-http with request id, Zod validation middleware, error handler producing the standard envelope, `/health` — CORS uses a pluggable `isOriginAllowed` hook (env allowlist now; tenant-domain lookup in Phase 1)
- [x] `apps/web`: Next.js App Router, Tailwind, shadcn/ui, TanStack Query, API client generated from `packages/shared` schemas (typed fetch wrapper), app shell with sidebar/topbar, light/dark
- [x] Serwist PWA set-up (manifest, icons placeholder, offline fallback page)
- [x] `packages/shared`: `time` (tenant-tz helpers: `today(tz)`, `isWeekend(date, workWeek)`, `eachDay(start,end)`), `money` (decimal.js wrapper, `round(value, mode, scale)`), envelope types
- [x] Vitest in all packages; Playwright skeleton in `apps/web`
- [~] GitHub Actions: install → typecheck → lint → test on PR — workflow written; first green run pending a GitHub remote
- [~] `.env.example` for api/web; local dev uses Supabase CLI (`supabase start`) as both "platform" and one "dev tenant" — config committed; `pnpm supabase start` not yet run on this machine

**Done when:** `pnpm dev` runs both apps, `/health` returns OK, CI green, a unit test in `shared/time` proves weekend detection uses tenant tz, not server tz.

**Prompt for Claude Code:**
> Read CLAUDE.md and docs/PLAN.md. Execute Phase 0 only. Start in plan mode and list the files you will create.

---

## Phase 1 — Control plane & tenant provisioning

**Goal:** `pnpm tenant:create` turns a new client into a working, migrated, seeded portal without clicking in the Supabase dashboard.

### Control-plane tables (`packages/control-db`)
- `tenants(id, slug unique, name, status[provisioning|active|suspended|archived], plan_id, supabase_project_ref, region, timezone default 'Asia/Colombo', created_at)`
- `tenant_domains(id, tenant_id, host unique, is_primary)`
- `tenant_secrets(tenant_id pk, db_url_enc, service_role_key_enc, anon_key, supabase_url, jwks_url, rotated_at)`
- `tenant_migrations(tenant_id, migration_name, applied_at, status, error)`
- `plans(id, name, max_employees, features jsonb)` — feature flags per plan
- `platform_admins(id, email)`
- `provisioning_events(id, tenant_id, step, status, payload, at)`

### Provisioning script (`scripts/tenant-create.ts`)
- [~] Calls Supabase **Management API** (`SUPABASE_ACCESS_TOKEN`, org id) to create project in ap-southeast-1 with a generated DB password — v1 registers an existing project (`--existing-project <ref>`, credentials from env); auto-create waits for a token
- [~] Polls until healthy; fetches API keys; stores encrypted secrets — secrets stored encrypted (AES-256-GCM); polling/fetching comes with auto-create
- [~] Configures Auth via Management API: site URL `https://<slug>.hrportal.lk`, redirect URLs, disable signups, SMTP (shared sender), email templates (invite/reset with tenant name) — printed as a manual checklist and logged as `skipped` until a Management API token exists
- [x] Creates private storage buckets: `employee-documents`, `employee-photos`, `payslips`, `imports`
- [x] Runs all tenant migrations, then SL default seeds (Phase 3/5/7 seeds register themselves into a seed registry)
- [x] Invites first Owner user
- [x] Every step idempotent and logged to `provisioning_events`; `--resume` continues a failed run

### Migration fan-out (`scripts/tenants-migrate.ts`)
- [x] Applies `packages/db` migrations to each active tenant sequentially (or with `--concurrency=N`), records per-tenant status, stops on first failure unless `--continue-on-error`
- [x] `--dry-run` prints pending migrations per tenant
- [x] CI job runs migrations against a throwaway tenant DB to catch broken SQL

### API plumbing
- [x] `tenantMiddleware` (host → tenant, cached), per-tenant pool manager with LRU + idle timeout + metrics
- [x] `GET /api/v1/public/tenant` (branding + Supabase public config)
- [x] Platform admin API (protected by separate platform auth): list tenants, suspend/activate, view provisioning & migration status

**Done when:** creating two tenants locally/staging gives two isolated DBs; a request to `a.localhost` can never return data from `b`; a new migration reaches both via one command. Integration test proves cross-tenant isolation.

**Risks:** Supabase Management API rate limits and project creation time (minutes) → provisioning runs as a background job with status polling. Per-project cost scales linearly with clients → track in `plans`.

---

## Phase 2 — Auth, RBAC, audit

### Tenant tables
- `app_users(id, auth_user_id unique, employee_id null, email, status[invited|active|disabled], last_login_at)`
- `roles(id, key, name, is_system)` — seeded: `owner`, `hr_admin`, `payroll_admin`, `manager`, `employee`
- `role_permissions(role_id, permission_key, scope[self|team|all])`
- `user_roles(user_id, role_id)`
- `audit_log(id, actor_user_id, action, entity, entity_id, before jsonb, after jsonb, ip, user_agent, at)` — append-only (revoke update/delete)

### Permission keys (in `packages/shared/permissions.ts`)
`employees.{read,create,update,archive}`, `org.manage`, `documents.{read,manage}`, `leave.{read,apply,approve,manage}`, `attendance.{read,clock,regularize,approve,manage}`, `payroll.{read,run,approve,lock,configure}`, `payslips.read`, `settings.manage`, `users.manage`, `reports.read`, `audit.read`.

### Work
- [x] JWT verification middleware (tenant JWKS, cached), loads `app_users` + effective permissions into `req.ctx`
- [x] `requirePermission('leave.approve')` + `scopeFilter(ctx, 'leave.read')` helper that returns a Drizzle `where` for self/team/all (team = recursive `reports_to` subtree)
- [x] Repository helper `withAudit(ctx, entity, fn)` used by all writes
- [x] Invite flow (HR invites → Supabase invite email → set password → first login links `app_users`)
- [x] Web: login, magic link, forgot/reset password, accept invite, MFA enrol (if enabled), route guards from permissions, 403 page
- [x] Users & roles admin screens; custom roles allowed (copy a system role then edit) — plus an audit-log viewer

**Done when:** e2e: owner invites HR admin → HR admin logs in → sees only permitted menus; API IDOR tests for self/team/all pass; every write appears in audit log.

---

## Phase 3 — Company settings & organisation

### Tables
- `company_profile(name, legal_name, reg_no, epf_reg_no, etf_reg_no, tin, address, logo_path, timezone, currency 'LKR', fiscal_year_start_month 4)`
- `work_calendars(id, name, work_week jsonb {mon:'full',..., sat:'half', sun:'off'}, is_default)`
- `holidays(id, calendar_id, date, name, type[public|bank|mercantile|poya|company])` — SL has Poya, bank and mercantile holidays; types are data, not enum logic
- `branches(id, name, address, calendar_id, geo_lat, geo_lng, geo_radius_m, allowed_ips text[])`
- `departments(id, name, code, parent_id, head_employee_id)`
- `grades(id, code, name, rank)`; `designations(id, title, grade_id)`
- `cost_centers(id, code, name)`
- `number_sequences(key, prefix, next_value, padding)` — e.g. employee number `EMP-0001`
- `settings(key, value jsonb, updated_by)` — generic typed settings (validated by Zod per key)

### Work
- [x] CRUD API + screens for all of the above; departments as tree
- [~] Holiday import: CSV upload + "copy from last year" + seed of the current year's SL holidays (marked "verify") — CSV import (with preview) and copy-year are done; **the SL holiday seed is waiting on the official gazette list** (not guessed: Poya/lunar dates move every year)
- [x] Settings screen grouped: Company, Work week, Numbering, Security (MFA required?), Branding (logo, primary colour)

**Done when:** a tenant can be fully configured from the UI, and `shared/time` helpers use `work_calendars` + `holidays` for working-day counts (unit tested incl. half-day Saturday).

---

## Phase 4 — Employee core

### Tables
- `employees(id, employee_no unique, first_name, last_name, name_with_initials, preferred_name, nic, passport_no, dob, gender, marital_status, nationality, religion null, personal_email, work_email, mobile, address jsonb, photo_path, branch_id, department_id, designation_id, grade_id, cost_center_id, reports_to_id, employment_type[permanent|contract|probation|intern|part_time|consultant], status[active|on_probation|notice|resigned|terminated|retired], join_date, probation_end_date, confirmation_date, contract_end_date, exit_date, exit_reason, bank_name, bank_branch, bank_account_no, bank_account_name, epf_no, etf_no?, tax_file_no, archived_at)`
- `employee_job_history(id, employee_id, effective_from, effective_to, department_id, designation_id, grade_id, branch_id, reports_to_id, employment_type, reason[hire|promotion|transfer|redesignation|confirmation|...], notes)` — **effective-dated**; current values on `employees` are a projection kept in sync in the same transaction
- `employee_contacts(id, employee_id, type[emergency|dependent], name, relationship, phone, dob)`
- `employee_documents(id, employee_id, category, title, storage_path, mime, size, expiry_date, uploaded_by)`
- `employee_change_requests(id, employee_id, fields jsonb, status, reviewed_by)` — for self-service edits (Phase 8 uses it)

### Work
- [x] NIC validation for old (9 digits + V/X) and new (12 digits) formats, optional DOB/gender derivation shown as a suggestion (not auto-overwrite)
- [x] Employee list: search, filters (dept, branch, status, type), column chooser, server pagination
- [x] Employee profile page with tabs: Overview, Job (history timeline), Personal, Contacts, Bank & statutory, Documents, (later: Leave, Attendance, Payroll)
- [x] Actions: hire, transfer/promote (writes job history), confirm probation, set notice, exit (sets exit date + status; blocks future payroll after final run)
- [~] Documents: upload to tenant storage (private), signed URLs (60 s), expiry tracking + daily job flags documents expiring in N days (setting) — upload/list/signed URL/delete and the expiring-documents query are done; the **daily job** arrives with the job runner in Phase 8
- [x] **CSV/XLSX bulk import** for employees: upload → column mapping → validation preview (row-level errors) → commit in a transaction → import report. Same framework reused later for salaries, leave opening balances, attendance
- [x] Export (CSV/XLSX) of the filtered list — CSV with UTF-8 BOM (opens in Excel); native XLSX export not built
- [x] Org chart view from `reports_to_id`
- [~] Probation/contract-end reminders (job → notification in Phase 8) — `GET /employees/upcoming` lists them; delivery comes with Phase 8 notifications

**Done when:** importing a 500-row sample file with deliberate errors shows clear row errors and imports the valid set atomically; job history correctly answers "what was this person's department on date X" (test).

---

## Phase 5 — Leave

### Tables
- `leave_types(id, code, name, is_paid, unit[day|half_day|hour], color, requires_attachment_after_days, max_consecutive_days, min_notice_days, allow_negative, gender_restriction null, is_active)`
- `leave_policies(id, leave_type_id, name, applies_to jsonb {employment_types, grades, branches}, entitlement_days, accrual[upfront_yearly|monthly|none], proration_on_join[none|monthly|daily], eligible_after_months, carry_forward_max, carry_forward_expiry_months, encashable, effective_from)`
- `leave_ledger(id, employee_id, leave_type_id, period_year, entry_type[opening|accrual|carry_forward|taken|reversal|adjustment|expiry|encashment], days numeric(6,2), ref_type, ref_id, note, created_by, at)`
- `leave_requests(id, employee_id, leave_type_id, start_date, end_date, start_half[full|first|second], end_half, days numeric(6,2), reason, attachment_path, status[pending|approved|rejected|cancelled|withdrawn], current_approver_id, decided_by, decided_at, decision_note)`
- `leave_request_days(request_id, date, portion)` — materialised working days (respecting calendar + holidays + half days)
- `approval_flows(id, module, steps jsonb)` — v1 supports: direct manager → (optional) HR; reused by attendance regularisation

### Rules
- Balance = `SUM(leave_ledger.days)` per employee/type/year (view `leave_balances_v`); pending requests shown separately as "reserved".
- Apply = validate policy (notice, max consecutive, eligibility, attachment, overlap with other requests, balance unless allow_negative) **in a transaction with row lock** on the employee.
- Approve writes `taken` ledger entries; cancel-after-approve writes `reversal`.
- Year-end job: accrue next year, carry forward up to cap, expire excess; all as ledger entries (re-runnable, idempotent per year).
- Short leave (e.g. 2 hours) supported via `unit = hour` types.
- **Seeds (editable, flagged "verify with client"):** Annual, Casual, Sick/Medical, Maternity, No-pay, Short leave, Lieu leave. Do not hard-code entitlement law in code.

### Work
- [x] Leave types & policies admin; policy preview ("who does this apply to")
- [x] Opening balance import (uses Phase 4 import framework)
- [x] Apply leave (half-days, attachment), my requests, cancel/withdraw
- [x] Approvals inbox for managers/HR; bulk approve
- [x] Team calendar (month view; who's off), company calendar with holidays
- [~] Balance report and leave liability report (days × daily rate later from payroll) — balance report done; liability (× daily rate) needs payroll (Phase 7)
- [x] Year-end processing screen with dry-run preview

**Done when:** golden tests for day counting (weekends, half Saturday, holidays, half-day start/end), concurrency test (two simultaneous requests cannot overspend), year-end carry-forward/expiry tests.

---

## Phase 6 — Attendance

### Tables
- `shifts(id, name, start_time, end_time, break_minutes, grace_late_minutes, early_leave_grace, half_day_threshold_minutes, ot_after_minutes, is_night_shift)`
- `shift_assignments(id, employee_id, shift_id, effective_from, effective_to)` + optional `roster_entries(employee_id, date, shift_id)` for rotating rosters
- `attendance_punches(id, employee_id, at timestamptz, source[pwa|web|device|manual|import], lat, lng, ip, device_id, accepted boolean, reject_reason)`
- `attendance_days(id, employee_id, date, shift_id, first_in, last_out, worked_minutes, late_minutes, early_minutes, ot_minutes, status[present|absent|half_day|on_leave|holiday|weekend|incomplete], is_locked, source_summary)` — computed
- `regularization_requests(id, employee_id, date, requested_in, requested_out, reason, status, decided_by)`
- `attendance_periods(id, year, month, status[open|locked], locked_by, locked_at)`

### Rules
- Punches are raw; a **processing job** (on punch + nightly) recomputes `attendance_days` from punches + shift + leave + holidays. Locked periods are never recomputed.
- PWA clock-in validates geofence (branch lat/lng/radius) and/or IP allowlist per branch setting; rejected punches are stored with reason (useful for disputes).
- OT minutes computed per shift rules; OT **approval** optional per tenant setting.

### Work
- [x] Shifts & assignments admin; roster grid (week view) for rotating shifts
- [x] PWA clock in/out button with location permission handling and clear rejection messages
- [x] Device import: CSV/XLSX from fingerprint devices (mapping of device user id → employee) using import framework; (v1.1: ZKTeco push/pull adapter)
- [x] Daily attendance board (exceptions first: absent, late, incomplete)
- [x] Regularisation request + approval (reuses `approval_flows`)
- [x] Monthly summary per employee and **period lock** (payroll reads only locked periods unless overridden by payroll admin)

**Done when:** tests for late/early/half-day/OT/night shift crossing midnight; reprocessing is idempotent; locked month cannot change.

---

## Phase 7 — Payroll (Sri Lanka, fully configurable)

**This is the product. Highest test bar in the codebase.**

### Configuration tables (all effective-dated, seeded with defaults marked `verify`)
- `pay_components(id, code, name, kind[earning|deduction|employer_contribution|info], calc[fixed|variable|formula|system], formula text null, is_epf_applicable, is_etf_applicable, is_apit_applicable, is_prorated, show_on_payslip, gl_code, sort_order, is_active)`
  - System components: `BASIC`, `BUDGETARY_RELIEF` (if client uses it), `OT`, `NOPAY`, `EPF_EE`, `EPF_ER`, `ETF`, `APIT`, `LOAN_RECOVERY`, `SALARY_ADVANCE`
- `statutory_settings(id, effective_from, epf_employee_rate, epf_employer_rate, etf_rate, nopay_divisor_mode[working_days|fixed], nopay_fixed_divisor, ot_rate_base[basic|basic_plus_epf_components], ot_divisor (e.g. 240), ot_multiplier_normal, ot_multiplier_holiday, rounding_mode, rounding_scale)`
- `tax_tables(id, code e.g. 'APIT_T1', name, effective_from, effective_to, method[slab_monthly|slab_annual_cumulative])`
- `tax_table_slabs(table_id, from_amount, to_amount null, rate, deduct_amount)` — supports the IRD "rate less fixed amount" form
- `employee_tax_profiles(employee_id, table_code, is_resident, has_secondary_employment, effective_from)`
- `employee_salary(id, employee_id, effective_from, effective_to, basic, currency)` + `employee_pay_components(id, employee_id, component_id, amount, effective_from, effective_to)` — recurring fixed allowances/deductions
- `loans(id, employee_id, type[loan|advance], principal, interest_rate, installment_amount, start_period, status)` + `loan_installments(loan_id, period, amount, status)`
- `bank_file_templates(id, name, bank, format[csv|fixed_width], spec jsonb)` — SLIPS/CEFTS/bank-specific layouts are **data**

### Run tables
- `payroll_periods(id, year, month, start_date, end_date, pay_date, status[open|calculating|calculated|approved|locked|paid])`
- `payroll_runs(id, period_id, type[regular|off_cycle|adjustment], status, calculated_at, approved_by, locked_by, notes)`
- `payroll_inputs(id, run_id, employee_id, component_id, amount, quantity, note, source[manual|import|attendance|loan])` — one-offs: bonus, arrears, commissions, ad-hoc deductions
- `payslips(id, run_id, employee_id, gross, total_deductions, net, employer_cost, epf_base, etf_base, apit_base, snapshot jsonb, trace jsonb, pdf_path, emailed_at)`
- `payslip_lines(payslip_id, component_id, kind, amount, quantity, rate)`

### Engine (`packages/payroll`)
```ts
calculatePayslip({
  employee,            // join/exit dates, tax profile
  salary, recurringComponents, oneOffInputs,
  attendance,          // locked month: paid days, no-pay days, OT minutes (normal/holiday)
  leave,               // paid/no-pay leave days in period
  loans,               // due installments
  config: { statutory, taxTable, components, rounding, workCalendar }
}): { lines, totals, bases: { epf, etf, apit }, trace: Step[] }
```
- Order: basic (prorate on join/exit) → recurring earnings → one-off earnings → OT → no-pay → **bases** (sum of components flagged epf/etf/apit) → EPF/ETF → APIT from tax table → loans/advances → other deductions → net → rounding.
- Every step pushes to `trace` (what, inputs, formula, output) — displayed in the UI "Why is this number?" panel.
- Formula components use a **safe expression evaluator** (e.g. `expr-eval` with a whitelist of variables like `BASIC`, `WORKING_DAYS`) — never `eval`.

### Golden tests (must exist before UI work)
- [~] `__fixtures__/*.json` — input + expected output per case, created **with the client's accountant**: _19 SAMPLE fixtures exist and pass (all listed cases); they must be re-checked with the accountant_ — basic only; with allowances (EPF-applicable and not); mid-month joiner; leaver; no-pay; OT normal + holiday; bonus; loan; each APIT slab boundary (149,999 / 150,000 / 150,001 …); negative net guard
- [x] Test that fails if any rate literal appears in engine source

### Workflow & UI
- [x] Payroll settings: components, statutory settings, tax tables (with "add new table effective from" — never edit history), bank templates
- [x] Employee pay setup tab (salary history, recurring components, tax profile, bank details)
- [x] Run wizard: open period → check readiness (missing salary, unlocked attendance, missing bank details, exits) → import/enter one-offs → calculate (background job, progress) → review grid with variance vs last month (highlight >X% change) → approve → lock → mark paid
- [x] Re-calc allowed until approved; after lock, corrections only through an **adjustment run** in a later period
- [~] Payslip PDF (PDFKit, tenant branding), bulk generate, optional password-protect with NIC/DOB (setting), email via job, available in self-service
- [x] Reports & exports (all SAMPLE layouts until confirmed):
  - [x] Payroll register (by dept/cost centre), component summary, variance report
  - [~] **EPF monthly contribution schedule** (C-Form data) — export format confirmed with client before building
  - [~] **ETF monthly contribution schedule** (R4 data) and half-yearly return data
  - [~] **APIT monthly schedule** and **annual T-10 certificate** per employee
  - [x] Bank transfer file from template
  - [x] GL/journal CSV by `gl_code` + cost centre for accounting import
- [x] Payroll permissions: preparer (`payroll.run`) ≠ approver (`payroll.approve`) enforced (no self-approval) — setting can relax for tiny clients

**Done when:** all golden fixtures pass, a 500-employee run calculates in < 60 s, re-running a calculated run is deterministic, locked runs are immutable (DB trigger), and an accountant signs off one real month's parallel run against their current payroll output.

**Known traps from the old UQMS code (do not repeat):**
- APIT table was the outdated 1.2M-relief version, hard-coded
- EPF computed on gross including OT and every allowance
- Basic became 0 when no attendance logs existed (prorated on attendance even for staff who don't clock in) → make "attendance-based proration" a per-employee/per-policy flag; default = salaried, deduct only explicit no-pay
- No transactional writes; no duplicate-run guard at DB level → unique `(run_id, employee_id)`

---

## Phase 8 — Self-service PWA & notifications

- [x] Mobile-first `/me` area: home (today's shift, clock button, leave balances, latest payslip), profile + change requests, leave apply/history, attendance history + regularise, payslips (PDF download), documents (view own)
- [x] Manager area: approvals inbox (leave, regularisation, OT), team today, team calendar
- [x] PWA: installable, offline shell + cached last payslip list/balances, background sync for clock-in when offline is **not** allowed (punch must be online for geofence integrity) — show clear offline message
- [x] Notifications service: `notifications` table + channels (in-app, email, web push via VAPID per tenant); user preferences
- [x] Events: leave submitted/decided, regularisation decided, payslip published, document expiring, probation ending, contract ending, birthday/anniversary (optional)
- [x] Email templates with tenant branding

**Done when:** Lighthouse PWA installable, e2e on mobile viewport for apply-leave → manager approves via push link → balance updates.

---

## Phase 9 — Dashboards & reports

- [ ] HR dashboard: headcount by status/dept/branch, joiners/leavers this month, turnover % (rolling 12 months), today's attendance, pending approvals, expiring documents, upcoming probation ends
- [ ] Payroll dashboard: cost trend (12 months), cost by dept, EPF/ETF/APIT totals for the month
- [ ] Report builder-lite: predefined reports with filters + CSV/XLSX export (employee master, leave balances, leave liability, attendance summary, payroll register)
- [ ] All dashboard queries respect scope (manager sees team)

---

## Phase 10 — Hardening & launch

- [ ] Security: dependency audit, rate limiting (per tenant + per IP), file upload scanning/type sniffing, signed-URL TTLs, CSP headers, IDOR test suite across all resources, secrets rotation procedure
- [ ] PDPA readiness (Sri Lanka Personal Data Protection Act): privacy notice per tenant, data-subject export (employee data package), retention settings + purge job for exited employees after N years, access to sensitive fields (NIC, bank, salary) logged in audit
- [ ] Backups: confirm PITR/daily backups per Supabase project; documented restore drill on a staging tenant
- [ ] Observability: Sentry (api + web) tagged with tenant slug, pino logs shipped, pool metrics, job failure alerts
- [ ] Performance: seed 1,000 employees × 12 months; p95 API < 300 ms for lists
- [ ] `seed:demo` creates a realistic demo tenant (for sales)
- [ ] Docs: admin guide (setup checklist), payroll guide, release notes
- [ ] Billing v1: manual — plan + employee count on control plane, monthly invoice export

**Launch checklist:** first pilot client runs **two months of payroll in parallel** with their existing system before going live.

---

## 4. Default seeds (all editable, all flagged `verify`)

| Seed | Default | Note |
|---|---|---|
| EPF employee / employer | 8% / 12% | statutory_settings, effective-dated |
| ETF | 3% | |
| APIT Table 01 (from 2025-04-01) | Nil ≤ 150,000/month; then 6% less 9,000; 18% less 37,000; 24% less 53,500; 30% less 72,500; 36% less 94,000 (bands at 233,333 / 275,000 / 316,667 / 358,333) | Taken from a published payroll-compliance summary — **must be checked against the IRD's official APIT tables before go-live** |
| OT | basic ÷ 240 × 1.5 (normal), × 2 (holiday) | Many firms differ — client config |
| No-pay divisor | working days in month | alt: fixed 30 |
| Work week | Mon–Fri full, Sat off | client config |
| Leave types | Annual, Casual, Sick, Maternity, No-pay, Short, Lieu | entitlements per client policy |

---

## 5. How to run this with Claude Code

1. Create the repo, put `CLAUDE.md` at root and this file at `docs/PLAN.md`. Optionally copy the old module to `reference/uqms-hr/` (only if you own that code).
2. One phase = one branch = one Claude Code session series. Start each with:
   > Read CLAUDE.md and docs/PLAN.md. We are doing Phase N. Enter plan mode, propose the slices (migration → shared schemas → API+tests → UI → e2e), list open questions, and wait.
3. For Phase 7, first session is **only** `packages/payroll` + fixtures:
   > Build packages/payroll engine and the golden fixture harness. No DB, no UI. Stop when all fixtures in __fixtures__ pass and the no-hard-coded-rates test exists.
4. After each slice: `pnpm typecheck && pnpm lint && pnpm test`, tick the checklist, commit.
5. Use `/clear` between slices to keep context small; CLAUDE.md + PLAN.md carry the state.
6. Review every migration by hand before merging; run `pnpm tenants:migrate --dry-run` against staging.

---

## 6. Open questions to settle before Phase 7
- [ ] Exact EPF C-Form / ETF R4 / T-10 output formats your pilot client's accountant submits (paper, Excel, e-return file?)
- [ ] Which banks the pilot uses for salary transfers and their file layouts
- [ ] Pilot client's OT, no-pay and allowance rules (get their current payroll sheet)
- [x] Payslip password protection: yes/no — built as a setting (none / NIC / DOB); client chooses
- [ ] Pricing model (per employee per month?) — affects `plans` and billing

## 7. Decisions log
_(Claude Code appends dated decisions here.)_

### 2026-10-17 — Phase 0
- **Repo root** is `hr-portal-plan/` (local, OneDrive-synced by choice). The old UQMS code moved to `reference/uqms-hr/{bk,front}`; it is excluded from lint, format and the workspace.
- **Tooling:** pnpm 10 through Corepack (pinned in `packageManager`). Shared versions live in the pnpm `catalog:`. The Supabase CLI is a root devDependency (`pnpm supabase ...`).
- **TypeScript pinned to ~6.0** because typescript-eslint 8.x requires TS < 6.1 (TS 7 is out).
- **Versions at start:** Next 16, React 19, Tailwind v4 (CSS-first config, no `tailwind.config`), Zod 4, ESLint 10 (flat config), Vitest 5, Express 5.
- **Internal packages ship TS source** (no build step). Next uses `transpilePackages`; the API's `tsup` bundles `@hr/*`. *Phase 1 deploy note:* the bundled API must also resolve its workspace packages' runtime deps (e.g. `date-fns-tz`), so add them to `apps/api` or use `pnpm deploy`.
- **Hard Rule 3 is enforced by lint:** ESLint `no-restricted-syntax` bans local-time `Date` getters/setters (`getDay`, `setHours`, ...) everywhere except `packages/shared/src/time`.
- **Business dates** are `YYYY-MM-DD` strings. Weekday comes from the date string (UTC math), never from server-local time.
- **Money:** `toDbString()` throws on more than 2 decimals, so callers must round with the tenant's rounding mode first. `round()` has no default mode.
- **Validation:** Express 5 makes `req.query` read-only, so parsed input lives on `req.valid`; use `parsed(req, schemas)` for typed access.
- **PWA:** `@serwist/turbopack` (Next 16 builds with Turbopack), with the SW served from the route `/serwist/sw.js` and disabled in dev.
- **E2E** runs against a production web build. Cold dev-mode compiles were too slow for stable timeouts.
- **Local Supabase** has public signup disabled (invite-only, per §1 Auth).

### 2026-10-18 — Phase 1
- **Topology (user decision):** the remote Supabase project `nfxwtzmpgwvysydckmyf` (Tokyo) is the control plane **and** the dev/staging tenant, like local `supabase start`. Tokyo is for dev only; client projects go to ap-southeast-1. Control-plane tables live in Postgres schema `platform`, tenant tables in `public`, so one DB can hold both.
- **Provisioning (user decision):** `tenant:create --existing-project <ref>` registers a project made in the dashboard. Credentials come from env (`TENANT_*`), never CLI args. Management API auto-create and auth-config are deferred until a token exists; they are logged as `skipped`, and the script prints a manual checklist.
- **Own migrator** instead of drizzle's: it reads drizzle-kit's journal, stores a SHA-256 per file in `hr_migrations.{control,tenant}`, refuses to run if an applied file changed or vanished, and runs each file in a transaction holding `pg_advisory_xact_lock` (safe through transaction poolers; a race test proved this was needed).
- **`tenant_secrets.db_direct_url_enc`** was added next to `db_url_enc`. The runtime uses the transaction pooler (:6543); migrations use the session pooler/direct (:5432).
- **Tenant resolution through the web origin:** Next rewrites `/api/*` → Express, and Express (`trust proxy`) reads X-Forwarded-Host. So the tenant = the host the browser is on, there's no cross-origin call, and CORS is only a fallback. Verified: an unknown host via the proxy returns `TENANT_NOT_FOUND`.
- **Status semantics:** `provisioning`/`archived` → 404 (unknown workspace); `suspended` → 403. Host lookups are cached 60 s, negative lookups 10 s; the platform status change invalidates the cache and closes the pool.
- **Platform admin auth:** an ES256/RS256 JWT from the control-plane Supabase project (JWKS via `jose`), plus the email listed in `platform.platform_admins`. The same verifier is reused for tenant auth in Phase 2.
- **Env:** a single repo-root `.env` serves `apps/api` and `scripts/` (loaded with `process.loadEnvFile`). `pnpm dev:setup` fills it from local Supabase and provisions the `dev` tenant (domains `localhost`, `dev.localhost`). Node ≥ 22 is now required (`process.loadEnvFile`, `.nvmrc` 22).
- **Postgres URL hygiene:** Prisma's `?pgbouncer=true` is stripped automatically. Passwords with `@`/`!` must be URL-encoded (`%40`/`%21`).
- **Tests:** integration tests create throwaway `hr_test_*` databases on local Postgres (`TEST_DATABASE_URL`, default local Supabase; CI uses a `postgres:17` service).

### 2026-10-18 — Phase 2
- **A minimal `employees` table arrived early** (no, names, reports_to, status), so that `team` scope and the IDOR tests run on real data. Phase 4 extends it with a new migration. `GET /employees[/:id]` exists as a scoped read; out-of-scope rows return 404 exactly like missing ones (no ID oracle).
- **Permission catalogue + system roles live in `@hr/shared/permissions`** (one source for API, seeds and UI). Each permission declares which scopes make sense (e.g. `attendance.clock` is self-only, `payroll.*` all-only), and Zod rejects anything else. The RBAC seed upserts system roles idempotently and **`tenants:migrate` now re-runs seeds** (`--skip-seeds` to opt out), so role changes reach every client.
- **Default role design (verify with pilot client):** owner = everything; hr_admin = HR, leave, attendance, users, settings, audit, but **no payroll**; payroll_admin = payroll **without `payroll.approve`** (maker-checker by default); manager = team scope for employees/leave/attendance plus own self-service; employee = self only.
- **Escalation guards:** you can only grant (or edit a user/role holding) permissions and scopes you hold yourself, so only owners mint owners. Nobody can disable themselves or change their own roles. The last active owner can't be disabled or demoted (409).
- **Auth checks:** JWKS signature + `aud=authenticated` + **issuer = the tenant's own project** (`<supabaseUrl>/auth/v1`), so another tenant's token fails even if keys were shared, plus an `app_users` row (403 otherwise). The first request activates invited users. MFA: setting `security.mfa_required` → non-`aal2` sessions get `MFA_REQUIRED`; the web app sends them to TOTP enrol/verify.
- **audit_log is append-only via triggers** (UPDATE/DELETE/TRUNCATE raise for every role, including the owner), with REVOKE for Supabase browser roles. `withAudit` writes the change and its audit row in one transaction and redacts `password|secret|token` keys. Audit pagination is keyset on `(at, id)` with the cursor = last row id, compared in SQL (JS ms timestamps would skip µs-precision rows).
- **Gotcha:** drizzle's postgres-js driver mutates the client's serializers, so never share one `postgres()` client between drizzle and raw `sql.json(...)`.
- **Web auth:** supabase-js per tenant project (URL/anon key from `/public/tenant`), `flowType: 'implicit'` so invite/recovery/magic links work across devices, and the session token is attached to API calls. `safeNext()` blocks open redirects. Local `supabase/config.toml`: redirect URLs for `localhost`/`*.localhost`, TOTP enabled, and email/sign-in rate limits raised **for local dev only** (production limits are set per project).
- **Dev data:** `pnpm dev:users` (local only) creates owner/hr/payroll/manager/employee users with password `Password123!`. Playwright's globalSetup runs it, and e2e reads invite emails from local Mailpit.

### 2026-10-18 — Phase 3
- **Holidays are not seeded with guessed dates.** Sri Lankan Poya, bank and mercantile holidays change yearly and are gazetted; per CLAUDE.md we don't guess. HR imports a CSV (dry-run preview with per-line errors; commit is atomic and refused while errors remain) or copies last year (same month/day, all marked **unverified**, 29 Feb skipped in non-leap years). The UI flags unverified holidays until someone ticks them against the gazette. **Open:** get the official 2026/2027 list and ship it as a `verify` seed.
- **Holiday `type`** is free text with suggested values; no logic branches on it.
- **Working days:** `@hr/shared/time` `countWorkingDays(start, end, workWeek, holidays)`: full = 1, half = 0.5, any holiday = 0 (even on a half day). Unit-tested for half Saturdays in Oct 2026 (22 → 24.5) and holidays. `GET /work-calendars/:id/working-days` exposes it.
- **Org reference data** (branches, departments, grades, designations, cost centres) shares one audited CRUD factory: reads are open to any signed-in user (for dropdowns), writes need `org.manage`, and rows are **archived, never deleted** (employees reference them). Departments reject cycles with a recursive check.
- **Postgres constraint errors map to envelopes:** 23505 → 409 CONFLICT, 23503 → 400 (missing or in-use reference), 23514/23502 → 400. Drizzle wraps driver errors, so the handler walks `cause`.
- **Company profile** is a singleton row (unique `singleton` column) seeded from the tenant name. Settings are a **typed registry** in `@hr/shared/settings` (Zod schema + default per key; unknown keys → 400).
- **Logo** goes to the tenant's private `branding` bucket (raw upload ≤ 1 MB, PNG/JPEG/WebP/SVG), created lazily if missing. It's served via a 1-hour signed URL from `/public/tenant`, along with the company name and brand colour. The brand colour overrides the `--primary`/`--ring` tokens.
- **Numbering:** `nextSequenceValue(tx, key)` uses `UPDATE … RETURNING` inside the caller's transaction (row lock), so concurrent hires never share a number and a rolled-back hire doesn't consume one (tested with 20 parallel transactions).
- **Seeds take context** `{ tenantName, timezone }`; org defaults are a Mon–Fri calendar, `EMP-0001` numbering, and the company profile.
- **Reliability:** web requests time out after 20 s (a retryable error instead of an endless spinner); the auth gate shows a retryable "workspace unavailable" error; e2e warms the proxy first. API integration test files run sequentially (`fileParallelism: false`) to stay under local Postgres `max_connections` (100; Supabase services use ~30).

### 2026-10-18 — Phase 4
- **Job history is effective-dated and gap-free.** `applyJobChange` inserts (or, for the same start date, corrects) a record and re-links the neighbouring ranges, then projects the record in force *today* onto `employees`. Backdated and future-dated changes are allowed. `refreshJobProjections(today)` applies future changes on their start date (scheduled daily from Phase 8). Exit closes the last record at the exit date and refuses if later changes exist. Tested: "department on date X" across transfers, backdated inserts, corrections and future changes.
- **The migration backfilled safely:** `join_date` was added with a temporary default (dropped in the same migration), and every existing employee got an opening `hire` record.
- **Field-level privacy by scope:** `employees.read` at `all` scope (HR) or the employee themselves → `access: 'full'`. Team scope (managers) → `access: 'work'`: personal, bank/statutory, contacts and exit reason are withheld. Out-of-scope IDs return 404 like missing ones.
- **NIC:** old (9 digits + V/X) and new (12 digits) formats. Day-of-year counts February as 29 days in every year, +500 for women. DOB/gender are offered as a *suggestion* (button), never auto-filled. NICs and EPF numbers are unique per tenant (partial unique indexes). **Test vectors are constructed from the documented scheme, not real cards — spot-check against a few real NICs with the pilot client.**
- **Import framework** (`modules/imports`): the browser parses CSV/XLSX (`read-excel-file`), the user maps columns (auto-matched on labels/aliases), the API previews every row (required, Zod, lookups by code, duplicates against DB *and* within the file), and the commit re-validates and writes the valid rows in **one transaction** (`skipInvalid` opt-in; otherwise any error blocks). Rows may reference managers defined later in the same file. Verified with 500 rows / 6 deliberate errors → exact error lines, 494 imported atomically, nothing written when blocked.
- **Documents/photos** go to private buckets (`employee-documents`, `employee-photos`): PDF/images/DOCX ≤ 10 MB, 60 s signed URLs, every download audited.
- **Export:** CSV with a UTF-8 BOM (Excel shows Sinhala/Tamil names correctly). NIC/mobile/EPF columns are included only for all-scope readers. Exports are audited.
- **Picker lists** use `pageSize ≤ 1000` (enough for the target 50–1,000 employees). A searchable picker can replace it if a client outgrows that.
- **Lint:** imports group `@hr/*` before app-local `@/…`.
- **Known environment caveat:** the repo is on OneDrive. One full-suite run failed transiently right after a repo-wide reformat and passed on three reruns. Moving the repo off OneDrive would remove that risk.

### 2026-10-18 — Phase 5
- **No guessed entitlements.** Seeds create ANNUAL, CASUAL, SICK, MATERNITY (female-only), NOPAY (no balance needed), SHORT (hours) and LIEU (granted by adjustment), each with a catch-all policy at **0 and `needs_review`**. Staff can't take paid leave until HR enters the client's entitlements (statutory minimums + contract), and the admin screen nags until every policy is reviewed. **Open:** confirm the pilot client's entitlements, eligibility rules and carry-forward caps.
- **Ledger:** `leave_ledger` is append-only by trigger. Balance = `SUM(amount)` per employee/type/year (`leave_balances_v`). Amounts are in the type's unit (days, or hours for short leave). Approve → `taken` (−); cancel-after-approve → `reversal` (+). Corrections are `adjustment` rows.
- **Accrual is lazy and idempotent** rather than cron-driven. Balances and requests materialise any due `accrual` (and carried-leave `expiry`) entries using unique `idempotency_key`s, so no job has to have run. Upfront policies credit the (prorated) year once eligible. Monthly policies credit 1/12 per month from cumulative rounding, so totals never drift.
- **Proration/rounding are policy data:** none / monthly (join month counts as full) / daily, plus `rounding` (none, nearest ½, down to ½, down to whole, nearest whole) and `eligible_after_months`.
- **Leave year = calendar year.** Requests can't span two years (must be split). Past years show as of 31 Dec, the current year as of today, future years as of 1 Jan.
- **Day counting** comes from the employee's branch calendar (else the default), holidays and half days. A multi-day request may start in the afternoon and/or end at midday. First-half and second-half leave can share a date; any other overlap is refused.
- **Concurrency:** apply locks the employee row (`SELECT … FOR UPDATE`) before the balance and overlap checks. A test fires two simultaneous 2-day requests against a 3-day balance: exactly one wins.
- **Approvals** (`approval_flows.leave`, default `['manager']`): the manager step goes to `reports_to`, or straight to HR if there is none. HR (`leave.approve` all) can act on any step. Nobody approves their own leave. A required supporting document blocks the *final* approval, not the application. Bulk decide runs each request in its own transaction and reports failures individually.
- **Year-end:** preview, then a single keyed run (`leave_year_runs`; a second run → 409). It carries `min(closing, cap)` into next year. Carried leave is used first (FIFO), and whatever is unused at `carry_forward_expiry_months` expires lazily via an `expiry` ledger row.
- **E2E stability:** Playwright runs with 2 workers. The full stack shares one machine, and 4 workers caused a timeout plus a Playwright-internal JSON error. Checked that the Next proxy passes large bodies intact (a 616 KB response matched byte-for-byte).

### 2026-10-18 — Phase 6
- **Processing is synchronous and idempotent** (`modules/attendance/process.ts`). One bulk-loading `processRange` upserts `attendance_days` keyed on employee + date, never touches a locked month, and caps at today. It runs on every trigger: a punch, an approved correction, a device import, a roster/assignment change, a leave approval/cancellation (the leave service calls it inside its transaction), and before the board, the month view, the summary and a lock (absences have no event, so reads process first). A test runs it twice and compares rows. **The nightly run is deferred to Phase 8** (pg-boss), like the job-projection refresh.
- **What a day expects:** holiday beats everything (expected 0; any work is OT). Then a roster entry (a shift = full workday even on a calendar off-day; `null` = rest day), then the work calendar (full 1 / half 0.5 / off 0). The shift comes from the roster, else the effective-dated assignment. The calendar uses the employee's *current* branch, not their branch on that date (same simplification as leave).
- **Day rules are shift data** (grace, early grace, unpaid break + "deduct after", half-day threshold, OT-after, punch windows). Late counts from shift start once past grace; OT counts from the (expected) end once the stay reaches OT-after; a half working day expects the first half of the shift. A single punch = `incomplete` (needs a correction), not absent. Employees with no shift use the calendar day, and any work counts as a full day with no late/OT. Shift validation stops consecutive days' punch windows from overlapping (shift length + windows ≤ 24 h).
- **One example shift `GENERAL` is seeded, flagged `needs_review`**, and nobody is assigned automatically. Saving a shift clears the flag (same as leave policies).
- **Clock-in:** geofence (branch lat/lng/radius) and/or IP allowlist (branch `allowed_ips`). New setting `attendance.branch_check` = either/both when a branch has both. GPS accuracy is recorded but **not** credited (a generous accuracy makes spoofing trivial). Rejected punches are stored with the exact reason ("about 1112 m from Colombo HQ; allowed within 100 m", "location permission denied"). A 60 s double-tap guard is a UX safeguard, not a business rule. The work date for a night worker clocking out after midnight is yesterday's shift.
- **Punches are append-only by trigger.** An approved correction adds `manual` punches (with `ref = regularization:<id>`); HR manual punches need a note. Device rows dedupe on employee + instant + source, so re-importing a file adds nothing.
- **Device import:** `attendance-punches` and `attendance-device-users` import kinds. Dates are `YYYY-MM-DD`/`YYYY/MM/DD`, or **day-first** `DD/MM/YYYY` (the Sri Lankan convention; month-first is not accepted); times are `HH:mm[:ss]` with optional AM/PM, in office time. The import wizard now keeps the time of Excel date-time cells (it used to drop it). A ZKTeco push/pull adapter stays v1.1.
- **OT approval** is optional (`attendance.ot_requires_approval`). Managers set approved minutes per day on the board (capped at the worked OT, never their own). Reprocessing caps an earlier approval at the new OT. The summary exposes `payableOtMinutes` for payroll.
- **Period lock:** only after the month ends. It reprocesses first and refuses (409 with counts) while there are incomplete days or pending corrections, unless `force`. A trigger freezes locked `attendance_days` (only `is_locked → false` is allowed). All writes into a locked month (punches, imports, corrections, roster) return 409. Unlock needs a reason and is audited. **Phase 7 must block unlocking a month an approved payroll run has used.**
- **Approval helpers** (`approvalSteps`, `nextStep`) moved to `apps/api/src/lib/approvals.ts` and are shared by leave and attendance (`approval_flows.attendance`, seeded `['manager']`).
- **Open (Phase 7, don't guess):** whether late minutes, early leave or short leave (hour-unit leave doesn't change the day's expectation) reduce pay. OT *rates* (normal / rest-day / holiday) belong in payroll config. Attendance only reports minutes.

### 2026-10-18 — Phase 7
- **Built on SAMPLE data (user decision).** The pilot client's figures aren't available yet, so every statutory number, the APIT table, the bank layouts and the report formats are seeded as editable configuration flagged `needs_review`. The UI shows a "Sample payroll data" banner, run readiness warns `SAMPLE_CONFIG`, and each run records `configNeedsReview`. **Before paying real salaries:** confirm EPF/ETF rates, the IRD APIT tables, OT/no-pay rules, the C-Form/R4/T-10 and bank formats, and have the accountant sign off one parallel month (the plan's "done when" item, still open).
- **Engine (`@hr/payroll`)** is decimal-only and pure, with a full trace. Its order is as planned. Rates are percentages in config. A source scan fails the build on any rate literal (structural constants like 60 min/12 months/100% are allowed; anything else must say `// structural-constant: <reason>`). Negative net: statutory deductions are always taken (`NEGATIVE_NET` blocks approval); loans and other deductions are capped at what's left (`DEDUCTION_SHORTFALL`). Monthly and cumulative (annualised YTD) tax tables both work.
- **No `expr-eval`.** It's unmaintained and had a prototype-pollution CVE. A ~120-line whitelisted decimal evaluator handles formulas (+ − × ÷, min/max, known variables only). A test proved `constructor`/`__proto__` lookups are blocked; that was a real bug caught during development.
- **Salaried by default (UQMS trap):** no-pay comes only from approved unpaid-leave days. `employee_salary.nopay_from_absence` opts an employee into absence-based no-pay from the locked attendance month, and `ot_eligible` controls whether attendance OT is paid. OT minutes use approved minutes when `attendance.ot_requires_approval` is on. Rest-day OT pays at the holiday multiplier when `rest_day_ot_as_holiday` is set. A mid-month salary change uses the salary in force at period end (pay the difference as `ARREARS`).
- **History is immutable:** statutory settings and tax tables are effective-dated. A row that a locked/paid run's config snapshot used can't be edited (409); add a new version instead (a new tax table version closes the previous one the day before). Salary changes can't start inside a locked month. DB triggers make locked/paid runs, their payslips, lines and inputs immutable (only `locked → paid` and recording a payslip's PDF/email time are allowed). One regular run per period (partial unique index).
- **Workflow:** open month (creates the regular run) → readiness (blocks: no statutory settings, attendance not locked when `payroll.require_locked_attendance`; warns: sample config, no salary, no bank account, no tax profile; info: joiners/leavers) → one-off inputs → calculate (deterministic; recalculation replaces results) → approve (maker-checker: the calculator can't approve unless `payroll.allow_self_approval`; the default payroll_admin role has no approve permission) → lock (loan instalments recovered, fully paid loans close) → paid. Off-cycle and adjustment runs pay only employees with inputs; loans are recovered only in regular runs.
- **Performance:** inputs are bulk-loaded (one query per kind). 500 employees calculate in about 1.6 s in tests (target < 60 s), so the run happens inline rather than as a background job.
- **Correlated-subquery gotcha:** inside raw `sql` subqueries, drizzle renders `${table.id}` as a bare `"id"`, which then binds to the *inner* table. Write `"loans"."id"` explicitly. This broke loan recovery, YTD APIT and T-10 totals until a test caught it.
- **Payslips:** employees see a payslip only after the run is locked. The trace ("Why is this number?") is for payroll staff only. The PDF uses PDFKit (**new dependency**, the stack's PDF library) with company name and brand colour (logo not yet). Optional password = NIC or DOB (YYYYMMDD) via `payroll.payslip_password`; generating fails clearly if that field is missing. **Emailing payslips is deferred to Phase 8** (needs the job queue and EmailSender).
- **Exports** (CSV with BOM; audited): register, EPF (C-Form data), ETF (R4 data), APIT schedule, T-10 annual totals, GL journal (balanced: earnings and employer contributions debit; deductions, contributions payable and net pay credit), and a bank file built from a template (CSV or fixed width). A fixed-width value that doesn't fit is an error, never truncated. Bank/branch codes live in `employee_bank_codes`.
- **Not built yet:** ETF half-yearly return, a per-employee T-10 certificate PDF, the payroll leave liability report (Phase 5 leftover), payslip email and the logo on payslips.

### 2026-10-18 — Phase 8
- **Jobs:** pg-boss (**new dependency**, the stack's queue) runs inside the API process on the control-plane DB (schema `pgboss`). The queue sits behind a `JobQueue` interface; tests use an `InlineQueue` (`drain()` waits for queued jobs). Queues: `notifications.deliver`, `daily.tenant` and `daily.sweep` (cron `JOBS_DAILY_CRON`, default 01:30 Asia/Colombo, fans out one `daily.tenant` per active tenant with a per-day singleton key). Every tenant job carries `tenantId` and resolves the tenant DB through the control plane. `JOBS_ENABLED=false` runs jobs in-process (single instance, dev only). pg-boss needs a session/direct URL (`JOBS_DATABASE_URL`), not the 6543 transaction pooler. Smoke-tested against local Postgres.
- **Daily tenant job** = the nightly work earlier phases deferred: `refreshJobProjections(today)` (future-dated job changes take effect), attendance processing for yesterday (absences get rows without anyone opening a screen), and HR reminders for expiring documents (`documents.expiry_warning_days`), probation and contract ends (new setting `notifications.reminder_days`, default 14). Reminders are deduplicated per user by `dedupe_key`, so re-running the job sends nothing twice.
- **Notifications:** every notification is stored in-app (bell with unread count, 60 s polling). Email and web push are delivered by the job according to per-user, per-event preferences (default on; in-app can't be turned off). Delivery failures are logged per item, never thrown, so a retry doesn't re-send what already went out (`emailed_at`/`pushed_at`). Events are emitted *after* the business transaction commits, and a failure there never fails the request.
- **Events wired:** leave submitted (to the current approver: named manager, else HR with `leave.approve` all) and decided (to the employee; a multi-step approval notifies the next approver); attendance correction submitted/decided (same routing); payslip published when a run is locked (deduped per run); profile change submitted (HR) and decided (employee); the three HR reminders. Birthday/anniversary (optional in the plan) not built.
- **Email:** an `EmailSender` interface with SMTP (nodemailer, **new dependency**), Resend (plain HTTPS, no SDK) and `log` (the dev default: nothing is sent). The branded HTML+text template uses company name + brand colour. Links are absolute: `APP_BASE_URL` or `https://<tenant primary domain>`. Local Mailpit SMTP is enabled in `supabase/config.toml` (port 54325, after the next `supabase start`).
- **Web push:** web-push (**new dependency**). VAPID keys are **per tenant**, created on first use and stored in `platform.tenant_secrets` (private key AES-GCM encrypted with MASTER_KEY; control migration `0001_vapid_keys`). Subscriptions are per device; one that has expired (404/410) is deleted automatically. The service worker shows the push and focuses/opens the linked page when it's tapped. iPhone needs the app on the Home Screen.
- **Deploy order:** run `pnpm control:migrate` **before** `pnpm tenants:migrate` (the fan-out reads the new control columns).
- **Self-service:** a mobile-first `/me` home (pending approvals banner, clock card, leave balances, latest payslip, quick links), `/me/profile` (view + request changes), `/me/documents`, `/me/payslips`, `/me/notifications` (per-event email/push switches + per-device push on/off). **Profile changes** are requests: HR applies or rejects, nobody approves their own, one pending request per section, and an unchanged value is refused. Applying writes the employee update and its audit row in the same transaction via the new `appendAudit(tx, …)` helper (no ad-hoc audit inserts).
- **Unified approvals** (`/approvals`, nav badge): leave, attendance corrections, overtime (only when `attendance.ot_requires_approval`; reject = approve 0 minutes) and profile changes, as phone-friendly cards. The existing per-module approval pages remain.
- **Offline:** punches are never queued offline (geofence integrity). The clock card disables itself with a clear message. The last-known leave balances and payslip list are cached in localStorage, served only when the browser is offline, and cleared on sign-out.
- **Dependency hygiene:** pg-boss pulls in `pg`, which made pnpm create a second drizzle-orm instance for the API (type errors across packages). Adding `pg` to `@hr/db` and `@hr/control-db` gives every package the same drizzle instance.
- **Not verified here:** the Lighthouse "installable" audit (the manifest and SW are unchanged from Phase 0, and the push handlers were added). Real push delivery to a phone needs a deployed HTTPS origin; the API side is covered by tests with an in-memory push sender.

