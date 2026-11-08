# Frontend guide — how every SmartHR screen is built

Next.js 15 App Router, TypeScript, React 19, plain CSS (`src/app/globals.css`).
No UI library, no Tailwind, no state library. **Do not add dependencies.**

## Where things go

```
src/app/(console)/<route>/page.tsx   company console (sidebar shell, login required)
src/app/admin/(panel)/<route>/page.tsx   Lumi AI platform admin (/admin/...)
src/components/ui.tsx                the UI kit (always use it)
src/components/pickers.tsx           EmployeePicker, BranchSelect, DepartmentSelect, UserSelect
src/components/Icon.tsx              icons: <Icon name="..." />
src/lib/api.ts                       api.get/post/put/patch/del/upload, download(), fileUrl()
src/lib/hooks.ts                     useApi, useAction, useDebounced, usePoll
src/lib/format.ts                    money, date, time, dur, hhmm, parseHhmm, today, periodLabel …
src/lib/auth.tsx                     useAuth(): { me, can(action), has(feature), reload }
src/lib/nav.ts                       the sidebar (add new screens here)
```

## Rules

1. Every page file starts with `'use client';` and default-exports a component.
2. Dynamic segments: read them with `useParams()` from `next/navigation`
   (never from props). Query strings: `useSearchParams()` (the console layout
   already wraps pages in `<Suspense>`).
3. Imports use `@/…` (e.g. `import { api } from '@/lib/api'`).
4. All data comes from the backend at `/api/v1/...` through `api` / `useApi`.
   The backend routes are in `backend/src/modules/*/routes.ts`, and the response
   shapes in the matching `service.ts`. Read them; do not guess field names.
   Write a local `interface` for each response you use.
5. Money is a **string** on the wire (`"65000.00"`). Show with `money(v)`.
   Send money as a string. Never do payroll maths in the browser.
6. Durations are integer minutes: show with `dur(min)`. Times of day are minutes
   after midnight: `hhmm(510)` → `08:30`, `parseHhmm('08:30')` → 510.
   Dates are `YYYY-MM-DD` strings: show with `date(d)`; today is `today()`.
   A Colombo date + time to an ISO instant: `colomboIso('2026-10-05', '08:30')`.
7. Hide what the user cannot do: `const { can, has } = useAuth();`
   `can('payroll.run')`, `has('roster')`. The backend enforces it anyway.
8. Loading/errors: `const { data, error, loading, reload } = useApi<T>(path, query)`
   then `<Async data={data} error={error} loading={loading}>{(d) => …}</Async>`.
9. Mutations: `const act = useAction();` then
   `const r = await act.run(() => api.post(...)); if (r !== undefined) { toast('Saved.'); reload(); }`
   and show `<ErrorBox error={act.error} />`. `act.busy` disables buttons.
10. Confirmations: `const { toast, confirm } = useUi();`
    `if ((await confirm({ title: 'Lock payroll?', body: '…', ok: 'Lock', danger: true })) === false) return;`
    Ask for a reason: `const reason = await confirm({ title, input: { label: 'Reason', minLength: 5 } }); if (reason === false) return;`
11. Forms live in a `<Modal title=… onClose=… footer={…}>` or a `<Card>`. Use
    `<div className="form-grid">` with `<Field label=… required hint=…><Input …/></Field>`.
12. Tables: `<Card pad={false}>` → `<div className="filters">…</div>` →
    `<div className="tbl-wrap"><table className="tbl">…</table></div>` → `<Pager …/>`.
    Numbers right-aligned with `className="num"`. People with `<Person name sub href photoEmployeeId />`.
    Statuses with `<StatusChip status="APPROVED" />`.
13. Empty states: `<Empty title="No leave requests" icon="leaf">One short helpful line.</Empty>`.
14. Downloads (xlsx/csv/pdf): `download('/employees/export.xlsx', { status })`.
15. English only, short and plain. Sentence case. Say what will happen
    ("Lock payroll — this cannot be undone").
16. No `localStorage` for data. No `alert()`/`window.confirm()`.
17. Keep each page self-contained; small helper components can live in the same file.

## Type check

```
npm run typecheck
```
