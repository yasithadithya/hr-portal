# HR Portal — Admin guide (client setup checklist)

For the HR lead or owner setting up a new company. Work top to bottom; each step says where in the app it lives. Anything marked **verify** is a sample/default that must be confirmed for your company.

## 1. First sign-in
1. Accept the invitation email and set a password.
2. **Settings → Preferences**: turn on *Require two-factor authentication* if your policy needs it.
3. **Settings → Company**: legal name, registration, **EPF and ETF registration numbers**, TIN, address, logo. These print on payslips and statutory files.

## 2. Organisation
4. **Settings → Organisation**: branches (with geofence location/radius and office IP addresses if staff clock in from phones), departments, grades, designations, cost centres.
5. **Settings → Work week & holidays**: working days (full/half/off), then **import the official holiday list** for the year (Poya, bank and mercantile holidays are gazetted — the app never guesses them). Tick each holiday as verified against the gazette.
6. **Settings → Preferences → Numbering**: employee number format (e.g. `EMP-0001`).

## 3. People and access
7. **Employees → Import**: upload your staff list (CSV/Excel), map columns, fix the listed errors, import.
8. **Settings → Users**: invite people and give roles — *Owner*, *HR admin*, *Payroll admin* (prepares payroll; cannot approve it), *Manager* (sees their team), *Employee* (self-service). Link each user to their employee record.
9. **Settings → Privacy**: publish your **privacy notice** (text approved by your legal adviser). Everyone must acknowledge it at sign-in. Leave *retention* empty until you have confirmed legal retention periods.

## 4. Leave — verify
10. **Leave → Leave settings**: each leave type ships with a **0-day policy flagged "needs review"**. Enter your entitlements (statutory minimums + contract), accrual, proration, carry-forward and expiry. Saving a policy marks it reviewed.
11. **Employees → Import → Leave opening balances** if moving from another system mid-year.

## 5. Attendance — verify
12. **Attendance → Shifts**: review the example `GENERAL` shift (start/end, grace, break, half-day and OT thresholds) or create your own; then **Assign shift** to staff. Use **Roster** for rotating schedules.
13. Fingerprint machines: **Attendance → Device import → Device users** (map machine IDs to employees), then import the machine's export file regularly.
14. **Settings → Preferences → Attendance**: whether overtime needs manager approval; how branches with both geofence and IP rules are checked.
15. After each month ends: **Attendance → Monthly → Lock month**. Payroll uses locked months.

## 6. Payroll — verify everything
See [payroll-guide.md](payroll-guide.md). Payroll ships with **sample** statutory rates, APIT table and bank layouts.

## 7. Self-service
16. Tell staff to open the portal on their phone and **Add to Home Screen**, then **My HR → Notifications → Turn on for this device** to receive push notifications.
17. Managers approve leave, attendance corrections and overtime in **Approvals**.

## Getting help
- Every change to HR data is in **Settings → Audit log** (who, what, when, before/after).
- Reports: **Reports** (employee master, leave balances, leave liability, attendance summary, payroll register) export to CSV/Excel.
