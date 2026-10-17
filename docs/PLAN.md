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
- [ ] Invites first Owner user (Phase 2 fills in the `invite-owner` step)
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
- [ ] JWT verification middleware (tenant JWKS, cached), loads `app_users` + effective permissions into `req.ctx`
- [ ] `requirePermission('leave.approve')` + `scopeFilter(ctx, 'leave.read')` helper that returns a Drizzle `where` for self/team/all (team = recursive `reports_to` subtree)
- [ ] Repository helper `withAudit(ctx, entity, fn)` used by all writes
- [ ] Invite flow (HR invites → Supabase invite email → set password → first login links `app_users`)
- [ ] Web: login, magic link, forgot/reset password, accept invite, MFA enrol (if enabled), route guards from permissions, 403 page
- [ ] Users & roles admin screens; custom roles allowed (copy a system role then edit)

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
- [ ] CRUD API + screens for all of the above; departments as tree
- [ ] Holiday import: CSV upload + "copy from last year" + seed of the current year's SL holidays (marked "verify")
- [ ] Settings screen grouped: Company, Work week, Numbering, Security (MFA required?), Branding (logo, primary colour)

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
- [ ] NIC validation for old (9 digits + V/X) and new (12 digits) formats, optional DOB/gender derivation shown as a suggestion (not auto-overwrite)
- [ ] Employee list: search, filters (dept, branch, status, type), column chooser, server pagination
- [ ] Employee profile page with tabs: Overview, Job (history timeline), Personal, Contacts, Bank & statutory, Documents, (later: Leave, Attendance, Payroll)
- [ ] Actions: hire, transfer/promote (writes job history), confirm probation, set notice, exit (sets exit date + status; blocks future payroll after final run)
- [ ] Documents: upload to tenant storage (private), signed URLs (60 s), expiry tracking + daily job flags documents expiring in N days (setting)
- [ ] **CSV/XLSX bulk import** for employees: upload → column mapping → validation preview (row-level errors) → commit in a transaction → import report. Same framework reused later for salaries, leave opening balances, attendance
- [ ] Export (CSV/XLSX) of the filtered list
- [ ] Org chart view from `reports_to_id`
- [ ] Probation/contract-end reminders (job → notification in Phase 8)

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
- [ ] Leave types & policies admin; policy preview ("who does this apply to")
- [ ] Opening balance import (uses Phase 4 import framework)
- [ ] Apply leave (half-days, attachment), my requests, cancel/withdraw
- [ ] Approvals inbox for managers/HR; bulk approve
- [ ] Team calendar (month view; who's off), company calendar with holidays
- [ ] Balance report and leave liability report (days × daily rate later from payroll)
- [ ] Year-end processing screen with dry-run preview

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
- [ ] Shifts & assignments admin; roster grid (week view) for rotating shifts
- [ ] PWA clock in/out button with location permission handling and clear rejection messages
- [ ] Device import: CSV/XLSX from fingerprint devices (mapping of device user id → employee) using import framework; (v1.1: ZKTeco push/pull adapter)
- [ ] Daily attendance board (exceptions first: absent, late, incomplete)
- [ ] Regularisation request + approval (reuses `approval_flows`)
- [ ] Monthly summary per employee and **period lock** (payroll reads only locked periods unless overridden by payroll admin)

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
- [ ] `__fixtures__/*.json` — input + expected output per case, created **with the client's accountant**: basic only; with allowances (EPF-applicable and not); mid-month joiner; leaver; no-pay; OT normal + holiday; bonus; loan; each APIT slab boundary (149,999 / 150,000 / 150,001 …); negative net guard
- [ ] Test that fails if any rate literal appears in engine source

### Workflow & UI
- [ ] Payroll settings: components, statutory settings, tax tables (with "add new table effective from" — never edit history), bank templates
- [ ] Employee pay setup tab (salary history, recurring components, tax profile, bank details)
- [ ] Run wizard: open period → check readiness (missing salary, unlocked attendance, missing bank details, exits) → import/enter one-offs → calculate (background job, progress) → review grid with variance vs last month (highlight >X% change) → approve → lock → mark paid
- [ ] Re-calc allowed until approved; after lock, corrections only through an **adjustment run** in a later period
- [ ] Payslip PDF (PDFKit, tenant branding), bulk generate, optional password-protect with NIC/DOB (setting), email via job, available in self-service
- [ ] Reports & exports:
  - [ ] Payroll register (by dept/cost centre), component summary, variance report
  - [ ] **EPF monthly contribution schedule** (C-Form data) — export format confirmed with client before building
  - [ ] **ETF monthly contribution schedule** (R4 data) and half-yearly return data
  - [ ] **APIT monthly schedule** and **annual T-10 certificate** per employee
  - [ ] Bank transfer file from template
  - [ ] GL/journal CSV by `gl_code` + cost centre for accounting import
- [ ] Payroll permissions: preparer (`payroll.run`) ≠ approver (`payroll.approve`) enforced (no self-approval) — setting can relax for tiny clients

**Done when:** all golden fixtures pass, a 500-employee run calculates in < 60 s, re-running a calculated run is deterministic, locked runs are immutable (DB trigger), and an accountant signs off one real month's parallel run against their current payroll output.

**Known traps from the old UQMS code (do not repeat):**
- APIT table was the outdated 1.2M-relief version, hard-coded
- EPF computed on gross including OT and every allowance
- Basic became 0 when no attendance logs existed (prorated on attendance even for staff who don't clock in) → make "attendance-based proration" a per-employee/per-policy flag; default = salaried, deduct only explicit no-pay
- No transactional writes; no duplicate-run guard at DB level → unique `(run_id, employee_id)`

---

## Phase 8 — Self-service PWA & notifications

- [ ] Mobile-first `/me` area: home (today's shift, clock button, leave balances, latest payslip), profile + change requests, leave apply/history, attendance history + regularise, payslips (PDF download), documents (view own)
- [ ] Manager area: approvals inbox (leave, regularisation, OT), team today, team calendar
- [ ] PWA: installable, offline shell + cached last payslip list/balances, background sync for clock-in when offline is **not** allowed (punch must be online for geofence integrity) — show clear offline message
- [ ] Notifications service: `notifications` table + channels (in-app, email, web push via VAPID per tenant); user preferences
- [ ] Events: leave submitted/decided, regularisation decided, payslip published, document expiring, probation ending, contract ending, birthday/anniversary (optional)
- [ ] Email templates with tenant branding

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
- [ ] Payslip password protection: yes/no
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
