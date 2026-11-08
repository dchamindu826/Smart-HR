# Architecture

```
 Phone (Flutter app)          Browser (web console, /admin)        Fingerprint terminal
        │ Bearer JWT                  │ httpOnly cookies                 │ X-Terminal-Key
        └──────────────┬──────────────┴──────────────┬──────────────────┘
                       ▼                             ▼
                 Nginx (HTTPS)  ── /api/* ──▶  backend  (Express, :4000) ──▶ PostgreSQL 16
                       │                          ▲   │
                       └── /* ──▶ frontend (Next.js, :3000)   └── storage/ (uploads, payslip PDFs)
                                                  │
                                       worker (scheduled jobs, same codebase)
```

## Tenancy and roles

Every company row carries `tenantId`. The request context (`core/context.ts`)
is built from the login: user, tenant, role, linked employee, branch/department
scope, plan features, company settings.

| Role | Sees |
|---|---|
| Lumi AI platform admin (SUPER_ADMIN, ADMIN, SUPPORT, SALES) | `/admin` only; a company only through the read-only support view |
| OWNER | the whole company, billing |
| HR_MANAGER (Head of HR) | the whole company except billing and running payroll |
| HR_OFFICER (branch HR) | people and time in their branches / departments |
| PAYROLL_OFFICER | people, pay, returns |
| MANAGER | their direct and indirect reports |
| EMPLOYEE | themselves, in the mobile app |

A manager never approves their own leave, overtime or corrections.

## Plans

Plans (Starter / Growth / Complete) are rows the platform admin edits: price,
yearly price, employee limit and feature codes. A company can have a custom
price and a discount. Attendance, leave, payroll, returns, gratuity and the
mobile app are in every plan.

## Main flows

**Company created** (platform admin or demo) → head office, leave types, pay
components, general shift, payslip template, owner login with a temporary
password. Demo companies also get sample people and data.

**Employee** → added one by one or imported (Excel, CSV, Google Sheet) → app
login created one by one or in bulk (temporary password; changed on first
login) → life events (confirm, promote, transfer, resign…) are kept as history.

**Roster** → HR creates a roster group (members, maker, optional approver) →
the maker drafts the week (patterns, split blocks, night shifts split at
midnight) → the validator refuses missing rest days, overlapping blocks, days
over 16 h and planned + approved overtime over 12 h a week → submit → approve or
return → publish to the employees' app. Changes after publishing make a new
revision.

**Attendance** → the app sends a punch with GPS (`clientId` makes it safe to
resend) → office punches must be inside a branch geofence; remote punches need
GPS and are flagged if more than 2 km from home → sessions are split at
midnight → after midnight the worker closes the day: forgotten mark-outs are
closed and flagged, the meal hour is deducted only for one unbroken session
over 12:00–13:00, lateness, holiday minutes and overtime are computed →
planned overtime is approved with the roster; unrostered overtime waits for the
employee's reason and the manager's approval within the weekly limit.

**Leave** → entitlement from the Shop & Office rules → request → manager
approves → balance updates, past days are recomputed.

**Payroll** → checklist → calculate (basic, components, adjustments, no-pay,
approved overtime, holiday premium, EPF/ETF, APIT, stamp duty, loans) → approve
(by someone else when possible) → lock (final; overtime marked paid, loan
instalments recorded) → release (employees notified; payslip PDF in the app).

**Returns** → from the locked month: EPF, ETF, APIT and bank totals, due dates,
CSV export, mark as filed. Official layouts are added from real samples.

## Scheduled jobs (worker)

| Job | When (Colombo) |
|---|---|
| Day close for the last 3 days | after 00:15 daily |
| Disable logins of people who left | after 00:30 daily |
| Birthday notifications (day and month only, opt-out respected) | after 07:00 daily |
| Leave balance refresh | 1st of the month |
| New leave year | 1 January |
| Gratuity accrual | 1st of the month |
| Invoices | 1st of the month |
| Demo / trial expiry | daily |
| Clean-up of old tokens and notifications | daily |

## Security

bcrypt passwords, lock after 5 wrong attempts, rotating refresh tokens with
reuse detection, httpOnly SameSite cookies plus a custom header on writes,
TOTP two-factor for platform admins, rate limits on login, files served only
through authorised routes, every change in the audit log.
