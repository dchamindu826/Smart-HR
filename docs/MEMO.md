# SmartHR — owner's memo

Notes written down by the owner, kept as written, with where each one is built.

## 2026-10-11

### Admin (platform — Lumi AI)

| # | Note | Where it is |
|---|---|---|
| 1 | Client Company - Pricing Plan / Amount | `/admin/plans` (price, yearly price, employee limit, features); `/admin/tenants/[id]` (plan, monthly/yearly, custom price, discount, monthly amount); `/admin/invoices` |
| 2 | Multiple Admin logins | `/admin/admins` — roles Super admin, Admin, Support, Sales; two-factor login |
| 3 | Allocate terminals | `/admin/terminals` — stock, allocate to company + branch, device key, return, repair; device API `/api/v1/terminal/punches` |
| 4 | Demo Account | `/admin/demos` — demo company with sample data, expiry, extend, convert to real account |
| 5 | Customer analytics | `/admin` — MRR, ARR, companies by plan, trials, usage, punches per day, near plan limit |

### Head of HR

| # | Note | Where it is |
|---|---|---|
| 1 | Bulk import XL / Drive format | `/import` — Excel, CSV, or a Google Sheets link; employees and leave balances |
| 2 | Branches (Add remove Edit) | `/settings/branches` — branches with geofence, departments |
| 3 | All Branches Overview | `/branches` — headcount, present, in now, remote, leave, late per branch |
| 4 | Branch / Department / Employee roles | `/settings/users` — roles with branch and department scope (HR officer per branch) |
| 5 | HR Can decide who makes the roster | `/roster` → Roster groups — members, maker, approver |
| 6 | Breakdown shifts | Split shifts (2–4 blocks) in shift patterns and in each roster day; night shifts split at midnight |
| 7 | Approved pay slip in | Payroll approve → lock → release; payslip PDF with company template |
| 8 | Remove mock data of new companies | New companies start empty; demo sample data removable in one click (`/settings/company`) |
| 9 | Inter communications | `/announcements` (audience, pinned, acknowledgement, read receipts) and `/messages` |
| 10 | Location / Face request On/Off | `/settings/rules` — company switches; per-employee override on the employee form |
| 11 | Hardware & equipment / Assets Form | `/assets` — register, assign, return, history; employee request form and approval |
| 12 | Employee Account Creation | Employee profile → Create app login; Employees → Create app logins (bulk) |
