# SmartHR — rules for the coding agent

SmartHR by Lumi AI is a multi-tenant HR, attendance and payroll product for
small Sri Lankan companies. This file is always loaded. Read `README.md` for
setup, `docs/ARCHITECTURE.md` for how it fits together, `docs/API.md` for every
endpoint, `frontend/FRONTEND_GUIDE.md` before touching a screen.

## Repository

```
backend/                 Express 5 + TypeScript + Prisma + PostgreSQL (port 4000)
  prisma/schema.prisma   the data model
  src/rules/             pure business rules with tests (no database)
  src/core/              config, auth, tenancy context, permissions, audit, settings, files, notify
  src/modules/<name>/    service.ts (ALL business logic) + routes.ts (validate → call service)
  src/jobs/worker.ts     scheduled jobs (day close, leave, birthdays, gratuity, invoices)
  tests/rules/           vitest
frontend/                Next.js 15 App Router (port 3000), plain CSS
  src/app/(console)/     company web console
  src/app/admin/         Lumi AI platform console
  src/components/        UI kit (ui.tsx), pickers, shells
  src/lib/               api client, hooks, formatting, auth, sidebar (nav.ts)
```

## Rules that are never broken

1. **Business logic lives only in `backend/src/modules/*/service.ts` and
   `backend/src/rules/`.** Routes validate with zod and call a service. The web
   and the mobile app call the same endpoints.
2. **Every service takes `ctx` first and filters every query by
   `ctx.tenantId`.** Employees are reached only through `employeeScope(ctx)` /
   `assertEmployeeInScope()`. Never trust a tenant id from a request.
3. **Money is integer cents in rules, `Decimal(14,2)` in the database, a string
   on the wire.** Never a JavaScript float.
4. **Durations are integer minutes.** A business date is a `@db.Date`; an
   instant is UTC. Use `src/lib/time.ts`. A day is 00:00–23:59 Asia/Colombo.
5. **Rules are pure functions with tests, written before the screen.**
6. **Statutory limits have no override for any role:** the weekly rest day and
   the 12-hour weekly overtime ceiling are refused, not warned.
7. **`AuditLog` is append-only**, written with `writeAudit()` in the same
   transaction as the change.
8. **A locked payroll month is never edited.** Corrections are adjustments
   (arrears) in an open month.
9. **Permissions come from `backend/src/core/permissions.ts`** (`assertCan`).
   Plan features from `core/features.ts` (`requireFeature`). The sidebar is
   built from both in `frontend/src/lib/nav.ts`.
10. **Statutory figures are settings or constants in one place.** Do not invent
    a rate, a threshold or a government file format. Anything marked "verify"
    or "sample needed" stays configurable; ask before changing it.
11. **English only.** Plain, short, sentence case.
12. **Location is captured at mark-in and mark-out only.** GPS is mandatory for
    remote work. Face templates never leave the phone.
13. **New companies get no sample data.** Only demo accounts do (`isSample`,
    `DEMO-` asset tags), removable in one click.

## How to work on a task

1. State the plan: files, schema changes, tests. Wait for approval on anything
   that changes the schema, auth or payroll maths.
2. Schema change → edit `schema.prisma` → `npx prisma migrate dev --name <what>`.
   Never edit an applied migration.
3. Rule first (pure function + test), then service, then route, then screen.
4. Update `docs/API.md` when an endpoint changes.
5. Run before saying it is done:
   ```
   cd backend  && npm run typecheck && npm test && npm run build
   cd frontend && npm run typecheck && npm run build
   ```
6. One task per commit.

## Do not

- Run `prisma migrate dev`, `db:reset` or the demo seed against production.
- Add a dependency without saying why and what it replaces.
- Put secrets in the repo, or log tokens, passwords or coordinates.
- Replace the hand-written auth with a hosted auth service.
- Change the meaning of an existing column; add a new one and migrate.
- Mark work done with failing checks, or delete a test to make it pass.
