/** Dashboard, the approvals inbox, reports and the audit log. */

import type { Prisma } from '@prisma/client';
import { db, dec } from '../../core/db.js';
import { assertCan, can } from '../../core/permissions.js';
import { employeeScope, type Ctx } from '../../core/context.js';
import { hasFeature } from '../../core/features.js';
import { addDays, colomboDate, dbDate, fromDbDate, monthRange, prevPeriod } from '../../lib/time.js';
import { fromCents, toCents } from '../../lib/money.js';
import { dayBoard } from '../attendance/service.js';
import { birthdays } from '../employees/service.js';
import { pendingForMe } from '../roster/service.js';

// ─── Approvals inbox ───────────────────────────────────────────

export async function approvals(ctx: Ctx) {
  const scope = await employeeScope(ctx);
  const notSelf: Prisma.EmployeeWhereInput = ctx.employeeId ? { AND: [scope, { id: { not: ctx.employeeId } }] } : scope;
  const empSel = { select: { id: true, empNo: true, firstName: true, lastName: true, designation: true } } as const;
  const [leave, overtime, corrections, assets, roster] = await Promise.all([
    can(ctx, 'leave.approve')
      ? db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING', employee: notSelf }, include: { employee: empSel, leaveType: { select: { name: true, color: true } } }, orderBy: { createdAt: 'asc' }, take: 200 })
      : [],
    can(ctx, 'overtime.approve') && hasFeature(ctx.features, 'overtime')
      ? db.overtimeClaim.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING', kind: 'UNROSTERED', employee: notSelf }, include: { employee: empSel }, orderBy: { date: 'asc' }, take: 200 })
      : [],
    can(ctx, 'attendance.correct')
      ? db.attendanceCorrection.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING', employee: notSelf }, include: { employee: empSel }, orderBy: { createdAt: 'asc' }, take: 200 })
      : [],
    can(ctx, 'asset.decide') && hasFeature(ctx.features, 'assets')
      ? db.assetRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING', employee: scope }, include: { employee: empSel }, orderBy: { createdAt: 'asc' }, take: 200 })
      : [],
    pendingForMe(ctx),
  ]);
  return {
    counts: { leave: leave.length, overtime: overtime.length, corrections: corrections.length, assets: assets.length, roster: roster.length, total: leave.length + overtime.length + corrections.length + assets.length + roster.length },
    leave: leave.map((l) => ({ ...l, days: Number(l.days), fromDate: fromDbDate(l.fromDate), toDate: fromDbDate(l.toDate) })),
    overtime: overtime.map((o) => ({ ...o, date: fromDbDate(o.date) })),
    corrections: corrections.map((c) => ({ ...c, date: fromDbDate(c.date) })),
    assets: assets.map((a) => ({ ...a, neededBy: a.neededBy ? fromDbDate(a.neededBy) : null })),
    roster,
  };
}

// ─── Dashboard ─────────────────────────────────────────────────

export async function dashboard(ctx: Ctx) {
  assertCan(ctx, 'dashboard.view');
  const today = colomboDate(new Date());
  const period = today.slice(0, 7);
  const scope = await employeeScope(ctx);
  const [board, inbox, bdays, headcount, joiners, leavers, holidays, lastRun, docsExpiring, probationEnding] = await Promise.all([
    dayBoard(ctx, today, {}),
    approvals(ctx),
    birthdays(ctx, today, 7),
    db.employee.count({ where: { AND: [scope, { status: 'ACTIVE' }] } }),
    db.employee.count({ where: { AND: [scope, { joinDate: { gte: dbDate(period + '-01') } }] } }),
    db.employee.count({ where: { AND: [scope, { endDate: { gte: dbDate(period + '-01'), lte: dbDate(today) } }] } }),
    db.holidayDate.findMany({ where: { tenantId: ctx.tenantId, date: { gte: dbDate(today), lte: dbDate(addDays(today, 60)) } }, orderBy: { date: 'asc' }, take: 5 }),
    can(ctx, 'payroll.view') ? db.payrollRun.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { period: 'desc' } }) : null,
    db.employeeDocument.count({ where: { tenantId: ctx.tenantId, expiresOn: { gte: dbDate(today), lte: dbDate(addDays(today, 30)) }, employee: scope } }),
    db.employee.findMany({
      where: { AND: [scope, { status: 'ACTIVE', employmentType: 'PROBATION', joinDate: { lte: dbDate(addDays(today, -150)) } }] },
      select: { id: true, firstName: true, lastName: true, joinDate: true },
      take: 10,
    }),
  ]);

  // attendance trend: last 14 closed days
  const from = addDays(today, -14);
  const trendRows = await db.attendanceDay.groupBy({
    by: ['date', 'status'],
    where: { tenantId: ctx.tenantId, date: { gte: dbDate(from), lt: dbDate(today) }, employee: scope },
    _count: true,
  });
  const trend: { date: string; present: number; absent: number; leave: number; late: number }[] = [];
  const lateRows = await db.attendanceDay.groupBy({ by: ['date'], where: { tenantId: ctx.tenantId, date: { gte: dbDate(from), lt: dbDate(today) }, lateMinutes: { gt: 0 }, employee: scope }, _count: true });
  for (let d = from; d < today; d = addDays(d, 1)) {
    const c = (st: string[]) => trendRows.filter((r) => fromDbDate(r.date) === d && st.includes(r.status)).reduce((a, r) => a + r._count, 0);
    trend.push({ date: d, present: c(['PRESENT', 'INCOMPLETE', 'HALF_LEAVE']), absent: c(['ABSENT']), leave: c(['LEAVE']), late: lateRows.find((r) => fromDbDate(r.date) === d)?._count ?? 0 });
  }

  return {
    date: today,
    today: board.summary,
    holiday: board.holiday,
    notIn: board.rows.filter((r) => r.status === 'NOT_IN').slice(0, 12).map((r) => ({ ...r.employee, roster: r.roster })),
    lateToday: board.rows.filter((r) => r.lateMinutes > 0).slice(0, 12).map((r) => ({ ...r.employee, lateMinutes: r.lateMinutes })),
    approvals: inbox.counts,
    headcount,
    joinersThisMonth: joiners,
    leaversThisMonth: leavers,
    birthdays: bdays,
    holidays: holidays.map((h) => ({ date: fromDbDate(h.date), name: h.name, kind: h.kind, multiplier: h.multiplier.toFixed(2) })),
    payroll: lastRun ? { id: lastRun.id, period: lastRun.period, status: lastRun.status, totals: lastRun.totals } : null,
    nextPayrollPeriod: lastRun ? (lastRun.status === 'LOCKED' ? nextOf(lastRun.period) : lastRun.period) : prevPeriod(period),
    docsExpiring,
    probationEnding: probationEnding.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, joinDate: fromDbDate(p.joinDate) })),
    trend,
  };
}

function nextOf(period: string) {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// ─── Reports ───────────────────────────────────────────────────

export async function headcountReport(ctx: Ctx) {
  assertCan(ctx, 'reports.view');
  const scope = await employeeScope(ctx);
  const emps = await db.employee.findMany({
    where: { AND: [scope, { status: 'ACTIVE' }] },
    select: { gender: true, employmentType: true, joinDate: true, dob: true, branch: { select: { name: true } }, department: { select: { name: true } } },
  });
  const today = colomboDate(new Date());
  const group = (f: (e: (typeof emps)[number]) => string) => {
    const m = new Map<string, number>();
    for (const e of emps) m.set(f(e), (m.get(f(e)) ?? 0) + 1);
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  const years = (d: Date | null) => (d ? Math.floor((Date.parse(today) - d.getTime()) / (365.25 * 86_400_000)) : null);
  return {
    total: emps.length,
    byBranch: group((e) => e.branch?.name ?? 'No branch'),
    byDepartment: group((e) => e.department?.name ?? 'No department'),
    byType: group((e) => e.employmentType),
    byGender: group((e) => e.gender ?? 'Not set'),
    byService: group((e) => {
      const y = years(e.joinDate) ?? 0;
      return y < 1 ? 'Under 1 year' : y < 3 ? '1–3 years' : y < 5 ? '3–5 years' : y < 10 ? '5–10 years' : '10+ years';
    }),
    byAge: group((e) => {
      const y = years(e.dob);
      if (y === null) return 'Not set';
      return y < 25 ? 'Under 25' : y < 35 ? '25–34' : y < 45 ? '35–44' : y < 55 ? '45–54' : '55+';
    }),
  };
}

export async function attendanceReport(ctx: Ctx, period: string, branchId?: string) {
  assertCan(ctx, 'reports.view');
  const { start, end } = monthRange(period);
  const scope = await employeeScope(ctx);
  const emps = await db.employee.findMany({
    where: { AND: [scope, { status: 'ACTIVE' }, ...(branchId ? [{ branchId }] : [])] },
    select: { id: true, empNo: true, firstName: true, lastName: true, department: { select: { name: true } } },
    orderBy: { empNo: 'asc' },
  });
  const days = await db.attendanceDay.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: emps.map((e) => e.id) }, date: { gte: dbDate(start), lte: dbDate(end) } } });
  return emps.map((e) => {
    const d = days.filter((x) => x.employeeId === e.id);
    const c = (s: string[]) => d.filter((x) => s.includes(x.status)).length;
    return {
      empNo: e.empNo, name: `${e.firstName} ${e.lastName}`, department: e.department?.name ?? '',
      present: c(['PRESENT', 'INCOMPLETE', 'HALF_LEAVE']), absent: c(['ABSENT']), leave: c(['LEAVE']), off: c(['OFF', 'HOLIDAY']),
      lateDays: d.filter((x) => x.lateMinutes > 0).length, lateMinutes: d.reduce((a, x) => a + x.lateMinutes, 0),
      workedHours: (d.reduce((a, x) => a + x.workedMinutes, 0) / 60).toFixed(1), otHours: (d.reduce((a, x) => a + x.otMinutes, 0) / 60).toFixed(1),
      missingOut: d.filter((x) => x.flags.includes('MISSING_MARK_OUT')).length,
    };
  });
}

export async function overtimeReport(ctx: Ctx, period: string) {
  assertCan(ctx, 'reports.view');
  const { start, end } = monthRange(period);
  const scope = await employeeScope(ctx);
  const rows = await db.overtimeClaim.findMany({
    where: { tenantId: ctx.tenantId, employee: scope, date: { gte: dbDate(start), lte: dbDate(end) } },
    include: { employee: { select: { empNo: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
  });
  const byDept = new Map<string, { department: string; approved: number; pending: number; rejected: number }>();
  for (const r of rows) {
    const k = r.employee.department?.name ?? 'No department';
    const x = byDept.get(k) ?? { department: k, approved: 0, pending: 0, rejected: 0 };
    if (r.status === 'APPROVED') x.approved += r.minutes;
    else if (r.status === 'REJECTED') x.rejected += r.minutes;
    else x.pending += r.minutes;
    byDept.set(k, x);
  }
  return { byDepartment: [...byDept.values()], rows: rows.map((r) => ({ date: fromDbDate(r.date), empNo: r.employee.empNo, name: `${r.employee.firstName} ${r.employee.lastName}`, kind: r.kind, minutes: r.minutes, status: r.status, reason: r.reason })) };
}

export async function leaveReport(ctx: Ctx, year: number) {
  assertCan(ctx, 'reports.view');
  const scope = await employeeScope(ctx);
  const rows = await db.leaveBalance.findMany({
    where: { tenantId: ctx.tenantId, year, employee: { AND: [scope, { status: 'ACTIVE' }] } },
    include: { employee: { select: { empNo: true, firstName: true, lastName: true } }, leaveType: { select: { code: true, name: true } } },
    orderBy: [{ employee: { empNo: 'asc' } }],
  });
  return rows.map((r) => ({ empNo: r.employee.empNo, name: `${r.employee.firstName} ${r.employee.lastName}`, leave: r.leaveType.name, entitled: Number(r.entitled), carried: Number(r.carried), adjusted: Number(r.adjusted), taken: Number(r.taken), available: Number(r.entitled) + Number(r.carried) + Number(r.adjusted) - Number(r.taken) }));
}

export async function payrollSummary(ctx: Ctx, year: number) {
  assertCan(ctx, 'payroll.view');
  const runs = await db.payrollRun.findMany({ where: { tenantId: ctx.tenantId, period: { startsWith: String(year) } }, orderBy: { period: 'asc' } });
  return runs.map((r) => ({ period: r.period, status: r.status, ...(r.totals as Record<string, unknown> | null) }));
}

export async function salaryCostByDepartment(ctx: Ctx, period: string) {
  assertCan(ctx, 'payroll.view');
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period } } });
  if (!run) return [];
  const slips = await db.payslip.findMany({ where: { runId: run.id }, select: { gross: true, epfEmployer: true, etf: true, snapshot: true } });
  const m = new Map<string, { department: string; people: number; gross: number; employerCost: number }>();
  for (const s of slips) {
    const d = (s.snapshot as Record<string, string | null>).department ?? 'No department';
    const x = m.get(d) ?? { department: d, people: 0, gross: 0, employerCost: 0 };
    x.people++;
    x.gross += toCents(s.gross);
    x.employerCost += toCents(s.gross) + toCents(s.epfEmployer) + toCents(s.etf);
    m.set(d, x);
  }
  return [...m.values()].map((x) => ({ ...x, gross: fromCents(x.gross), employerCost: fromCents(x.employerCost) }));
}

// ─── Audit ─────────────────────────────────────────────────────

export async function auditLog(ctx: Ctx, q: { entity?: string; actorId?: string; action?: string; from?: string; to?: string; entityId?: string; page: number; pageSize: number }) {
  assertCan(ctx, 'audit.view');
  const where: Prisma.AuditLogWhereInput = {
    tenantId: ctx.tenantId,
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from + 'T00:00:00+05:30') } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59+05:30') } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), db.auditLog.count({ where })]);
  return { rows, total };
}

export { dec };
