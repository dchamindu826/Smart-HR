/** Overtime claims: reasons from employees, approval by managers, weekly ceiling. */

import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, notFound, rule } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertEmployeeInScope, assertNotSelf, assertWritable, employeeScope, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { invalidateRuns } from '../payroll/invalidate.js';
import { approversFor, notify, userIdForEmployee } from '../../core/notify.js';
import { checkWeeklyCap, validReason, MIN_REASON_LENGTH } from '../../rules/overtime.js';
import { addDays, dbDate, fromDbDate, weekStart } from '../../lib/time.js';

export async function weekUsed(tenantId: string, employeeId: string, date: string, excludeId?: string) {
  const ws = weekStart(date);
  const agg = await db.overtimeClaim.aggregate({
    where: { tenantId, employeeId, status: 'APPROVED', date: { gte: dbDate(ws), lte: dbDate(addDays(ws, 6)) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { minutes: true },
  });
  return agg._sum.minutes ?? 0;
}

export async function list(ctx: Ctx, q: { status?: string; from?: string; to?: string; employeeId?: string; kind?: string; mine?: boolean; page: number; pageSize: number }) {
  let emp: Prisma.EmployeeWhereInput;
  if (q.mine) emp = { id: ctx.employeeId ?? '__' };
  else {
    assertCan(ctx, 'attendance.view');
    emp = await employeeScope(ctx);
  }
  const where: Prisma.OvertimeClaimWhereInput = {
    tenantId: ctx.tenantId,
    employee: emp,
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.kind ? { kind: q.kind as never } : {}),
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.overtimeClaim.findMany({
      where,
      include: { employee: { select: { id: true, empNo: true, firstName: true, lastName: true, designation: true } } },
      orderBy: [{ date: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.overtimeClaim.count({ where }),
  ]);
  // weekly totals for the rows shown, so the approver sees the ceiling
  const out = [];
  for (const r of rows) {
    const date = fromDbDate(r.date);
    out.push({ ...r, date, weekApprovedMinutes: await weekUsed(ctx.tenantId, r.employeeId, date), capMinutes: ctx.settings.weeklyOtCapMinutes });
  }
  return { total, rows: out };
}

/** The employee explains unrostered overtime. */
export async function submitReason(ctx: Ctx, id: string, reason: string) {
  assertWritable(ctx);
  const c = await db.overtimeClaim.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { employee: { select: { firstName: true, lastName: true } } } });
  if (!c) throw notFound('Overtime claim');
  if (c.employeeId !== ctx.employeeId) throw notFound('Overtime claim');
  if (c.kind !== 'UNROSTERED') throw badRequest('Planned overtime does not need a reason.');
  if (c.status !== 'NEEDS_REASON' && c.status !== 'PENDING') throw conflict('This claim is already decided.');
  if (!validReason(reason)) throw badRequest(`Explain the overtime in at least ${MIN_REASON_LENGTH} characters.`);
  await db.overtimeClaim.update({ where: { id }, data: { reason: reason.trim(), status: 'PENDING' } });
  await writeAudit(db, ctx, 'overtime.reason', 'OvertimeClaim', id, null, { reason });
  const to = await approversFor(ctx.tenantId, c.employeeId);
  await notify({ tenantId: ctx.tenantId, userIds: to, type: 'overtime.pending', title: `Overtime to approve: ${c.employee.firstName} ${c.employee.lastName}`, body: `${fromDbDate(c.date)} · ${Math.floor(c.minutes / 60)} h ${c.minutes % 60} min — ${reason.slice(0, 80)}`, link: '/approvals' });
  return { ok: true };
}

/** Approve or reject. Approval may be partial (fewer minutes) and never passes the weekly ceiling. */
export async function decide(ctx: Ctx, id: string, approve: boolean, note?: string | null, minutes?: number) {
  assertWritable(ctx);
  assertCan(ctx, 'overtime.approve');
  requireFeature(ctx, 'overtime');
  const c = await db.overtimeClaim.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Overtime claim');
  await assertEmployeeInScope(ctx, c.employeeId);
  assertNotSelf(ctx, c.employeeId);
  if (c.kind !== 'UNROSTERED') throw badRequest('Planned overtime is approved with the roster.');
  if (c.status === 'APPROVED' || c.status === 'REJECTED') throw conflict('This claim is already decided.');
  if (c.payrollRunId) throw conflict('This claim is already in a payroll run.');
  if (approve && !validReason(c.reason)) throw rule('The employee has not given a reason yet. Overtime is never approved without one.');
  if (!approve && (!note || note.trim().length < 3)) throw badRequest('Write a short reason for rejecting.');

  let approvedMinutes = c.minutes;
  if (approve) {
    if (minutes !== undefined) {
      if (minutes <= 0 || minutes > c.minutes) throw badRequest(`Approve between 1 and ${c.minutes} minutes.`);
      approvedMinutes = minutes;
    }
    const used = await weekUsed(ctx.tenantId, c.employeeId, fromDbDate(c.date), c.id);
    const cap = checkWeeklyCap(used, approvedMinutes, ctx.settings.weeklyOtCapMinutes);
    if (!cap.allowed) throw rule(cap.message!, cap);
  }
  await db.$transaction(async (tx) => {
    await tx.overtimeClaim.update({
      where: { id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', minutes: approve ? approvedMinutes : c.minutes, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null },
    });
    await writeAudit(tx, ctx, approve ? 'overtime.approve' : 'overtime.reject', 'OvertimeClaim', id, { minutes: c.minutes }, { minutes: approvedMinutes, note });
  });
  // overtime from a locked month is paid as arrears by the next payroll run
  if (approve) await invalidateRuns(ctx.tenantId, fromDbDate(c.date), 'Overtime approved');
  const uid = await userIdForEmployee(c.employeeId);
  if (uid) {
    await notify({
      tenantId: ctx.tenantId, userIds: [uid], type: approve ? 'overtime.approved' : 'overtime.rejected',
      title: `Overtime on ${fromDbDate(c.date)} ${approve ? 'approved' : 'rejected'}`,
      body: approve ? `${Math.floor(approvedMinutes / 60)} h ${approvedMinutes % 60} min approved.` : note ?? undefined,
      link: '/overtime',
    });
  }
  return { ok: true };
}

/** Weekly overtime per employee (for the overtime screen). */
export async function weekly(ctx: Ctx, week: string) {
  assertCan(ctx, 'attendance.view');
  const ws = weekStart(week);
  const scope = await employeeScope(ctx);
  const rows = await db.overtimeClaim.groupBy({
    by: ['employeeId', 'status'],
    where: { tenantId: ctx.tenantId, employee: scope, date: { gte: dbDate(ws), lte: dbDate(addDays(ws, 6)) } },
    _sum: { minutes: true },
  });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const emps = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, empNo: true, firstName: true, lastName: true } });
  return {
    weekStart: ws,
    capMinutes: ctx.settings.weeklyOtCapMinutes,
    rows: emps.map((e) => {
      const m = (st: string) => rows.find((r) => r.employeeId === e.id && r.status === st)?._sum.minutes ?? 0;
      return { employee: e, approved: m('APPROVED'), pending: m('PENDING'), needsReason: m('NEEDS_REASON'), rejected: m('REJECTED') };
    }),
  };
}
