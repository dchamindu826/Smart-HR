# SmartHR by Lumi AI

HR, attendance, roster, leave, overtime and payroll for small Sri Lankan
companies — one web system for HR and managers, one mobile app for employees,
and a platform console for Lumi AI.

```
smarthr/
├─ backend/    REST API — Node 22, Express 5, TypeScript, Prisma, PostgreSQL 16
├─ frontend/   Web console — Next.js 15, React 19, TypeScript, plain CSS
├─ deploy/     Nginx, PM2, backup and deploy scripts for the Ubuntu VPS
└─ docs/       API, architecture, deployment, the owner's memo
```

The web console and the Flutter app both talk to the same backend at `/api/v1`.

---

## 1. Run it on your computer

You need **Node.js 22** and **PostgreSQL 16**.

### Database (once)

```bash
# Ubuntu / WSL
sudo -u postgres psql -c "CREATE USER smarthr WITH PASSWORD 'smarthr' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE smarthr OWNER smarthr;"

# or with Docker
docker run --name smarthr-db -e POSTGRES_USER=smarthr -e POSTGRES_PASSWORD=smarthr -e POSTGRES_DB=smarthr -p 5432:5432 -d postgres:16
```

### Backend

```bash
cd backend
cp .env.example .env              # then set JWT_SECRET and PLATFORM_JWT_SECRET (48+ random characters each)
npm install
npx prisma migrate dev --name init
SEED_DEMO=1 npm run db:seed       # platform admin + plans + tax table + a demo company
npm run dev                       # API on http://127.0.0.1:4000
```

In a second terminal, the scheduled jobs (day close, birthdays, leave, invoices):

```bash
cd backend && npm run worker:dev
```

Make random secrets with `openssl rand -base64 48`.

### Frontend

```bash
cd frontend
cp .env.example .env.local        # BACKEND_URL=http://127.0.0.1:4000
npm install
npm run dev                       # http://localhost:3000
```

### Log in

| Where | Login | Password |
|---|---|---|
| Company console — `http://localhost:3000/login` | `owner@demo.lumiai.lk` (Owner) | `Demo@1234` |
| | `hr.demo@demo.lumiai.lk` (Head of HR) | `Demo@1234` |
| | `manager.demo@demo.lumiai.lk` (Manager, makes the Operations roster) | `Demo@1234` |
| | `payroll.demo@demo.lumiai.lk` (Payroll officer) | `Demo@1234` |
| Mobile app (employee) | `kamal.demo@demo.lumiai.lk` | `Demo@1234` |
| Lumi AI admin — `http://localhost:3000/admin/login` | `PLATFORM_ADMIN_EMAIL` from `.env` | `PLATFORM_ADMIN_PASSWORD` |

Change the platform admin password and turn on two-factor login at
**Admin logins → My security** after the first login.

### Checks

```bash
cd backend  && npm run typecheck && npm test && npm run build
cd frontend && npm run typecheck && npm run build
```

---

## 2. What is in it

**Platform admin (Lumi AI, `/admin`)** — companies with plan and monthly amount
(custom price, discount, monthly/yearly), several admin logins with roles and
two-factor login, terminal stock and allocation to companies, demo accounts with
sample data, customer analytics (MRR, trials, usage), invoices, statutory values
and the APIT table, read-only support view (reason required, recorded in both
audit logs), platform audit.

**Company console** — dashboard, approvals inbox, employees (profile, life
events, documents, salary components, app logins one by one or in bulk), bulk
import from Excel / CSV / Google Sheets, org chart, all-branches overview,
branches and departments with geofences, users and roles (Owner, Head of HR,
branch HR officer, Payroll officer, Manager, Employee), attendance day board and
month view with corrections, roster groups (HR decides who makes each roster),
weekly roster with split and night shifts and a statutory validator, shift
patterns, holiday & pay calendar, leave with Shop & Office entitlements,
overtime with reasons and the 12-hour weekly limit, payroll runs (draft →
calculated → approved → locked → released), payslip template and PDF, loans,
gratuity, statutory returns, assets & equipment with a request form,
announcements and messaging, reports, audit log, and company rules including
location and face-check on/off.

**New companies start empty** — a head office, statutory leave types, standard
pay components, a general shift and a payslip template. No sample people. Only
demo accounts get sample data, and it can be removed in one click.

---

## 3. Before a live payroll

These figures are in the code as settings and are marked **verify**. Check each
against the current law and a real payslip before paying anyone:

- APIT monthly table (seeded from 1 April 2025) — `/admin/system`
- Stamp duty threshold and amount — `/admin/system`
- OT hourly divisor (240) and no-pay divisor (30) — company rules
- Holiday premium = extra (multiplier − 1) × hourly rate per hour worked
- Annual / casual leave first-year rules — `backend/src/rules/leave.ts`
- Gratuity — `backend/src/rules/gratuity.ts`
- Official layouts of EPF C-Form, ETF R-4, APIT T-10 and the bank SLIPS file —
  the app gives correct totals and a generic CSV until a real filed sample is
  added.

---

## 4. Put it on the Ubuntu VPS

See [`docs/DEPLOY.md`](docs/DEPLOY.md).
