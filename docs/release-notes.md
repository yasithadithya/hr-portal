# Release notes

## v1.0.0 — first pilot release (2026-10)

**Core HR** — employee master with effective-dated job history, documents with expiry reminders, CSV/Excel import and export, org chart, NIC (old/new) parsing, field-level privacy (managers see work details only).

**Leave** — policy-driven types and entitlements (accrual, proration, carry-forward, expiry), ledger-based balances, half days and short leave, manager → HR approvals, team calendar, year-end processing, balance and **leave liability** reports.

**Attendance** — shifts, rosters, phone/web clock-in with geofence and office-IP checks, fingerprint-device imports, daily board, corrections with approval, optional overtime approval, monthly summary and month lock.

**Payroll (Sri Lanka)** — configurable engine (EPF/ETF/APIT, OT, no-pay, allowances incl. formulas, loans) with a full "why is this number?" trace; monthly runs with readiness checks, maker-checker approval and immutable locked payroll; payslip PDFs (optional password); bank file, EPF/ETF/APIT schedules, T-10 data and GL journal. **Statutory figures and file layouts ship as samples — confirm before use.**

**Self-service & notifications** — mobile-first My HR (clock-in, balances, payslips, profile change requests, documents), approvals inbox, in-app / email / web-push notifications with per-user preferences, installable app.

**Dashboards & reports** — scope-aware HR and payroll dashboards; five filterable reports with CSV/Excel export.

**Security & privacy** — per-client databases, deny-all row-level security, role + scope permissions, append-only audit log, rate limiting, upload type checks, CSP, PDPA tools (privacy notice acknowledgement, personal-data export, retention-based anonymisation, logging of sensitive-data views).

### Known limitations
- Holidays must be imported each year (not pre-loaded).
- ETF half-yearly return, per-employee T-10 certificate PDFs, logo on payslips, birthday/anniversary notices and a ZKTeco live connector are planned for v1.1.
- Rate limits are per server instance.
- Upload antivirus scanning is not included.
