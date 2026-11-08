# Next steps (with prompts for Antigravity)

The code was written and type-checked without being able to install packages
or run a database, so the first job is to install, migrate and run it, and fix
whatever the real compilers report. Do one prompt per chat.

## 1. Install and run

> Read AGENTS.md and README.md. Install and run both apps locally: in
> `backend` run npm install, create .env from .env.example, `npx prisma migrate
> dev --name init`, `SEED_DEMO=1 npm run db:seed`, then `npm run typecheck &&
> npm test && npm run build`. In `frontend` run npm install, `npm run typecheck
> && npm run build`. Fix every error without changing behaviour or business
> rules. List each fix you made. Do not add dependencies.

## 2. Click through every screen

> Start backend (npm run dev), worker (npm run worker:dev) and frontend (npm run
> dev). Log in as owner@demo.lumiai.lk / Demo@1234 and open every sidebar item,
> then as manager.demo@demo.lumiai.lk and payroll.demo@demo.lumiai.lk, then
> /admin/login. For each screen note console errors, failed API calls (4xx/5xx)
> and anything that looks broken. Fix them one screen at a time, keeping the
> rules in AGENTS.md. Show me the list first.

## 3. A full payroll month with the demo company

> Using the demo company: start the payroll for last month, check the
> checklist, calculate, approve as payroll.demo, lock, release. Open three
> payslips (HTML and PDF) and check: basic + allowances, EPF 8 % / 12 %, ETF 3 %,
> APIT from the seeded table, no-pay days, overtime at basic ÷ 240 × 1.5. Show me
> the numbers for those three employees side by side with the rule used.

## 4. Mobile app on the new API

> The Flutter app in `smarthr_app/` must use this backend. Read docs/API.md
> (Authentication, Me, Attendance, Roster, Leave, Overtime, Payslips,
> Announcements, Notifications, Assets). Update the app: login with
> client:"mobile", token refresh, /me (attendance switches: requireLocation,
> requireFace, allowRemote), today screen from GET /attendance/today, punch and
> offline sync with clientId, my roster, leave apply and balances, overtime
> reason, payslips list + PDF, announcements with acknowledge, equipment
> requests, notifications, push token. Plan first; one screen per commit.

## 5. Real samples and figures (owner)

Collect and give to the developer:

- three real payslips from a client (to check payroll to the cent),
- a filed EPF C-Form, ETF R-4, APIT T-10 and the bank's SLIPS file format,
- the current APIT table and stamp duty rule,
- each client's Poya / gazetted holiday list for the year.

## 6. Go live

Follow docs/DEPLOY.md. Set up backups and restore one before the first client.
Run one client in parallel with their old method for a full month and compare
every payslip before switching over.
