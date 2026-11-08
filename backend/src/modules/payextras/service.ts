/** Loans and advances, gratuity liability, statutory returns. */

import type { ReturnType as RT } from '@prisma/client';
import { db, dec } from '../../core/db.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertEmployeeInScope, assertWritable, employeeScope, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { fromCents, toCents } from '../../lib/money.js';
import { colomboDate, fromDbDate, monthRange, nextPeriod } from '../../lib/time.js';
import { gratuity, GRATUITY } from '../../rules/gratuity.js';

// ─── Loans ─────────────────────────────────────────────────────

export async function listLoans(ctx: Ctx, q: { status?: string; employeeId?: string }) {
  assertCan(ctx, 'payroll.view');
  requireFeature(ctx, 'loans');
  const scope = await employeeScope(ctx);
  const rows = await db.loan.findMany({
    where: { tenantId: ctx.tenantId, employee: scope, ...(q.status ? { status: q.status as never } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    include: { employee: { select: { id: true, empNo: true, firstName: true, lastName: true } }, installments: { orderBy: { period: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((l) => {
    const paid = l.installments.reduce((a, i) => a + toCents(i.amount), 0);
    return {
      ...l,
      principal: dec(l.principal),
      installment: dec(l.installment),
      paid: fromCents(paid),
      outstanding: fromCents(Math.max(0, toCents(l.principal) - paid)),
      installments: l.installments.map((i) => ({ ...i, amount: dec(i.amount) })),
    };
  });
}

export async function createLoan(ctx: Ctx, i: { employeeId: string; kind: string; principal: string; installment: string; startPeriod: string; note?: string | null }) {
  assertWritable(ctx);
  assertCan(ctx, 'loan.manage');
  requireFeature(ctx, 'loans');
  await assertEmployeeInScope(ctx, i.employeeId);
  if (toCents(i.installment) <= 0 || toCents(i.principal) <= 0) throw badRequest('Enter amounts above zero.');
  if (toCents(i.installment) > toCents(i.principal)) throw badRequest('The instalment cannot be more than the loan.');
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period: i.startPeriod } } });
  if (run?.status === 'LOCKED') throw badRequest(`Payroll for ${i.startPeriod} is locked. Start from ${nextPeriod(i.startPeriod)}.`);
  const l = await db.loan.create({ data: { ...i, tenantId: ctx.tenantId, createdById: ctx.userId } });
  await writeAudit(db, ctx, 'loan.create', 'Loan', l.id, null, i);
  return l;
}

export async function updateLoan(ctx: Ctx, id: string, i: { installment?: string; status?: 'ACTIVE' | 'CANCELLED'; note?: string | null }) {
  assertWritable(ctx);
  assertCan(ctx, 'loan.manage');
  const l = await db.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { installments: true } });
  if (!l) throw notFound('Loan');
  if (i.status === 'CANCELLED' && l.installments.length) throw conflict('Instalments were already deducted. Settle the loan instead.');
  const n = await db.loan.update({ where: { id }, data: i });
  await writeAudit(db, ctx, 'loan.update', 'Loan', id, { installment: l.installment.toFixed(2), status: l.status }, i);
  return n;
}

/** Early settlement in cash: records the remaining balance as paid. */
export async function settleLoan(ctx: Ctx, id: string, note?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'loan.manage');
  const l = await db.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { installments: true } });
  if (!l) throw notFound('Loan');
  if (l.status !== 'ACTIVE') throw conflict('This loan is not active.');
  const paid = l.installments.reduce((a, i) => a + toCents(i.amount), 0);
  const rest = toCents(l.principal) - paid;
  const period = colomboDate(new Date()).slice(0, 7);
  await db.$transaction(async (tx) => {
    if (rest > 0) await tx.loanInstallment.create({ data: { loanId: id, period, amount: fromCents(rest), kind: 'SETTLEMENT' } });
    await tx.loan.update({ where: { id }, data: { status: 'SETTLED', note: note ?? l.note } });
    await writeAudit(tx, ctx, 'loan.settle', 'Loan', id, null, { amount: fromCents(rest), note });
  });
  return { settled: fromCents(Math.max(0, rest)) };
}

// ─── Gratuity ──────────────────────────────────────────────────

/** Liability for every active employee as of a date (basic + EPF-applicable fixed allowances = last drawn salary). */
export async function gratuityReport(ctx: Ctx, asOf: string) {
  assertCan(ctx, 'gratuity.view');
  const scope = await employeeScope(ctx);
  const emps = await db.employee.findMany({
    where: { AND: [scope, { status: 'ACTIVE' }] },
    select: { id: true, empNo: true, firstName: true, lastName: true, designation: true, joinDate: true, basicSalary: true, department: { select: { name: true } } },
    orderBy: { joinDate: 'asc' },
  });
  const comps = await db.employeeComponent.findMany({
    where: { tenantId: ctx.tenantId, employeeId: { in: emps.map((e) => e.id) }, effectiveTo: null, component: { kind: 'EARNING', fixed: true, epfApplicable: true } },
  });
  const headcount = await db.employee.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } });
  const rows = emps.map((e) => {
    const salary = toCents(e.basicSalary) + comps.filter((c) => c.employeeId === e.id).reduce((a, c) => a + toCents(c.amount), 0);
    const g = gratuity(fromDbDate(e.joinDate), asOf, salary);
    return { employee: { id: e.id, empNo: e.empNo, name: `${e.firstName} ${e.lastName}`, designation: e.designation, department: e.department?.name ?? null }, joinDate: fromDbDate(e.joinDate), years: g.years, eligible: g.eligible, salary: fromCents(salary), liability: fromCents(g.liability), payable: fromCents(g.amount) };
  });
  return {
    asOf,
    actApplies: headcount >= GRATUITY.minEmployees,
    headcount,
    totals: { liability: fromCents(rows.reduce((a, r) => a + toCents(r.liability), 0)), payable: fromCents(rows.reduce((a, r) => a + toCents(r.payable), 0)), eligible: rows.filter((r) => r.eligible).length },
    rows,
  };
}

/** Store the month-end liability (run by the monthly job). */
export async function accrueGratuity(tenantId: string, period: string) {
  const { end } = monthRange(period);
  const emps = await db.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, joinDate: true, basicSalary: true } });
  // same salary basis as the report: basic + EPF-applicable fixed allowances
  const comps = await db.employeeComponent.findMany({
    where: { tenantId, employeeId: { in: emps.map((e) => e.id) }, effectiveTo: null, component: { kind: 'EARNING', fixed: true, epfApplicable: true } },
  });
  for (const e of emps) {
    const salary = toCents(e.basicSalary) + comps.filter((c) => c.employeeId === e.id).reduce((a, c) => a + toCents(c.amount), 0);
    const g = gratuity(fromDbDate(e.joinDate), end, salary);
    await db.gratuityAccrual.upsert({
      where: { employeeId_period: { employeeId: e.id, period } },
      create: { tenantId, employeeId: e.id, period, years: g.years, lastSalary: fromCents(salary), liability: fromCents(g.liability), eligible: g.eligible },
      update: { years: g.years, lastSalary: fromCents(salary), liability: fromCents(g.liability), eligible: g.eligible },
    });
  }
  return emps.length;
}

// ─── Statutory returns ─────────────────────────────────────────
//
// The totals and the reconciliation are built from the locked payroll. The
// official file layouts (EPF C-Form, ETF R-4, APIT T-10, bank SLIPS) need real
// samples; until they are supplied, the export is a clear generic CSV.

export async function returnsFor(ctx: Ctx, period: string) {
  assertCan(ctx, 'returns.file');
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period } } });
  const filings = await db.returnFiling.findMany({ where: { tenantId: ctx.tenantId, period } });
  if (!run || run.status !== 'LOCKED') return { period, ready: false, message: 'Lock the payroll for this month first.', run: run ? { id: run.id, status: run.status } : null, returns: [], filings };
  const slips = await db.payslip.findMany({ where: { runId: run.id }, select: { epfBase: true, epfEmployee: true, epfEmployer: true, etf: true, apit: true, gross: true, net: true, snapshot: true } });
  const sum = (k: 'epfBase' | 'epfEmployee' | 'epfEmployer' | 'etf' | 'apit' | 'gross' | 'net') => fromCents(slips.reduce((a, s) => a + toCents(s[k]), 0));
  const epfMembers = slips.filter((s) => toCents(s.epfEmployee) > 0).length;
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { epfRegNo: true, etfRegNo: true, tinNo: true } });
  const missing: string[] = [];
  if (!t.epfRegNo) missing.push('EPF registration number');
  if (!t.etfRegNo) missing.push('ETF registration number');
  if (!t.tinNo) missing.push('TIN');
  const noEpfNo = slips.filter((s) => toCents(s.epfEmployee) > 0 && !(s.snapshot as Record<string, string | null>).epfNo).length;
  const totalEpf = fromCents(toCents(sum('epfEmployee')) + toCents(sum('epfEmployer')));
  const f = (type: RT) => filings.find((x) => x.type === type) ?? null;
  return {
    period,
    ready: true,
    run: { id: run.id, status: run.status },
    missing,
    warnings: noEpfNo ? [`${noEpfNo} employee(s) have no EPF member number.`] : [],
    returns: [
      { type: 'EPF_C_FORM', name: 'EPF — C-Form', members: epfMembers, base: sum('epfBase'), employee: sum('epfEmployee'), employer: sum('epfEmployer'), total: totalEpf, dueBy: dueDate(period, 'EPF'), filing: f('EPF_C_FORM'), formatStatus: 'sample needed' },
      { type: 'ETF_R4', name: 'ETF — R-4', members: epfMembers, base: sum('epfBase'), total: sum('etf'), dueBy: dueDate(period, 'ETF'), filing: f('ETF_R4'), formatStatus: 'sample needed' },
      { type: 'APIT_T10', name: 'APIT — monthly remittance (T-10 at year end)', members: slips.filter((s) => toCents(s.apit) > 0).length, total: sum('apit'), dueBy: dueDate(period, 'APIT'), filing: f('APIT_T10'), formatStatus: 'sample needed' },
      { type: 'BANK_SLIPS', name: 'Bank salary transfer (SLIPS)', members: slips.length, total: sum('net'), filing: f('BANK_SLIPS'), formatStatus: 'generic CSV' },
    ],
  };
}

/** Due dates as commonly applied (verify): EPF/ETF by the last day of the next month, APIT by the 15th of the next month. */
function dueDate(period: string, kind: 'EPF' | 'ETF' | 'APIT'): string {
  const next = nextPeriod(period);
  return kind === 'APIT' ? `${next}-15` : monthRange(next).end;
}

export async function returnRows(ctx: Ctx, period: string, type: RT) {
  assertCan(ctx, 'returns.file');
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period } } });
  if (!run || run.status !== 'LOCKED') throw conflict('Lock the payroll for this month first.');
  const slips = await db.payslip.findMany({ where: { runId: run.id }, select: { epfBase: true, epfEmployee: true, epfEmployer: true, etf: true, apit: true, gross: true, net: true, snapshot: true }, orderBy: { employee: { empNo: 'asc' } } });
  return slips
    .map((s) => {
      const x = s.snapshot as Record<string, string | null>;
      const base = { empNo: x.empNo, name: x.nameWithInitials || x.name, nic: x.nic, epfNo: x.epfNo };
      switch (type) {
        case 'EPF_C_FORM':
          return { ...base, earnings: dec(s.epfBase), employee: dec(s.epfEmployee), employer: dec(s.epfEmployer), total: fromCents(toCents(s.epfEmployee) + toCents(s.epfEmployer)) };
        case 'ETF_R4':
          return { ...base, earnings: dec(s.epfBase), etf: dec(s.etf) };
        case 'APIT_T10':
          return { ...base, gross: dec(s.gross), apit: dec(s.apit) };
        case 'BANK_SLIPS':
          return { ...base, bankCode: x.bankCode, branchCode: x.bankBranchCode, accountNo: x.accountNo, accountName: x.accountName || x.name, amount: dec(s.net) };
      }
    })
    .filter((r) => type !== 'EPF_C_FORM' || Number((r as { employee?: string }).employee ?? 0) > 0);
}

export async function markFiled(ctx: Ctx, period: string, type: RT, reference?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'returns.file');
  const data = await returnsFor(ctx, period);
  if (!data.ready) throw conflict('Lock the payroll for this month first.');
  const r = data.returns.find((x) => x.type === type);
  const f = await db.returnFiling.upsert({
    where: { tenantId_type_period: { tenantId: ctx.tenantId, type, period } },
    create: { tenantId: ctx.tenantId, type, period, status: 'FILED', totals: r ?? {}, reference: reference ?? null, filedAt: new Date(), filedById: ctx.userId },
    update: { status: 'FILED', totals: r ?? {}, reference: reference ?? null, filedAt: new Date(), filedById: ctx.userId },
  });
  await writeAudit(db, ctx, 'returns.filed', 'ReturnFiling', f.id, null, { type, period, reference });
  return f;
}
