# HR Portal — Payroll guide

> **Read first.** Statutory rates, the APIT table, bank file layouts and the EPF/ETF/APIT/T-10 report layouts are **sample data** until your accountant confirms them (they show a "sample — review" badge and a yellow banner). Before paying real salaries, run **two months in parallel** with your current payroll and compare every payslip.

## 1. Settings (Payroll → Settings) — one-time, verify each
| Tab | What to check |
|---|---|
| **Statutory rates** | EPF employee/employer %, ETF %, OT base (basic or basic + EPF allowances), OT divisor and multipliers (normal / holiday; rest-day OT rate), no-pay divisor (working days in the month or a fixed number), rounding. Click *Edit / confirm* to mark reviewed. To change rates later use **New version from a date** — settings used by a locked payroll can never be edited. |
| **Tax tables** | APIT table slabs ("rate less fixed amount"). Check against the IRD's official tables. Add a **new version from a date** when IRD publishes new tables. |
| **Pay components** | Allowances and deductions: whether each counts for EPF, ETF and APIT, whether it is prorated for part months, GL code. Formula components can use `BASIC`, `WORKING_DAYS`, `NOPAY_DAYS`, `OT_NORMAL_HOURS` etc. |
| **Bank files** | The layout your bank accepts (CSV or fixed width). Ask the bank for its specification and edit the JSON layout. |
| **General** | Locked-attendance requirement, maker-checker (preparer cannot approve), payslip PDF password (NIC or date of birth), variance highlight %. |

## 2. Employee pay (Payroll → Employee pay)
For each employee: **salary** (from a date; tick *paid overtime* and/or *absence is no-pay* where your policy says so), **recurring allowances/deductions**, **tax profile** (APIT table or not liable), **bank and branch codes**, **loans/advances** (amount, monthly instalment, first month).

Salaried staff lose pay only for approved **no-pay leave**; absence-based no-pay applies only to staff with that option ticked.

## 3. Monthly run
1. **Lock attendance** for the month (Attendance → Monthly).
2. **Payroll → Open month** (pay date).
3. On the run page, read **Before you calculate** — errors block, warnings inform (no salary, no bank account, no tax profile, joiners/leavers).
4. Add **one-off items** (bonus, arrears, commission, ad-hoc deductions).
5. **Calculate**. Review the grid: rows changed by more than the variance % or with warnings are flagged. Click a row for the payslip and **"Why is this number?"** (every step of the calculation).
6. Fix and **Recalculate** as often as needed.
7. A **different person** with approval rights clicks **Approve** (you can *Send back*).
8. **Lock** — the month becomes permanent; loan instalments are recorded as recovered; employees see their payslips and get a notification.
9. Download files: **bank file** (choose the template), **EPF / ETF / APIT schedules**, **payroll register**, **GL journal**. Then **Mark paid**.

Mistakes after locking: open an **adjustment run** in a later month with the correcting items (e.g. arrears or a deduction).

## 4. Year end
- **Payroll → Reports → T-10 annual data** for the tax year (from locked payrolls).
- Leave year-end: **Leave → Leave settings → Year-end** (preview first).

## 5. What the system does not decide for you
Whether lateness, early leave or short leave reduce pay; how OT is paid on rest days and holidays; which allowances are EPF-liable; tax treatment of bonuses. These are your company's and your accountant's decisions — configure them, then verify with the parallel run.
