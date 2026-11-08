/**
 * Payroll runs. DRAFT → CALCULATED → APPROVED → LOCKED, then released to employees.
 * A locked month is never edited; corrections are adjustments (arrears) in an open month.
 */

import type { Prisma, PayrollStatus } from '@prisma/client';
import { db, dec } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound, rule } from '../../core/errors.js';
import { assertCan, can } from '../../core/permissions.js';
import { assertEmployeeInScope, assertWritable, employeeScope, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { notify } from '../../core/notify.js';
import { payRates } from '../../core/settings.js';
import { invalidateRuns } from './invalidate.js';
import { computePayslip, type PayComponent } from '../../rules/payroll.js';
import { fromCents, toCents } from '../../lib/money.js';
import { dbDate, eachDate, fromDbDate, monthRange } from '../../lib/time.js';

// ─── Components and adjustments ────────────────────────────────

export interface ComponentInput {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  epfApplicable?: boolean;
  taxable?: boolean;
  fixed?: boolean;
  affectedByNoPay?: boolean;
  active?: boolean;
  sortOrder?: number;
}

export async function listComponents(ctx: Ctx) {
  if (!can(ctx, 'employee.pay.edit')) assertCan(ctx, 'payroll.view');
  return db.salaryComponent.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { employees: { where: { effectiveTo: null } } } } } });
}

export async function saveComponent(ctx: Ctx, id: string | null, i: ComponentInput) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.pay.edit');
  const c = id
    ? await db.salaryComponent.update({ where: { id, tenantId: ctx.tenantId }, data: { ...i, code: i.code.toUpperCase() } })
    : await db.salaryComponent.create({ data: { ...i, code: i.code.toUpperCase(), tenantId: ctx.tenantId } });
  await writeAudit(db, ctx, id ? 'component.update' : 'component.create', 'SalaryComponent', c.id, null, i);
  return c;
}

export interface AdjustmentInput {
  employeeId: string;
  period: string;
  kind: 'EARNING' | 'DEDUCTION';
  code: string;
  label: string;
  amount: string;
  epfApplicable?: boolean;
  taxable?: boolean;
  reason?: string | null;
}

async function openRunOrNone(tenantId: string, period: string) {
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period } } });
  if (run && (run.status === 'LOCKED' || run.status === 'APPROVED')) throw rule(`Payroll for ${period} is ${run.status.toLowerCase()}. Add the adjustment to the next month as arrears.`);
  return run;
}

export async function listAdjustments(ctx: Ctx, period: string) {
  assertCan(ctx, 'payroll.view');
  const rows = await db.payAdjustment.findMany({
    where: { tenantId: ctx.tenantId, period },
    include: { employee: { select: { id: true, empNo: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({ ...r, amount: dec(r.amount) }));
}

export async function addAdjustment(ctx: Ctx, i: AdjustmentInput) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  await assertEmployeeInScope(ctx, i.employeeId);
  await openRunOrNone(ctx.tenantId, i.period);
  if (toCents(i.amount) <= 0) throw badRequest('Enter an amount above zero.');
  const a = await db.payAdjustment.create({ data: { ...i, code: i.code.toUpperCase(), tenantId: ctx.tenantId, createdById: ctx.userId } });
  await invalidateRuns(ctx.tenantId, `${i.period}-01`, 'Adjustment added');
  await writeAudit(db, ctx, 'payroll.adjustment.add', 'PayAdjustment', a.id, null, i);
  return a;
}

export async function deleteAdjustment(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  const a = await db.payAdjustment.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Adjustment');
  await openRunOrNone(ctx.tenantId, a.period);
  await db.payAdjustment.delete({ where: { id } });
  await invalidateRuns(ctx.tenantId, `${a.period}-01`, 'Adjustment removed');
  await writeAudit(db, ctx, 'payroll.adjustment.delete', 'PayAdjustment', id, { ...a, amount: a.amount.toFixed(2) }, null);
}

// ─── Runs ──────────────────────────────────────────────────────

export async function listRuns(ctx: Ctx) {
  assertCan(ctx, 'payroll.view');
  const runs = await db.payrollRun.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { period: 'desc' }, take: 36, include: { _count: { select: { payslips: true } } } });
  return runs.map((r) => ({ ...r, periodStart: fromDbDate(r.periodStart), periodEnd: fromDbDate(r.periodEnd) }));
}

export async function createRun(ctx: Ctx, period: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  const { start, end } = monthRange(period);
  const exists = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period } } });
  if (exists) return exists;
  const r = await db.payrollRun.create({ data: { tenantId: ctx.tenantId, period, periodStart: dbDate(start), periodEnd: dbDate(end) } });
  await writeAudit(db, ctx, 'payroll.create', 'PayrollRun', r.id, null, { period });
  return r;
}

async function getRunOrThrow(ctx: Ctx, id: string) {
  const r = await db.payrollRun.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Payroll run');
  return r;
}

/** Things to sort out before calculating. */
export async function checklist(ctx: Ctx, id: string) {
  assertCan(ctx, 'payroll.view');
  const r = await getRunOrThrow(ctx, id);
  const start = fromDbDate(r.periodStart);
  const end = fromDbDate(r.periodEnd);
  const range = { gte: r.periodStart, lte: r.periodEnd };
  const emps = await eligibleEmployees(ctx.tenantId, start, end);
  const ids = emps.map((e) => e.id);
  const [otOpen, leaveOpen, corrOpen, noBank, zeroBasic, closedDays, rosterOpen] = await Promise.all([
    db.overtimeClaim.count({ where: { tenantId: ctx.tenantId, date: range, status: { in: ['NEEDS_REASON', 'PENDING'] } } }),
    db.leaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING', fromDate: { lte: r.periodEnd }, toDate: { gte: r.periodStart } } }),
    db.attendanceCorrection.count({ where: { tenantId: ctx.tenantId, status: 'PENDING', date: range } }),
    db.employee.count({ where: { id: { in: ids }, OR: [{ accountNo: null }, { bankCode: null }] } }),
    db.employee.count({ where: { id: { in: ids }, basicSalary: { lte: 0 } } }),
    db.attendanceDay.count({ where: { tenantId: ctx.tenantId, date: range, employeeId: { in: ids } } }),
    db.rosterWeek.count({ where: { tenantId: ctx.tenantId, weekStart: { lte: r.periodEnd, gte: new Date(r.periodStart.getTime() - 6 * 86_400_000) }, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'] } } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const daysSoFar = eachDate(start, end < today ? end : today).filter((d) => d < today).length;
  const expectedDays = emps.reduce((a, e) => {
    const from = fromDbDate(e.joinDate) > start ? fromDbDate(e.joinDate) : start;
    return a + eachDate(from, end).filter((d) => d < today).length;
  }, 0);
  return {
    employees: emps.length,
    items: [
      { key: 'ot', label: 'Overtime claims waiting for a reason or approval', count: otOpen, blocking: false, link: '/overtime' },
      { key: 'leave', label: 'Leave requests waiting for approval', count: leaveOpen, blocking: false, link: '/approvals' },
      { key: 'corrections', label: 'Attendance corrections waiting', count: corrOpen, blocking: false, link: '/approvals' },
      { key: 'roster', label: 'Roster weeks not yet published', count: rosterOpen, blocking: false, link: '/roster' },
      { key: 'bank', label: 'Employees without bank details', count: noBank, blocking: false, link: '/employees' },
      { key: 'basic', label: 'Employees with zero basic salary', count: zeroBasic, blocking: false, link: '/employees' },
      { key: 'days', label: 'Attendance days not yet closed', count: Math.max(0, expectedDays - closedDays), blocking: false, link: '/attendance' },
    ],
    daysSoFar,
  };
}

/**
 * Approved overtime to pay in this run: this month's, plus earlier months' that
 * were approved after those months were locked (arrears). Overtime from an
 * earlier month whose own run is still open stays with that run.
 */
async function unpaidOvertime(tenantId: string, employeeIds: string[], run: { id: string; periodStart: Date; periodEnd: Date }) {
  const openEarlier = await db.payrollRun.findMany({ where: { tenantId, status: { not: 'LOCKED' }, periodStart: { lt: run.periodStart } }, select: { periodStart: true, periodEnd: true } });
  const claims = await db.overtimeClaim.findMany({
    where: { tenantId, employeeId: { in: employeeIds }, status: 'APPROVED', date: { lte: run.periodEnd }, OR: [{ payrollRunId: null }, { payrollRunId: run.id }] },
  });
  return claims.filter((c) => c.date >= run.periodStart || !openEarlier.some((o) => c.date >= o.periodStart && c.date <= o.periodEnd));
}

async function eligibleEmployees(tenantId: string, start: string, end: string) {
  return db.employee.findMany({
    where: { tenantId, joinDate: { lte: dbDate(end) }, OR: [{ endDate: null }, { endDate: { gte: dbDate(start) } }], status: { not: 'ABSCONDED' } },
    include: { branch: { select: { name: true } }, department: { select: { name: true } } },
    orderBy: { empNo: 'asc' },
  });
}

export async function calculate(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  const run = await getRunOrThrow(ctx, id);
  if (run.status === 'LOCKED' || run.status === 'APPROVED') throw conflict(`This run is ${run.status.toLowerCase()}. Reopen it first.`);
  const start = fromDbDate(run.periodStart);
  const end = fromDbDate(run.periodEnd);
  const { days: monthDays } = monthRange(run.period);
  const rates = await payRates(ctx.settings, end);
  if (!rates.apitBands.length) throw rule('No APIT tax table is set up. Ask Lumi AI to load the current table.');
  const emps = await eligibleEmployees(ctx.tenantId, start, end);
  const ids = emps.map((e) => e.id);
  const range = { gte: run.periodStart, lte: run.periodEnd };

  const [components, adjustments, days, claims, loans, leaves] = await Promise.all([
    db.employeeComponent.findMany({
      where: { tenantId: ctx.tenantId, employeeId: { in: ids }, effectiveFrom: { lte: run.periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }], component: { active: true } },
      include: { component: true },
      orderBy: { effectiveFrom: 'desc' },
    }),
    db.payAdjustment.findMany({ where: { tenantId: ctx.tenantId, period: run.period, employeeId: { in: ids } } }),
    db.attendanceDay.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, date: range } }),
    unpaidOvertime(ctx.tenantId, ids, run),
    db.loan.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, status: 'ACTIVE', startPeriod: { lte: run.period } }, include: { installments: true } }),
    db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: run.periodEnd }, toDate: { gte: run.periodStart } }, include: { leaveType: { select: { paid: true } } } }),
  ]);

  const totals = { employees: 0, gross: 0, deductions: 0, net: 0, epfEmployee: 0, epfEmployer: 0, etf: 0, apit: 0, stampDuty: 0, otPay: 0, warnings: 0 };

  await db.payslip.deleteMany({ where: { runId: run.id } });
  // overtime is reserved to this run when it is calculated, and paid when the run is locked
  await db.overtimeClaim.updateMany({ where: { tenantId: ctx.tenantId, payrollRunId: run.id }, data: { payrollRunId: null } });
  if (claims.length) await db.overtimeClaim.updateMany({ where: { id: { in: claims.map((c) => c.id) } }, data: { payrollRunId: run.id } });
  for (const e of emps) {
    // fixed components: the latest record per component
    const seen = new Set<string>();
    const comps: PayComponent[] = [];
    for (const c of components.filter((x) => x.employeeId === e.id)) {
      if (seen.has(c.componentId)) continue;
      seen.add(c.componentId);
      comps.push({ code: c.component.code, label: c.component.name, kind: c.component.kind, amount: toCents(c.amount), epfApplicable: c.component.epfApplicable, taxable: c.component.taxable, affectedByNoPay: c.component.affectedByNoPay });
    }
    const adj: PayComponent[] = adjustments
      .filter((a) => a.employeeId === e.id)
      .map((a) => ({ code: a.code, label: a.label, kind: a.kind, amount: toCents(a.amount), epfApplicable: a.epfApplicable, taxable: a.taxable, affectedByNoPay: false }));

    const myDays = days.filter((d) => d.employeeId === e.id);
    const warnings: string[] = [];
    // no-pay: unpaid leave + absence (company setting) + days outside employment
    let noPay = 0;
    for (const l of leaves.filter((x) => x.employeeId === e.id && !x.leaveType.paid)) {
      for (const d of eachDate(fromDbDate(l.fromDate) > start ? fromDbDate(l.fromDate) : start, fromDbDate(l.toDate) < end ? fromDbDate(l.toDate) : end)) {
        const ad = myDays.find((x) => fromDbDate(x.date) === d);
        if (ad && (ad.status === 'OFF' || ad.status === 'HOLIDAY')) continue;
        noPay += l.halfDay ? 0.5 : 1;
      }
    }
    if (ctx.settings.absentIsNoPay) noPay += myDays.filter((d) => d.status === 'ABSENT').length;
    const join = fromDbDate(e.joinDate);
    const leave = e.endDate ? fromDbDate(e.endDate) : null;
    const outside = eachDate(start, end).filter((d) => d < join || (leave !== null && d > leave)).length;
    if (outside > 0) {
      noPay += Math.round((outside * ctx.settings.noPayDivisorDays) / monthDays * 10) / 10;
      warnings.push(join > start ? `Joined on ${join}: pay for part of the month.` : `Left on ${leave}: pay for part of the month.`);
    }
    noPay = Math.min(noPay, ctx.settings.noPayDivisorDays);

    const paidDays = myDays.reduce((a, d) => a + (['PRESENT', 'INCOMPLETE', 'LEAVE', 'HOLIDAY'].includes(d.status) ? 1 : d.status === 'HALF_LEAVE' ? 1 : 0), 0);
    const otMinutes = claims.filter((c) => c.employeeId === e.id).reduce((a, c) => a + c.minutes, 0);
    const holidayMap = new Map<number, number>();
    for (const d of myDays) {
      if (d.holidayMinutes > 0) {
        const bp = Math.round(Number(d.multiplier.toString()) * 10_000);
        holidayMap.set(bp, (holidayMap.get(bp) ?? 0) + d.holidayMinutes);
      }
    }
    const myLoans = loans
      .filter((l) => l.employeeId === e.id)
      .map((l) => {
        const paid = l.installments.filter((i) => i.period !== run.period).reduce((a, i) => a + toCents(i.amount), 0);
        return { loanId: l.id, label: l.kind === 'ADVANCE' ? 'Salary advance' : l.kind === 'FESTIVAL' ? 'Festival advance' : 'Staff loan', installment: toCents(l.installment), outstanding: Math.max(0, toCents(l.principal) - paid) };
      });

    const r = computePayslip({
      employee: { payType: e.payType, basic: toCents(e.basicSalary), epfEligible: e.epfEligible, otEligible: e.otEligible },
      components: comps,
      adjustments: adj,
      attendance: { paidDays, noPayDays: noPay, otMinutes, holidayWork: [...holidayMap].map(([multiplierBp, minutes]) => ({ minutes, multiplierBp })) },
      loans: myLoans,
      rates,
    });
    if (!e.accountNo) warnings.push('No bank account: pay by cash or cheque.');
    const allWarnings = [...warnings, ...r.warnings];

    await db.payslip.create({
      data: {
        tenantId: ctx.tenantId,
        runId: run.id,
        employeeId: e.id,
        basic: fromCents(r.basic),
        gross: fromCents(r.gross),
        totalDeductions: fromCents(r.totalDeductions),
        net: fromCents(r.net),
        epfBase: fromCents(r.epfBase),
        epfEmployee: fromCents(r.epfEmployee),
        epfEmployer: fromCents(r.epfEmployer),
        etf: fromCents(r.etf),
        apit: fromCents(r.apit),
        stampDuty: fromCents(r.stampDuty),
        workedDays: paidDays,
        noPayDays: noPay,
        otMinutes,
        warnings: allWarnings,
        snapshot: {
          empNo: e.empNo, name: `${e.firstName} ${e.lastName}`, nameWithInitials: e.nameWithInitials, nic: e.nic, epfNo: e.epfNo,
          designation: e.designation, department: e.department?.name ?? null, branch: e.branch?.name ?? null, joinDate: join,
          bankName: e.bankName, bankCode: e.bankCode, bankBranchCode: e.bankBranchCode, accountNo: e.accountNo, accountName: e.accountName,
          loans: myLoans.map((l) => ({ loanId: l.loanId, outstandingBefore: fromCents(l.outstanding) })),
        } as Prisma.InputJsonValue,
        lines: { create: r.lines.map((l, i) => ({ code: l.code, label: l.label, kind: l.kind, amount: fromCents(l.amount), quantity: l.quantity ?? (l.loanId ? l.loanId : null), sortOrder: i })) },
      },
    });
    totals.employees++;
    totals.gross += r.gross;
    totals.deductions += r.totalDeductions;
    totals.net += r.net;
    totals.epfEmployee += r.epfEmployee;
    totals.epfEmployer += r.epfEmployer;
    totals.etf += r.etf;
    totals.apit += r.apit;
    totals.stampDuty += r.stampDuty;
    totals.otPay += r.otPay;
    if (allWarnings.length) totals.warnings++;
  }

  const t = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'employees' || k === 'warnings' ? v : fromCents(v)]));
  const updated = await db.payrollRun.update({ where: { id: run.id }, data: { status: 'CALCULATED', calculatedById: ctx.userId, calculatedAt: new Date(), totals: t } });
  await writeAudit(db, ctx, 'payroll.calculate', 'PayrollRun', run.id, null, t);
  return updated;
}

async function move(ctx: Ctx, id: string, from: PayrollStatus[], to: PayrollStatus, data: Prisma.PayrollRunUpdateInput = {}) {
  const run = await getRunOrThrow(ctx, id);
  if (!from.includes(run.status)) throw conflict(`This run is ${run.status.toLowerCase()}.`);
  const r = await db.payrollRun.update({ where: { id }, data: { status: to, ...data } });
  await writeAudit(db, ctx, `payroll.${to.toLowerCase()}`, 'PayrollRun', id, { status: run.status }, { status: to });
  return r;
}

export async function approve(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.approve');
  const run = await getRunOrThrow(ctx, id);
  if (run.calculatedById === ctx.userId && ctx.role !== 'OWNER') {
    const others = await db.user.count({ where: { tenantId: ctx.tenantId, active: true, id: { not: ctx.userId }, role: { in: ['OWNER', 'PAYROLL_OFFICER'] } } });
    if (others > 0) throw forbidden('Someone else must approve the payroll you calculated.');
  }
  return move(ctx, id, ['CALCULATED'], 'APPROVED', { approvedById: ctx.userId, approvedAt: new Date() });
}

export async function reopen(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  return move(ctx, id, ['CALCULATED', 'APPROVED'], 'DRAFT', { approvedById: null, approvedAt: null });
}

/** Lock: final. Overtime is marked paid and loan instalments are recorded. */
export async function lock(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.approve');
  const run = await getRunOrThrow(ctx, id);
  if (run.status !== 'APPROVED') throw conflict('Approve the run before locking it.');
  const slips = await db.payslip.findMany({ where: { runId: id }, include: { lines: true } });
  await db.$transaction(
    async (tx) => {
      for (const s of slips) {
        for (const l of s.lines.filter((x) => x.code === 'LOAN' && x.quantity)) {
          const loanId = l.quantity!;
          await tx.loanInstallment.upsert({
            where: { loanId_period_kind: { loanId, period: run.period, kind: 'PAYROLL' } },
            create: { loanId, period: run.period, amount: l.amount, payslipId: s.id },
            update: { amount: l.amount, payslipId: s.id },
          });
          const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId }, include: { installments: true } });
          const paid = loan.installments.reduce((a, i) => a + toCents(i.amount), 0);
          if (paid >= toCents(loan.principal)) await tx.loan.update({ where: { id: loanId }, data: { status: 'SETTLED' } });
        }
        // the loan id was only a link; show a friendly quantity on the payslip
        await tx.payslipLine.updateMany({ where: { payslipId: s.id, code: 'LOAN' }, data: { quantity: null } });
      }
      await tx.payrollRun.update({ where: { id }, data: { status: 'LOCKED', lockedById: ctx.userId, lockedAt: new Date(), ...(ctx.settings.autoReleasePayslips ? { releasedAt: new Date() } : {}) } });
      await writeAudit(tx, ctx, 'payroll.lock', 'PayrollRun', id, null, { period: run.period, payslips: slips.length });
    },
    { timeout: 120_000 },
  );
  if (ctx.settings.autoReleasePayslips) await notifyReleased(ctx, id, run.period);
  return { ok: true };
}

export async function release(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.approve');
  const run = await getRunOrThrow(ctx, id);
  if (run.status !== 'LOCKED') throw conflict('Lock the run before releasing payslips.');
  if (run.releasedAt) return run;
  const r = await db.payrollRun.update({ where: { id }, data: { releasedAt: new Date() } });
  await writeAudit(db, ctx, 'payroll.release', 'PayrollRun', id);
  await notifyReleased(ctx, id, run.period);
  return r;
}

async function notifyReleased(ctx: Ctx, runId: string, period: string) {
  const slips = await db.payslip.findMany({ where: { runId }, select: { employee: { select: { user: { select: { id: true, active: true } } } } } });
  const ids = slips.flatMap((s) => (s.employee.user && s.employee.user.active ? [s.employee.user.id] : []));
  const label = new Date(period + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  await notify({ tenantId: ctx.tenantId, userIds: ids, type: 'payslip.released', title: `Your ${label} payslip is ready`, body: 'Open the app to view it.', link: '/payslips' });
}

export async function deleteRun(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'payroll.run');
  const run = await getRunOrThrow(ctx, id);
  if (run.status === 'LOCKED') throw conflict('A locked payroll can never be deleted.');
  await db.overtimeClaim.updateMany({ where: { tenantId: ctx.tenantId, payrollRunId: id }, data: { payrollRunId: null } });
  await db.payrollRun.delete({ where: { id } });
  await writeAudit(db, ctx, 'payroll.delete', 'PayrollRun', id, { period: run.period, status: run.status }, null);
}

export async function getRun(ctx: Ctx, id: string) {
  assertCan(ctx, 'payroll.view');
  const run = await getRunOrThrow(ctx, id);
  const slips = await db.payslip.findMany({
    where: { runId: id },
    select: { id: true, employeeId: true, basic: true, gross: true, totalDeductions: true, net: true, epfEmployee: true, epfEmployer: true, etf: true, apit: true, otMinutes: true, noPayDays: true, warnings: true, snapshot: true },
    orderBy: { employee: { empNo: 'asc' } },
  });
  return {
    ...run,
    periodStart: fromDbDate(run.periodStart),
    periodEnd: fromDbDate(run.periodEnd),
    payslips: slips.map((s) => ({
      ...s,
      basic: dec(s.basic), gross: dec(s.gross), totalDeductions: dec(s.totalDeductions), net: dec(s.net),
      epfEmployee: dec(s.epfEmployee), epfEmployer: dec(s.epfEmployer), etf: dec(s.etf), apit: dec(s.apit), noPayDays: Number(s.noPayDays),
    })),
  };
}

/** One payslip. Employees see their own only after release. */
export async function getPayslip(ctx: Ctx, id: string) {
  const s = await db.payslip.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: { orderBy: { sortOrder: 'asc' } }, run: true } });
  if (!s) throw notFound('Payslip');
  if (s.employeeId === ctx.employeeId && !can(ctx, 'payroll.view')) {
    if (!s.run.releasedAt) throw notFound('Payslip');
  } else {
    assertCan(ctx, 'payroll.view');
    await assertEmployeeInScope(ctx, s.employeeId);
  }
  const year = Number(s.run.period.slice(0, 4));
  const balances = await db.leaveBalance.findMany({ where: { tenantId: ctx.tenantId, employeeId: s.employeeId, year }, include: { leaveType: { select: { name: true } } } });
  return {
    id: s.id,
    runId: s.runId,
    period: s.run.period,
    status: s.run.status,
    released: !!s.run.releasedAt,
    employeeId: s.employeeId,
    snapshot: s.snapshot,
    basic: dec(s.basic), gross: dec(s.gross), totalDeductions: dec(s.totalDeductions), net: dec(s.net),
    epfBase: dec(s.epfBase), epfEmployee: dec(s.epfEmployee), epfEmployer: dec(s.epfEmployer), etf: dec(s.etf), apit: dec(s.apit), stampDuty: dec(s.stampDuty),
    workedDays: Number(s.workedDays), noPayDays: Number(s.noPayDays), otMinutes: s.otMinutes, warnings: s.warnings,
    lines: s.lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, amount: dec(l.amount), quantity: l.code === 'LOAN' ? null : l.quantity })),
    leave: balances.map((b) => ({ name: b.leaveType.name, available: Number(b.entitled) + Number(b.carried) + Number(b.adjusted) - Number(b.taken), taken: Number(b.taken) })),
  };
}

export async function myPayslips(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.payslip.findMany({
    where: { tenantId: ctx.tenantId, employeeId: ctx.employeeId, run: { releasedAt: { not: null } } },
    select: { id: true, net: true, gross: true, run: { select: { period: true, releasedAt: true } } },
    orderBy: { run: { period: 'desc' } },
    take: 36,
  });
  return rows.map((r) => ({ id: r.id, period: r.run.period, releasedAt: r.run.releasedAt, net: dec(r.net), gross: dec(r.gross) }));
}

// ─── Template ──────────────────────────────────────────────────

export async function getTemplate(ctx: Ctx) {
  return db.payslipTemplate.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId }, update: {} });
}

export async function updateTemplate(ctx: Ctx, i: Partial<Prisma.PayslipTemplateUpdateInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'payslip.template');
  const t = await db.payslipTemplate.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...(i as object) }, update: i });
  await writeAudit(db, ctx, 'payslip.template', 'PayslipTemplate', t.id, null, i);
  return t;
}

// ─── Bank file and register ────────────────────────────────────

export async function bankRows(ctx: Ctx, id: string) {
  assertCan(ctx, 'payroll.view');
  const run = await getRunOrThrow(ctx, id);
  if (run.status !== 'APPROVED' && run.status !== 'LOCKED') throw conflict('Approve the run first.');
  const slips = await db.payslip.findMany({ where: { runId: id }, select: { net: true, snapshot: true }, orderBy: { employee: { empNo: 'asc' } } });
  return slips.map((s) => {
    const x = s.snapshot as Record<string, string | null>;
    return { empNo: x.empNo, name: x.accountName || x.name, bankName: x.bankName, bankCode: x.bankCode, branchCode: x.bankBranchCode, accountNo: x.accountNo, amount: dec(s.net) };
  });
}

export async function registerRows(ctx: Ctx, id: string) {
  const run = await getRun(ctx, id);
  return run.payslips.map((p) => {
    const x = p.snapshot as Record<string, string | null>;
    return { empNo: x.empNo, name: x.name, designation: x.designation, department: x.department, basic: p.basic, gross: p.gross, epf8: p.epfEmployee, apit: p.apit, deductions: p.totalDeductions, net: p.net, epf12: p.epfEmployer, etf3: p.etf, noPayDays: p.noPayDays, otHours: (p.otMinutes / 60).toFixed(2) };
  });
}

export async function ytd(ctx: Ctx, employeeId: string, year: number) {
  if (employeeId !== ctx.employeeId) {
    assertCan(ctx, 'payroll.view');
    await assertEmployeeInScope(ctx, employeeId);
  }
  const rows = await db.payslip.findMany({ where: { tenantId: ctx.tenantId, employeeId, run: { period: { startsWith: String(year) }, status: 'LOCKED' } }, include: { run: { select: { period: true } } } });
  const sum = (k: 'gross' | 'net' | 'apit' | 'epfEmployee') => fromCents(rows.reduce((a, r) => a + toCents(r[k]), 0));
  return { year, months: rows.length, gross: sum('gross'), net: sum('net'), apit: sum('apit'), epfEmployee: sum('epfEmployee') };
}

export { employeeScope };
