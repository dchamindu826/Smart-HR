/** Leave types, yearly balances, requests and approval. The leave year is the calendar year. */

import type { AccrualRule, Gender, HalfDay, Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound, rule } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertEmployeeInScope, assertNotSelf, assertWritable, employeeScope, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { approversFor, notify, userIdForEmployee } from '../../core/notify.js';
import { rosterRules, readSettings } from '../../core/settings.js';
import { available, carryForward, countLeaveDays, entitlement } from '../../rules/leave.js';
import { colomboDate, dbDate, eachDate, fromDbDate, isoWeekday } from '../../lib/time.js';
import { holidayMap } from '../holidays/service.js';
import { publishedRosterDays } from '../roster/service.js';
import { closeEmployeeDay } from '../attendance/dayclose.js';

// ─── Types ─────────────────────────────────────────────────────

export interface LeaveTypeInput {
  code: string;
  name: string;
  paid?: boolean;
  rule?: AccrualRule;
  daysPerYear?: number;
  allowHalfDay?: boolean;
  allowNegative?: boolean;
  carryForwardMax?: number;
  requireDocument?: boolean;
  noticeDays?: number;
  genderOnly?: Gender | null;
  color?: string;
  active?: boolean;
  sortOrder?: number;
}

export async function listTypes(ctx: Ctx, all = false) {
  return db.leaveType.findMany({ where: { tenantId: ctx.tenantId, ...(all ? {} : { active: true }) }, orderBy: { sortOrder: 'asc' } });
}

export async function createType(ctx: Ctx, i: LeaveTypeInput) {
  assertWritable(ctx);
  assertCan(ctx, 'leave.policy');
  const t = await db.leaveType.create({ data: { ...i, code: i.code.toUpperCase(), tenantId: ctx.tenantId } });
  await writeAudit(db, ctx, 'leave.type.create', 'LeaveType', t.id, null, i);
  return t;
}

export async function updateType(ctx: Ctx, id: string, i: Partial<LeaveTypeInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'leave.policy');
  const before = await db.leaveType.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!before) throw notFound('Leave type');
  const t = await db.leaveType.update({ where: { id }, data: { ...i, code: i.code?.toUpperCase() } });
  await writeAudit(db, ctx, 'leave.type.update', 'LeaveType', id, before, i);
  return t;
}

// ─── Balances ──────────────────────────────────────────────────

/** Create or refresh the entitlement for a year. Taken and adjustments are never touched. */
export async function ensureBalances(tenantId: string, year: number, employeeIds?: string[], asOf = colomboDate(new Date())) {
  const [types, emps] = await Promise.all([
    db.leaveType.findMany({ where: { tenantId, active: true } }),
    db.employee.findMany({
      where: { tenantId, status: 'ACTIVE', ...(employeeIds ? { id: { in: employeeIds } } : {}), joinDate: { lte: dbDate(`${year}-12-31`) } },
      select: { id: true, joinDate: true, endDate: true, gender: true },
    }),
  ]);
  let n = 0;
  for (const e of emps) {
    for (const t of types) {
      if (t.genderOnly && e.gender && e.gender !== t.genderOnly) continue;
      const days = entitlement({ rule: t.rule, daysPerYear: Number(t.daysPerYear), joinDate: fromDbDate(e.joinDate), year, asOf, endDate: e.endDate ? fromDbDate(e.endDate) : null });
      if (days === 0 && t.rule !== 'NO_PAY' && t.rule !== 'STATUTORY_ANNUAL' && t.rule !== 'STATUTORY_CASUAL') continue;
      const existing = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: e.id, leaveTypeId: t.id, year } } });
      if (!existing) {
        // carry forward from last year, capped by the type
        let carried = 0;
        if (Number(t.carryForwardMax) > 0) {
          const prev = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: e.id, leaveTypeId: t.id, year: year - 1 } } });
          if (prev) carried = carryForward({ entitled: Number(prev.entitled), carried: Number(prev.carried), adjusted: Number(prev.adjusted), taken: Number(prev.taken) }, Number(t.carryForwardMax));
        }
        await db.leaveBalance.create({ data: { tenantId, employeeId: e.id, leaveTypeId: t.id, year, entitled: days, carried } });
        n++;
      } else if (Number(existing.entitled) !== days) {
        await db.leaveBalance.update({ where: { id: existing.id }, data: { entitled: days } });
        n++;
      }
    }
  }
  return n;
}

export async function balances(ctx: Ctx, year: number, q: { employeeId?: string; branchId?: string; departmentId?: string }) {
  if (q.employeeId && q.employeeId === ctx.employeeId) {
    /* own balances */
  } else {
    assertCan(ctx, 'leave.view');
    if (q.employeeId) await assertEmployeeInScope(ctx, q.employeeId);
  }
  const scope = q.employeeId === ctx.employeeId ? { tenantId: ctx.tenantId, id: ctx.employeeId ?? '' } : await employeeScope(ctx);
  const rows = await db.leaveBalance.findMany({
    where: {
      tenantId: ctx.tenantId,
      year,
      employee: { AND: [scope, { status: 'ACTIVE' }, ...(q.employeeId ? [{ id: q.employeeId }] : []), ...(q.branchId ? [{ branchId: q.branchId }] : []), ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])] },
    },
    include: { leaveType: { select: { id: true, code: true, name: true, color: true, rule: true, paid: true } }, employee: { select: { id: true, empNo: true, firstName: true, lastName: true } } },
    orderBy: [{ employee: { firstName: 'asc' } }, { leaveType: { sortOrder: 'asc' } }],
  });
  const pending = await db.leaveRequest.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: { tenantId: ctx.tenantId, status: 'PENDING', fromDate: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) }, employeeId: { in: rows.map((r) => r.employeeId) } },
    _sum: { days: true },
  });
  const pmap = new Map(pending.map((p) => [`${p.employeeId}|${p.leaveTypeId}`, Number(p._sum.days ?? 0)]));
  return rows.map((r) => {
    const b = { entitled: Number(r.entitled), carried: Number(r.carried), adjusted: Number(r.adjusted), taken: Number(r.taken) };
    const p = pmap.get(`${r.employeeId}|${r.leaveTypeId}`) ?? 0;
    return { id: r.id, employee: r.employee, leaveType: r.leaveType, year, ...b, pending: p, available: available(b, p) };
  });
}

export async function myBalances(ctx: Ctx, year: number) {
  if (!ctx.employeeId) return [];
  await ensureBalances(ctx.tenantId, year, [ctx.employeeId]);
  return balances(ctx, year, { employeeId: ctx.employeeId });
}

export async function adjust(ctx: Ctx, i: { employeeId: string; leaveTypeId: string; year: number; days: number; reason: string }) {
  assertWritable(ctx);
  assertCan(ctx, 'leave.adjust');
  await assertEmployeeInScope(ctx, i.employeeId);
  const t = await db.leaveType.findFirst({ where: { id: i.leaveTypeId, tenantId: ctx.tenantId } });
  if (!t) throw notFound('Leave type');
  await ensureBalances(ctx.tenantId, i.year, [i.employeeId]);
  const b = await db.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_year: { employeeId: i.employeeId, leaveTypeId: i.leaveTypeId, year: i.year } },
    create: { tenantId: ctx.tenantId, employeeId: i.employeeId, leaveTypeId: i.leaveTypeId, year: i.year, adjusted: i.days },
    update: { adjusted: { increment: i.days } },
  });
  await writeAudit(db, ctx, 'leave.adjust', 'LeaveBalance', b.id, null, i);
  return b;
}

export async function generateYear(ctx: Ctx, year: number) {
  assertWritable(ctx);
  assertCan(ctx, 'leave.adjust');
  const n = await ensureBalances(ctx.tenantId, year);
  await writeAudit(db, ctx, 'leave.generate', 'LeaveBalance', null, null, { year, rows: n });
  return { updated: n };
}

// ─── Requests ──────────────────────────────────────────────────

/** Whether `date` is a working day for this employee (roster first, then the work week). */
export async function workingDayFn(tenantId: string, employee: { id: string; branchId: string | null; rosterGroupId: string | null }, from: string, to: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const s = readSettings(t.settings);
  const [holidays, roster] = await Promise.all([holidayMap(tenantId, from, to, employee.branchId), publishedRosterDays(tenantId, [employee.id], from, to, rosterRules(s))]);
  return (date: string) => {
    const h = holidays.get(date);
    if (h?.isPaidOff) return false;
    const r = roster.get(`${employee.id}|${date}`);
    if (r) return !(r.isOff || r.segments.length === 0);
    return (s.workWeek[isoWeekday(date) - 1] ?? 0) > 0;
  };
}

export interface ApplyInput {
  employeeId?: string; // HR applying on someone's behalf
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay?: HalfDay | null;
  reason?: string | null;
  autoApprove?: boolean;
}

export async function apply(ctx: Ctx, i: ApplyInput) {
  assertWritable(ctx);
  const onBehalf = !!i.employeeId && i.employeeId !== ctx.employeeId;
  const employeeId = i.employeeId ?? ctx.employeeId;
  if (!employeeId) throw forbidden('Your login is not linked to an employee record.');
  if (onBehalf) {
    assertCan(ctx, 'leave.approve');
    await assertEmployeeInScope(ctx, employeeId);
  }
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: ctx.tenantId }, select: { id: true, firstName: true, lastName: true, gender: true, branchId: true, rosterGroupId: true, status: true, joinDate: true } });
  if (e.status !== 'ACTIVE') throw badRequest('This employee is not active.');
  const t = await db.leaveType.findFirst({ where: { id: i.leaveTypeId, tenantId: ctx.tenantId, active: true } });
  if (!t) throw notFound('Leave type');
  if (t.genderOnly && e.gender && t.genderOnly !== e.gender) throw badRequest(`${t.name} is not available for this employee.`);
  if (i.halfDay && !t.allowHalfDay) throw badRequest(`${t.name} cannot be taken as a half day.`);
  if (i.toDate < i.fromDate) throw badRequest('The end date is before the start date.');
  if (i.fromDate.slice(0, 4) !== i.toDate.slice(0, 4)) throw badRequest('Split leave that crosses the new year into two requests.');
  if (i.fromDate < fromDbDate(e.joinDate)) throw badRequest('Leave cannot start before the joining date.');
  const today = colomboDate(new Date());
  if (!onBehalf && t.noticeDays > 0 && i.fromDate > today) {
    const days = (Date.parse(i.fromDate) - Date.parse(today)) / 86_400_000;
    if (days < t.noticeDays) throw rule(`${t.name} needs ${t.noticeDays} days' notice.`);
  }

  const overlap = await db.leaveRequest.findFirst({
    where: { tenantId: ctx.tenantId, employeeId, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: dbDate(i.toDate) }, toDate: { gte: dbDate(i.fromDate) } },
  });
  if (overlap && !(i.halfDay && overlap.halfDay && overlap.halfDay !== i.halfDay && i.fromDate === i.toDate)) {
    throw conflict(`There is already a leave request from ${fromDbDate(overlap.fromDate)} to ${fromDbDate(overlap.toDate)}.`);
  }
  const isWorking = await workingDayFn(ctx.tenantId, e, i.fromDate, i.toDate);
  const days = countLeaveDays(i.fromDate, i.toDate, i.halfDay ?? null, isWorking);
  if (days === 0) throw badRequest('These dates are all rest days or holidays. No leave is needed.');

  const year = Number(i.fromDate.slice(0, 4));
  await ensureBalances(ctx.tenantId, year, [employeeId]);
  if (!t.allowNegative && t.rule !== 'NO_PAY') {
    const rows = await balances({ ...ctx, role: 'OWNER', support: undefined }, year, { employeeId });
    const left = rows.find((b) => b.leaveType.id === t.id)?.available ?? 0;
    if (days > left) throw rule(`Not enough ${t.name.toLowerCase()}: ${left} day${left === 1 ? '' : 's'} left, this request needs ${days}. Choose no-pay leave for the rest.`);
  }

  const approveNow = onBehalf && !!i.autoApprove;
  const r = await db.$transaction(async (tx) => {
    const r = await tx.leaveRequest.create({
      data: {
        tenantId: ctx.tenantId, employeeId, leaveTypeId: t.id, fromDate: dbDate(i.fromDate), toDate: dbDate(i.toDate), halfDay: i.halfDay ?? null, days, reason: i.reason ?? null,
        status: approveNow ? 'APPROVED' : 'PENDING', ...(approveNow ? { decidedById: ctx.userId, decidedAt: new Date(), decisionNote: 'Entered by HR' } : {}),
      },
    });
    if (approveNow) await tx.leaveBalance.update({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: t.id, year } }, data: { taken: { increment: days } } });
    await writeAudit(tx, ctx, 'leave.apply', 'LeaveRequest', r.id, null, { employeeId, type: t.code, from: i.fromDate, to: i.toDate, days, approved: approveNow });
    return r;
  });
  if (approveNow) await reclosePast(ctx.tenantId, employeeId, i.fromDate, i.toDate);
  else {
    const to = await approversFor(ctx.tenantId, employeeId);
    await notify({ tenantId: ctx.tenantId, userIds: to, type: 'leave.requested', title: `Leave request: ${e.firstName} ${e.lastName}`, body: `${t.name}, ${days} day${days === 1 ? '' : 's'} from ${i.fromDate}.`, link: '/approvals' });
  }
  return { ...r, days: Number(r.days) };
}

async function reclosePast(tenantId: string, employeeId: string, from: string, to: string) {
  const today = colomboDate(new Date());
  for (const d of eachDate(from, to < today ? to : today)) if (d < today) await closeEmployeeDay(tenantId, employeeId, d);
}

export async function decide(ctx: Ctx, id: string, approve: boolean, note?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'leave.approve');
  const r = await db.leaveRequest.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { leaveType: true, employee: { select: { firstName: true, lastName: true } } } });
  if (!r) throw notFound('Leave request');
  await assertEmployeeInScope(ctx, r.employeeId);
  assertNotSelf(ctx, r.employeeId);
  if (r.status !== 'PENDING') throw conflict('This request is already decided.');
  if (!approve && (!note || note.trim().length < 3)) throw badRequest('Write a short reason for rejecting.');
  const year = r.fromDate.getUTCFullYear();
  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null } });
    if (approve) {
      await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year } },
        create: { tenantId: ctx.tenantId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year, taken: r.days },
        update: { taken: { increment: r.days } },
      });
    }
    await writeAudit(tx, ctx, approve ? 'leave.approve' : 'leave.reject', 'LeaveRequest', id, null, { note });
  });
  if (approve) await reclosePast(ctx.tenantId, r.employeeId, fromDbDate(r.fromDate), fromDbDate(r.toDate));
  const uid = await userIdForEmployee(r.employeeId);
  if (uid) {
    await notify({
      tenantId: ctx.tenantId, userIds: [uid], type: approve ? 'leave.approved' : 'leave.rejected',
      title: `Your ${r.leaveType.name.toLowerCase()} was ${approve ? 'approved' : 'rejected'}`,
      body: `${fromDbDate(r.fromDate)}${r.fromDate.getTime() !== r.toDate.getTime() ? ` to ${fromDbDate(r.toDate)}` : ''}${note ? ` — ${note}` : ''}`,
      link: '/leave',
    });
  }
  return { ok: true };
}

export async function cancel(ctx: Ctx, id: string) {
  assertWritable(ctx);
  const r = await db.leaveRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Leave request');
  const own = r.employeeId === ctx.employeeId;
  if (!own) {
    assertCan(ctx, 'leave.approve');
    await assertEmployeeInScope(ctx, r.employeeId);
  }
  if (r.status === 'CANCELLED' || r.status === 'REJECTED') throw conflict('This request is already closed.');
  const today = colomboDate(new Date());
  if (r.status === 'APPROVED' && own && fromDbDate(r.fromDate) <= today) throw rule('Leave that has started can only be cancelled by HR.');
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId: ctx.tenantId, period: fromDbDate(r.fromDate).slice(0, 7) } } });
  if (r.status === 'APPROVED' && run?.status === 'LOCKED') throw rule('Payroll for this month is locked. Adjust the balance instead.');
  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    if (r.status === 'APPROVED') {
      await tx.leaveBalance.update({ where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.fromDate.getUTCFullYear() } }, data: { taken: { decrement: r.days } } });
    }
    await writeAudit(tx, ctx, 'leave.cancel', 'LeaveRequest', id, { status: r.status }, { status: 'CANCELLED' });
  });
  if (r.status === 'APPROVED') await reclosePast(ctx.tenantId, r.employeeId, fromDbDate(r.fromDate), fromDbDate(r.toDate));
  return { ok: true };
}

export async function listRequests(ctx: Ctx, q: { status?: string; from?: string; to?: string; employeeId?: string; mine?: boolean; page: number; pageSize: number }) {
  let empWhere: Prisma.EmployeeWhereInput;
  if (q.mine) empWhere = { id: ctx.employeeId ?? '__' };
  else {
    assertCan(ctx, 'leave.view');
    empWhere = await employeeScope(ctx);
  }
  const where: Prisma.LeaveRequestWhereInput = {
    tenantId: ctx.tenantId,
    employee: empWhere,
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.from ? { toDate: { gte: dbDate(q.from) } } : {}),
    ...(q.to ? { fromDate: { lte: dbDate(q.to) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.leaveRequest.findMany({
      where,
      include: { leaveType: { select: { id: true, code: true, name: true, color: true } }, employee: { select: { id: true, empNo: true, firstName: true, lastName: true, designation: true } } },
      orderBy: q.status === 'PENDING' ? { createdAt: 'asc' } : { fromDate: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.leaveRequest.count({ where }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, days: Number(r.days), fromDate: fromDbDate(r.fromDate), toDate: fromDbDate(r.toDate) })) };
}

/** Who is on leave between two dates (team calendar). */
export async function calendar(ctx: Ctx, from: string, to: string) {
  assertCan(ctx, 'leave.view');
  const scope = await employeeScope(ctx, { self: true });
  const rows = await db.leaveRequest.findMany({
    where: { tenantId: ctx.tenantId, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lte: dbDate(to) }, toDate: { gte: dbDate(from) }, employee: scope },
    include: { leaveType: { select: { name: true, color: true } }, employee: { select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
    orderBy: { fromDate: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, status: r.status, days: Number(r.days), halfDay: r.halfDay, fromDate: fromDbDate(r.fromDate), toDate: fromDbDate(r.toDate), leaveType: r.leaveType, employee: r.employee }));
}
