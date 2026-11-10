# SmartHR API (v1)

Generated from `backend/src/modules/*/routes.ts`. Request bodies are the zod schemas in those files; responses are what the matching `service.ts` returns.

## Conventions

- Base path `/api/v1`. JSON in and out. Errors: `{ "error": { "code", "message", "details?" } }` with HTTP 400 (validation), 401 (log in), 402 (not in plan), 403 (not allowed / suspended / read-only), 404, 409 (conflict / duplicate), 422 (a rule refused it, e.g. weekly OT limit), 429 (too many attempts).
- **Web**: `POST /auth/login {login, password, client:"web"}` sets httpOnly cookies; every non-GET request must send the header `x-smarthr-client: web`.
- **Mobile app**: `POST /auth/login {login, password, client:"mobile"}` returns `{accessToken, refreshToken, mustChangePassword}`. Send `Authorization: Bearer <accessToken>` (15 minutes). Refresh with `POST /auth/refresh {refreshToken}` — tokens rotate; reusing an old one logs out every device in that family.
- If a login exists in more than one company the login answers 409 with `details.code = "COMPANY_REQUIRED"` and the list of companies; send `company` (the company code) again.
- Money is a string with two decimals (`"65000.00"`). Durations are integer minutes. Dates are `YYYY-MM-DD` (Asia/Colombo). Instants are ISO-8601 UTC.
- Punches are idempotent by `clientId` (generate a UUID on the phone; resend safely). `occurredAt` is the phone time; the server refuses more than 5 minutes in the future.
- Terminals authenticate with `X-Terminal-Key` (shown once when Lumi AI allocates the terminal).
- Platform admin routes use a separate cookie from `/platform/auth/login`.

## Authentication

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/login` |  |
| POST | `/api/v1/auth/refresh` |  |
| POST | `/api/v1/auth/logout` |  |
| POST | `/api/v1/auth/forgot-password` |  |
| POST | `/api/v1/auth/reset-password` |  |
| POST | `/api/v1/auth/change-password` |  |

## Me (web + app)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me` |  |
| POST | `/api/v1/me/push-token` |  |
| DELETE | `/api/v1/me/push-token` |  |
| POST | `/api/v1/me/deletion-request` | Request account deletion sent to HR |
| POST | `/api/v1/me/photo` | Upload profile photo (multipart form) |
| GET | `/api/v1/me/photo` | Stream own profile photo |
| DELETE | `/api/v1/me/photo` | Remove own profile photo |
| GET | `/api/v1/me/people/:employeeId/photo` | Stream colleague profile photo |
| PATCH | `/api/v1/me/preferences` | Update user preferences (birthdayOptOut) |
| GET | `/api/v1/me/birthdays` | Upcoming birthdays in the next 7 days |

## Attendance (app + console)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/attendance/punch` | App: one punch. |
| POST | `/api/v1/attendance/sync` | App: the offline queue. |
| GET | `/api/v1/attendance/today` |  |
| GET | `/api/v1/attendance/day` |  |
| GET | `/api/v1/attendance/month` |  |
| POST | `/api/v1/attendance/sessions` |  |
| DELETE | `/api/v1/attendance/sessions/:id` |  |
| GET | `/api/v1/attendance/corrections` |  |
| POST | `/api/v1/attendance/corrections` |  |
| POST | `/api/v1/attendance/corrections/:id/decide` |  |
| POST | `/api/v1/attendance/recalculate` | HR: re-run the day close for a past date (after fixing a roster or a holiday). |

## Roster

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/roster/groups` |  |
| POST | `/api/v1/roster/groups` |  |
| PATCH | `/api/v1/roster/groups/:id` |  |
| DELETE | `/api/v1/roster/groups/:id` |  |
| GET | `/api/v1/roster/pending` |  |
| GET | `/api/v1/roster/mine` | The signed-in employee's published roster (app). |
| GET | `/api/v1/roster/groups/:groupId/weeks/:weekStart` |  |
| PUT | `/api/v1/roster/groups/:groupId/weeks/:weekStart/days` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/fill` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/copy-previous` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/submit` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/withdraw` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/decide` |  |
| POST | `/api/v1/roster/groups/:groupId/weeks/:weekStart/publish` |  |

## Leave

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/leave/types` |  |
| POST | `/api/v1/leave/types` |  |
| PATCH | `/api/v1/leave/types/:id` |  |
| GET | `/api/v1/leave/balances` |  |
| GET | `/api/v1/leave/balances/mine` |  |
| POST | `/api/v1/leave/balances/generate` |  |
| POST | `/api/v1/leave/balances/adjust` |  |
| GET | `/api/v1/leave/requests` |  |
| POST | `/api/v1/leave/requests` |  |
| POST | `/api/v1/leave/requests/:id/decide` |  |
| POST | `/api/v1/leave/requests/:id/cancel` |  |
| GET | `/api/v1/leave/calendar` |  |

## Overtime

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/overtime` |  |
| GET | `/api/v1/overtime/weekly` |  |
| POST | `/api/v1/overtime/:id/reason` |  |
| POST | `/api/v1/overtime/:id/decide` |  |

## Payslips

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/payslips/mine` | payslips (HR and employee) |
| GET | `/api/v1/payslips/:id` |  |
| GET | `/api/v1/payslips/:id/pdf` |  |

## Announcements

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/announcements` |  |
| POST | `/api/v1/announcements` |  |
| DELETE | `/api/v1/announcements/:id` |  |
| POST | `/api/v1/announcements/:id/read` |  |
| GET | `/api/v1/announcements/:id/readers` |  |

## Messages

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/messages/people` |  |
| GET | `/api/v1/messages/unread` |  |
| GET | `/api/v1/messages` |  |
| POST | `/api/v1/messages` |  |
| GET | `/api/v1/messages/:id` |  |
| POST | `/api/v1/messages/:id` |  |
| DELETE | `/api/v1/messages/message/:messageId` |  |

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/notifications` | ─── notifications ───────────────────────────────────────────── |
| POST | `/api/v1/notifications/read-all` |  |
| POST | `/api/v1/notifications/:id/read` |  |

## Assets & equipment

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/assets/categories` |  |
| GET | `/api/v1/assets/mine` |  |
| GET | `/api/v1/assets/requests` |  |
| POST | `/api/v1/assets/requests` |  |
| POST | `/api/v1/assets/requests/:id/decide` |  |
| GET | `/api/v1/assets` |  |
| POST | `/api/v1/assets` |  |
| PATCH | `/api/v1/assets/:id` |  |
| DELETE | `/api/v1/assets/:id` |  |
| POST | `/api/v1/assets/:id/assign` |  |
| POST | `/api/v1/assets/:id/return` |  |

## Holiday & pay calendar

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/holidays` |  |
| GET | `/api/v1/holidays/defaults` |  |
| POST | `/api/v1/holidays` |  |
| POST | `/api/v1/holidays/bulk` |  |
| POST | `/api/v1/holidays/copy-year` |  |
| PATCH | `/api/v1/holidays/:id` |  |
| DELETE | `/api/v1/holidays/:id` |  |

## Dashboard

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/dashboard` |  |

## Approvals inbox

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/approvals` |  |

## Employees

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/employees` |  |
| GET | `/api/v1/employees/next-number` |  |
| GET | `/api/v1/employees/export.xlsx` |  |
| POST | `/api/v1/employees/accounts/bulk` |  |
| GET | `/api/v1/employees/birthdays` |  |
| GET | `/api/v1/employees/:id` |  |
| POST | `/api/v1/employees` |  |
| PATCH | `/api/v1/employees/:id` |  |
| DELETE | `/api/v1/employees/:id` |  |
| POST | `/api/v1/employees/:id/events` |  |
| PUT | `/api/v1/employees/:id/components` |  |
| POST | `/api/v1/employees/:id/account` |  |
| POST | `/api/v1/employees/:id/documents` |  |
| GET | `/api/v1/employees/documents/:docId/file` |  |
| DELETE | `/api/v1/employees/documents/:docId` |  |
| POST | `/api/v1/employees/:id/photo` |  |
| GET | `/api/v1/employees/:id/photo` |  |

## Bulk import

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/imports/template/:kind` |  |
| GET | `/api/v1/imports` |  |
| GET | `/api/v1/imports/:id` |  |
| POST | `/api/v1/imports/upload/:kind` |  |
| POST | `/api/v1/imports/google-sheet/:kind` |  |
| POST | `/api/v1/imports/:id/commit` |  |

## Branches, departments, org chart

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/org/branches` |  |
| GET | `/api/v1/org/branches/overview` |  |
| POST | `/api/v1/org/branches` |  |
| PATCH | `/api/v1/org/branches/:id` |  |
| DELETE | `/api/v1/org/branches/:id` |  |
| GET | `/api/v1/org/departments` |  |
| POST | `/api/v1/org/departments` |  |
| PATCH | `/api/v1/org/departments/:id` |  |
| DELETE | `/api/v1/org/departments/:id` |  |
| GET | `/api/v1/org/chart` |  |

## Company settings, users & roles

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/settings/company` |  |
| PATCH | `/api/v1/settings/company` |  |
| POST | `/api/v1/settings/company/logo` |  |
| GET | `/api/v1/settings/company/logo` |  |
| GET | `/api/v1/settings` |  |
| PATCH | `/api/v1/settings` |  |
| GET | `/api/v1/settings/roles` |  |
| GET | `/api/v1/settings/users` |  |
| POST | `/api/v1/settings/users` |  |
| PATCH | `/api/v1/settings/users/:id` |  |
| POST | `/api/v1/settings/users/:id/reset-password` |  |
| POST | `/api/v1/settings/clear-sample-data` |  |

## Shift patterns

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/shifts` |  |
| POST | `/api/v1/shifts` |  |
| PATCH | `/api/v1/shifts/:id` |  |
| DELETE | `/api/v1/shifts/:id` |  |

## Payroll

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/payroll/components` |  |
| POST | `/api/v1/payroll/components` |  |
| PATCH | `/api/v1/payroll/components/:id` |  |
| GET | `/api/v1/payroll/adjustments` |  |
| POST | `/api/v1/payroll/adjustments` |  |
| DELETE | `/api/v1/payroll/adjustments/:id` |  |
| GET | `/api/v1/payroll/runs` |  |
| POST | `/api/v1/payroll/runs` |  |
| GET | `/api/v1/payroll/runs/:id` |  |
| GET | `/api/v1/payroll/runs/:id/checklist` |  |
| POST | `/api/v1/payroll/runs/:id/calculate` |  |
| POST | `/api/v1/payroll/runs/:id/approve` |  |
| POST | `/api/v1/payroll/runs/:id/reopen` |  |
| POST | `/api/v1/payroll/runs/:id/lock` |  |
| POST | `/api/v1/payroll/runs/:id/release` |  |
| DELETE | `/api/v1/payroll/runs/:id` |  |
| GET | `/api/v1/payroll/runs/:id/bank-file.csv` |  |
| GET | `/api/v1/payroll/runs/:id/register.xlsx` |  |
| GET | `/api/v1/payroll/template` |  |
| PUT | `/api/v1/payroll/template` |  |
| GET | `/api/v1/payroll/ytd/:employeeId` |  |

## Loans & advances

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/loans` |  |
| POST | `/api/v1/loans` |  |
| PATCH | `/api/v1/loans/:id` |  |
| POST | `/api/v1/loans/:id/settle` |  |

## Gratuity

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/gratuity` |  |
| GET | `/api/v1/gratuity/export.xlsx` |  |

## Statutory returns

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/returns` |  |
| GET | `/api/v1/returns/:period/:type.csv` |  |
| POST | `/api/v1/returns/:period/:type/filed` |  |

## Reports

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/reports/headcount` |  |
| GET | `/api/v1/reports/attendance` |  |
| GET | `/api/v1/reports/overtime` |  |
| GET | `/api/v1/reports/leave` |  |
| GET | `/api/v1/reports/payroll-summary` |  |
| GET | `/api/v1/reports/salary-cost` |  |

## Audit log

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/audit` |  |

## Terminals (device API)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/terminal/punches` | ─── Terminal ingest (no user login; the device key authenticates) ── |
| GET | `/api/v1/terminal/ping` |  |

## Platform admin (Lumi AI)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/platform/auth/login` | ─── auth ────────────────────────────────────────────────────── |
| POST | `/api/v1/platform/auth/logout` |  |
| GET | `/api/v1/platform/me` |  |
| POST | `/api/v1/platform/me/totp/setup` |  |
| POST | `/api/v1/platform/me/totp/enable` |  |
| POST | `/api/v1/platform/me/password` |  |
| GET | `/api/v1/platform/admins` |  |
| POST | `/api/v1/platform/admins` |  |
| PATCH | `/api/v1/platform/admins/:id` |  |
| GET | `/api/v1/platform/plans` |  |
| POST | `/api/v1/platform/plans` |  |
| PATCH | `/api/v1/platform/plans/:id` |  |
| GET | `/api/v1/platform/tenants` | ─── companies ───────────────────────────────────────────────── |
| GET | `/api/v1/platform/tenants/:id` |  |
| POST | `/api/v1/platform/tenants` |  |
| POST | `/api/v1/platform/demos` | Demo account: a company filled with sample data, expiring after N days. |
| POST | `/api/v1/platform/tenants/:id/convert-demo` |  |
| PATCH | `/api/v1/platform/tenants/:id` |  |
| POST | `/api/v1/platform/tenants/:id/status` |  |
| POST | `/api/v1/platform/tenants/:id/users/:userId/reset-password` |  |
| POST | `/api/v1/platform/tenants/:id/support` | Read-only support view: sets a 30-minute company session cookie for this browser. |
| POST | `/api/v1/platform/support/:sessionId/end` |  |
| GET | `/api/v1/platform/terminals` | ─── terminals ───────────────────────────────────────────────── |
| POST | `/api/v1/platform/terminals` |  |
| PATCH | `/api/v1/platform/terminals/:id` |  |
| POST | `/api/v1/platform/terminals/:id/allocate` |  |
| POST | `/api/v1/platform/terminals/:id/return` |  |
| POST | `/api/v1/platform/terminals/:id/rotate-key` |  |
| GET | `/api/v1/platform/invoices` | ─── invoices ────────────────────────────────────────────────── |
| POST | `/api/v1/platform/invoices/generate` |  |
| POST | `/api/v1/platform/invoices/:id/status` |  |
| GET | `/api/v1/platform/analytics` | ─── analytics, settings, audit ──────────────────────────────── |
| GET | `/api/v1/platform/system` |  |
| PUT | `/api/v1/platform/system/:key` |  |
| PUT | `/api/v1/platform/system-tax-table` |  |
| GET | `/api/v1/platform/audit` |  |

### Later additions

| Method | Path | What |
|---|---|---|
| GET | `/me/badges` | `{messages, announcements, notifications, total}` unread counts for the app |
| GET | `/attendance/today` | now also `rosterStart`, `graceMinutes`, `lateMinutes` |
| GET | `/payroll/runs/:id`, `/payslips/:id` | each payslip now has `lateDays`, `lateMinutes` (information only, no deduction) |

Sample payslips for a **demo** company: `cd backend && npm run demo:payslips -- <slug> [months]`
(attendance with some late days, a published roster and a released payroll for the last full months; refuses real companies).
