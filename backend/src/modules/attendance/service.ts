/**
 * Attendance: punches from the app (and terminals), sessions, day views,
 * corrections. Day totals are written by the day-close job (dayclose.ts).
 */

import type { Prisma, WorkMode } from '@prisma/client';
import { db, type Tx } from '../../core/db.js';
import { badRequest, forbidden, notFound, rule } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertEmployeeInScope, assertNotSelf, assertWritable, employeeScope, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { approversFor, notify, userIdForEmployee } from '../../core/notify.js';
import { attendanceRules, locationPolicy, rosterRules, readSettings } from '../../core/settings.js';
import { checkLocation, planPunch, splitAtMidnight, todaySoFar } from '../../rules/attendance.js';
import { addDays, colomboDate, colomboInstant, colomboMidnightAfter, dbDate, eachDate, fromDbDate, minutesBetween, monthRange } from '../../lib/time.js';
import { publishedRosterDays } from '../roster/service.js';
import { holidayMap } from '../holidays/service.js';
import { closeEmployeeDay } from './dayclose.js';

export interface PunchInput {
  clientId: string;
  kind: 'IN' | 'OUT';
  mode: WorkMode;
  occurredAt: Date;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  mocked?: boolean;
  faceScore?: number | null;
  faceVerified?: boolean | null;
}

export interface PunchOutcome {
  clientId: string;
  result: 'ACCEPTED' | 'REJECTED' | 'DUPLICATE';
  reason?: string;
  sessionId?: string | null;
  flags?: string[];
}

/** Close a session at `endAt`, splitting at every midnight it crosses. */
async function closeSession(tx: Tx, s: { id: string; tenantId: string; employeeId: string; startAt: Date; mode: WorkMode; source: Prisma.AttendanceSessionCreateInput['source']; branchId: string | null; flags: string[] }, endAt: Date, out: { lat?: number | null; lng?: number | null; accuracyM?: number | null }, closedBy: string) {
  const pieces = splitAtMidnight(s.startAt, endAt);
  if (pieces.length === 0) throw badRequest('Mark-out time is before mark-in time.');
  const first = pieces[0];
  await tx.attendanceSession.update({
    where: { id: s.id },
    data: { endAt: first.endAt, minutes: first.minutes, closedBy, ...(pieces.length === 1 ? { outLat: out.lat ?? null, outLng: out.lng ?? null, outAccuracyM: out.accuracyM ?? null } : {}) },
  });
  let prevId = s.id;
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    const last = i === pieces.length - 1;
    const n = await tx.attendanceSession.create({
      data: {
        tenantId: s.tenantId, employeeId: s.employeeId, date: dbDate(p.date), startAt: p.startAt, endAt: p.endAt, minutes: p.minutes,
        mode: s.mode, source: s.source, branchId: s.branchId, flags: s.flags, splitFromId: prevId, closedBy,
        ...(last ? { outLat: out.lat ?? null, outLng: out.lng ?? null, outAccuracyM: out.accuracyM ?? null } : {}),
      },
    });
    prevId = n.id;
  }
  return pieces.map((p) => p.date);
}

async function employeeFor(ctx: Ctx) {
  if (!ctx.employeeId) throw forbidden('Your login is not linked to an employee record. Ask HR.');
  const e = await db.employee.findFirst({
    where: { id: ctx.employeeId, tenantId: ctx.tenantId },
    select: { id: true, status: true, endDate: true, joinDate: true, branchId: true, allowRemote: true, requireLocation: true, requireFace: true, remoteLat: true, remoteLng: true, firstName: true, lastName: true },
  });
  if (!e) throw notFound('Employee');
  return e;
}

/** One punch. Idempotent by clientId: the same clientId twice is a DUPLICATE, never two sessions. */
export async function punch(ctx: Ctx, input: PunchInput, source: 'APP' | 'WEB' = 'APP'): Promise<PunchOutcome> {
  let p = input;
  if (ctx.support) throw forbidden('Support view is read-only.');
  const e = await employeeFor(ctx);
  const dup = await db.punchEvent.findUnique({ where: { tenantId_clientId: { tenantId: ctx.tenantId, clientId: p.clientId } } });
  if (dup) return { clientId: p.clientId, result: 'DUPLICATE', sessionId: dup.sessionId, reason: dup.reason ?? undefined };

  const now = new Date();
  const reject = async (reason: string, flags: string[] = []): Promise<PunchOutcome> => {
    await db.punchEvent.create({
      data: { tenantId: ctx.tenantId, employeeId: e.id, clientId: p.clientId, kind: p.kind, mode: p.mode, source, occurredAt: p.occurredAt, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, mocked: !!p.mocked, faceScore: p.faceScore, result: 'REJECTED', reason },
    });
    return { clientId: p.clientId, result: 'REJECTED', reason, flags };
  };

  if (e.status !== 'ACTIVE') return reject('Your employment is not active.');
  if (source === 'WEB' && !ctx.settings.allowWebPunch) return reject('Marking attendance from the web is switched off. Use the SmartHR app.');
  const date = colomboDate(p.occurredAt);
  if (e.endDate && date > fromDbDate(e.endDate)) return reject('Your employment has ended.');
  if (date < fromDbDate(e.joinDate)) return reject('This date is before your joining date.');

  const s = ctx.settings;
  const needFace = (e.requireFace ?? s.requireFace) && ctx.features.has('face');
  if (needFace && p.kind === 'IN' && p.faceVerified === false) return reject('Face check failed. Try again in good light.');

  const open = await db.attendanceSession.findFirst({ where: { tenantId: ctx.tenantId, employeeId: e.id, endAt: null }, orderBy: { startAt: 'desc' } });
  // A mark-out belongs to the open session: use its mode, and never trap someone
  // "in" because they marked out at the gate — outside the fence is flagged, not refused.
  if (p.kind === 'OUT' && open) p = { ...p, mode: open.mode };
  const branches = await db.branch.findMany({ where: { tenantId: ctx.tenantId, active: true, lat: { not: null }, lng: { not: null } }, select: { id: true, name: true, lat: true, lng: true, radiusM: true } });
  const fences = branches.map((b) => ({ id: b.id, name: b.name, lat: b.lat!, lng: b.lng!, radiusM: b.radiusM }));
  const policy = locationPolicy(s, e);
  const loc = checkLocation(
    { mode: p.mode, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, mocked: p.mocked },
    p.kind === 'OUT' ? { ...policy, officeMustBeInFence: false, allowRemote: true } : policy,
    fences,
    e.remoteLat !== null && e.remoteLng !== null ? { lat: e.remoteLat, lng: e.remoteLng } : null,
  );
  if (!loc.ok) return reject(loc.reason!, loc.flags);
  const plan = planPunch(open ? { id: open.id, startAt: open.startAt, mode: open.mode } : null, p, now);
  if (plan.action === 'REJECT') return reject(plan.reason);

  const result = await db.$transaction(async (tx) => {
    let sessionId: string;
    let closedDates: string[] = [];
    if (plan.action === 'OPEN') {
      const flags = [...loc.flags];
      if (Math.abs(now.getTime() - p.occurredAt.getTime()) > 10 * 60_000) flags.push('LATE_SYNC');
      const sess = await tx.attendanceSession.create({
        data: {
          tenantId: ctx.tenantId, employeeId: e.id, date: dbDate(date), startAt: p.occurredAt, mode: p.mode, source,
          branchId: loc.branchId ?? (p.mode === 'OFFICE' ? e.branchId : null),
          inLat: p.lat ?? null, inLng: p.lng ?? null, inAccuracyM: p.accuracyM ?? null,
          distanceHomeM: loc.distanceHomeM ?? null, faceVerified: needFace ? p.faceVerified ?? null : null, flags,
        },
      });
      sessionId = sess.id;
    } else {
      sessionId = plan.sessionId;
      const sess = await tx.attendanceSession.findUniqueOrThrow({ where: { id: plan.sessionId } });
      closedDates = await closeSession(tx, { ...sess }, p.occurredAt, p, 'USER');
    }
    await tx.punchEvent.create({
      data: {
        tenantId: ctx.tenantId, employeeId: e.id, clientId: p.clientId, kind: p.kind, mode: p.mode, source, occurredAt: p.occurredAt,
        lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, mocked: !!p.mocked, faceScore: p.faceScore, sessionId, result: 'ACCEPTED',
      },
    });
    return { sessionId, closedDates };
  });

  // A late-synced punch for a day that was already closed: recompute that day.
  const today = colomboDate(now);
  for (const d of result.closedDates) if (d < today) await closeEmployeeDay(ctx.tenantId, e.id, d).catch(() => undefined);
  if (loc.flags.includes('FAR_FROM_HOME') && plan.action === 'OPEN') {
    const to = await approversFor(ctx.tenantId, e.id);
    await notify({ tenantId: ctx.tenantId, userIds: to, type: 'attendance.far', title: `${e.firstName} ${e.lastName} marked in remotely far from home`, body: `${Math.round((loc.distanceHomeM ?? 0) / 100) / 10} km from the registered address.`, link: `/attendance?date=${date}`, push: false });
  }
  return { clientId: p.clientId, result: 'ACCEPTED', sessionId: result.sessionId, flags: loc.flags };
}

/** Offline queue from the phone: processed in time order, one by one. */
export async function sync(ctx: Ctx, punches: PunchInput[]): Promise<PunchOutcome[]> {
  const sorted = [...punches].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const out: PunchOutcome[] = [];
  for (const p of sorted) {
    try {
      out.push(await punch(ctx, p));
    } catch (e) {
      out.push({ clientId: p.clientId, result: 'REJECTED', reason: (e as Error).message });
    }
  }
  return out;
}

/** The app's home screen. */
export async function today(ctx: Ctx) {
  const e = await employeeFor(ctx);
  const now = new Date();
  const date = colomboDate(now);
  const s = ctx.settings;
  const [sessions, rosterMap, holidays, leave, pendingOt] = await Promise.all([
    db.attendanceSession.findMany({
      where: { tenantId: ctx.tenantId, employeeId: e.id, OR: [{ date: dbDate(date) }, { endAt: null }] },
      orderBy: { startAt: 'asc' },
      select: { id: true, startAt: true, endAt: true, mode: true, minutes: true, flags: true, branch: { select: { name: true } } },
    }),
    publishedRosterDays(ctx.tenantId, [e.id], date, date, rosterRules(s)),
    holidayMap(ctx.tenantId, date, date, e.branchId),
    db.leaveRequest.findFirst({ where: { tenantId: ctx.tenantId, employeeId: e.id, status: 'APPROVED', fromDate: { lte: dbDate(date) }, toDate: { gte: dbDate(date) } }, include: { leaveType: { select: { name: true } } } }),
    db.overtimeClaim.count({ where: { tenantId: ctx.tenantId, employeeId: e.id, status: 'NEEDS_REASON' } }),
  ]);
  const totals = todaySoFar(date, sessions, now, attendanceRules(s));
  const open = sessions.find((x) => !x.endAt) ?? null;
  const roster = rosterMap.get(`${e.id}|${date}`) ?? null;
  return {
    date,
    serverTime: now.toISOString(),
    state: open ? 'IN' : 'OUT',
    openSession: open,
    sessions,
    totals,
    roster,
    holiday: holidays.get(date) ?? null,
    leave: leave ? { type: leave.leaveType.name, halfDay: leave.halfDay } : null,
    normalDayMinutes: s.normalDayMinutes,
    needsReason: pendingOt,
  };
}

/** HR / manager view of one date: every employee in scope with status. */
export async function dayBoard(ctx: Ctx, date: string, f: { branchId?: string; departmentId?: string; status?: string; q?: string }) {
  assertCan(ctx, 'attendance.view');
  const scope = await employeeScope(ctx, { self: false });
  const emps = await db.employee.findMany({
    where: {
      AND: [scope, { status: 'ACTIVE', joinDate: { lte: dbDate(date) } }, ...(f.branchId ? [{ branchId: f.branchId }] : []), ...(f.departmentId ? [{ departmentId: f.departmentId }] : [])],
      ...(f.q ? { OR: [{ firstName: { contains: f.q, mode: 'insensitive' } }, { lastName: { contains: f.q, mode: 'insensitive' } }, { empNo: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    select: { id: true, empNo: true, firstName: true, lastName: true, designation: true, branchId: true, rosterGroupId: true, branch: { select: { name: true } }, department: { select: { name: true } } },
    orderBy: { firstName: 'asc' },
  });
  const ids = emps.map((e) => e.id);
  const [sessions, days, roster, leave, holidays] = await Promise.all([
    db.attendanceSession.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, date: dbDate(date) }, orderBy: { startAt: 'asc' } }),
    db.attendanceDay.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, date: dbDate(date) } }),
    publishedRosterDays(ctx.tenantId, ids, date, date, rosterRules(ctx.settings)),
    db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: dbDate(date) }, toDate: { gte: dbDate(date) } }, include: { leaveType: { select: { name: true, color: true } } } }),
    holidayMap(ctx.tenantId, date, date),
  ]);
  const now = new Date();
  const isToday = date === colomboDate(now);
  const rules = attendanceRules(ctx.settings);
  const rows = emps.map((e) => {
    const ss = sessions.filter((s) => s.employeeId === e.id);
    const closed = days.find((d) => d.employeeId === e.id);
    const r = roster.get(`${e.id}|${date}`) ?? null;
    const l = leave.find((x) => x.employeeId === e.id) ?? null;
    const live = todaySoFar(date, ss, isToday ? now : colomboMidnightAfter(date), rules);
    const firstIn = ss[0]?.startAt ?? null;
    const lastOut = ss.length && ss[ss.length - 1].endAt ? ss[ss.length - 1].endAt : null;
    let status: string = closed?.status ?? '';
    if (!closed) {
      if (ss.some((s) => !s.endAt)) status = 'IN';
      else if (ss.length) status = 'PRESENT';
      else if (l) status = l.halfDay ? 'HALF_LEAVE' : 'LEAVE';
      else if (holidays.get(date)?.isPaidOff) status = 'HOLIDAY';
      else if (r && (r.isOff || !r.segments.length)) status = 'OFF';
      else if (!r && (rules.workWeek[new Date(date + 'T00:00:00Z').getUTCDay() || 7] ?? 0) === 0) status = 'OFF';
      else status = isToday ? 'NOT_IN' : 'ABSENT';
    }
    let late = closed?.lateMinutes ?? 0;
    if (!closed && r && r.segments.length && firstIn) {
      const startMin = Math.min(...r.segments.map((x) => x.start));
      const inMin = Math.round((firstIn.getTime() - colomboInstant(date, 0).getTime()) / 60_000);
      if (inMin - startMin > rules.graceMinutes) late = inMin - startMin;
    }
    return {
      employee: { id: e.id, empNo: e.empNo, name: `${e.firstName} ${e.lastName}`, designation: e.designation, branch: e.branch?.name ?? null, department: e.department?.name ?? null },
      status,
      firstIn,
      lastOut,
      sessions: ss.map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, mode: s.mode, source: s.source, flags: s.flags, minutes: s.endAt ? s.minutes : minutesBetween(s.startAt, isToday ? now : colomboMidnightAfter(date)), inLat: s.inLat, inLng: s.inLng, distanceHomeM: s.distanceHomeM })),
      workedMinutes: closed?.workedMinutes ?? live.workedMinutes,
      paidMinutes: closed?.paidMinutes ?? live.paidMinutes,
      lateMinutes: late,
      otMinutes: closed?.otMinutes ?? 0,
      roster: r ? { isOff: r.isOff, segments: r.segments, paidMinutes: r.paidMinutes } : null,
      leave: l ? { type: l.leaveType.name, color: l.leaveType.color, halfDay: l.halfDay } : null,
      flags: [...new Set([...(closed?.flags ?? []), ...ss.flatMap((s) => s.flags)])],
      closed: !!closed,
    };
  });
  const filtered = f.status ? rows.filter((r) => r.status === f.status) : rows;
  const count = (st: string[]) => rows.filter((r) => st.includes(r.status)).length;
  return {
    date,
    holiday: holidays.get(date) ?? null,
    summary: {
      total: rows.length,
      in: count(['IN']),
      present: count(['IN', 'PRESENT', 'INCOMPLETE']),
      remoteNow: rows.filter((r) => r.status === 'IN' && r.sessions.some((s) => !s.endAt && s.mode === 'REMOTE')).length,
      late: rows.filter((r) => r.lateMinutes > 0).length,
      leave: count(['LEAVE', 'HALF_LEAVE']),
      notIn: count(['NOT_IN', 'ABSENT']),
      off: count(['OFF', 'HOLIDAY']),
      flagged: rows.filter((r) => r.flags.length > 0).length,
    },
    rows: filtered,
  };
}

/** One employee's month, day by day. */
export async function employeeMonth(ctx: Ctx, employeeId: string, period: string) {
  if (employeeId !== ctx.employeeId) {
    assertCan(ctx, 'attendance.view');
    await assertEmployeeInScope(ctx, employeeId);
  }
  const { start, end } = monthRange(period);
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: ctx.tenantId }, select: { id: true, empNo: true, firstName: true, lastName: true, branchId: true, designation: true } });
  const [sessions, days, roster, holidays, leave, ot] = await Promise.all([
    db.attendanceSession.findMany({ where: { tenantId: ctx.tenantId, employeeId, date: { gte: dbDate(start), lte: dbDate(end) } }, orderBy: { startAt: 'asc' } }),
    db.attendanceDay.findMany({ where: { tenantId: ctx.tenantId, employeeId, date: { gte: dbDate(start), lte: dbDate(end) } } }),
    publishedRosterDays(ctx.tenantId, [employeeId], start, end, rosterRules(ctx.settings)),
    holidayMap(ctx.tenantId, start, end, e.branchId),
    db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, employeeId, status: 'APPROVED', fromDate: { lte: dbDate(end) }, toDate: { gte: dbDate(start) } }, include: { leaveType: { select: { name: true, color: true } } } }),
    db.overtimeClaim.findMany({ where: { tenantId: ctx.tenantId, employeeId, date: { gte: dbDate(start), lte: dbDate(end) } } }),
  ]);
  const rows = eachDate(start, end).map((d) => {
    const closed = days.find((x) => fromDbDate(x.date) === d);
    const l = leave.find((x) => fromDbDate(x.fromDate) <= d && fromDbDate(x.toDate) >= d);
    return {
      date: d,
      status: closed?.status ?? null,
      sessions: sessions.filter((s) => fromDbDate(s.date) === d).map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, mode: s.mode, source: s.source, minutes: s.minutes, flags: s.flags })),
      workedMinutes: closed?.workedMinutes ?? 0,
      paidMinutes: closed?.paidMinutes ?? 0,
      lateMinutes: closed?.lateMinutes ?? 0,
      earlyMinutes: closed?.earlyMinutes ?? 0,
      otMinutes: closed?.otMinutes ?? 0,
      flags: closed?.flags ?? [],
      roster: roster.get(`${employeeId}|${d}`) ?? null,
      holiday: holidays.get(d) ?? null,
      leave: l ? { type: l.leaveType.name, color: l.leaveType.color, halfDay: l.halfDay } : null,
      overtime: ot.filter((o) => fromDbDate(o.date) === d).map((o) => ({ id: o.id, kind: o.kind, minutes: o.minutes, status: o.status })),
    };
  });
  const sum = (k: 'workedMinutes' | 'paidMinutes' | 'lateMinutes' | 'otMinutes') => rows.reduce((a, r) => a + r[k], 0);
  return {
    employee: e,
    period,
    rows,
    totals: {
      present: rows.filter((r) => ['PRESENT', 'INCOMPLETE', 'HALF_LEAVE'].includes(r.status ?? '')).length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
      leave: rows.filter((r) => r.status === 'LEAVE').length,
      lateDays: rows.filter((r) => r.lateMinutes > 0).length,
      workedMinutes: sum('workedMinutes'),
      paidMinutes: sum('paidMinutes'),
      lateMinutes: sum('lateMinutes'),
      otMinutes: sum('otMinutes'),
    },
  };
}

// ─── Manual sessions (HR) and corrections (employee → manager) ─

export interface ManualSession {
  employeeId: string;
  date: string;
  start: string; // ISO instant
  end: string; // ISO instant
  mode: WorkMode;
  reason: string;
}

export async function addManualSession(ctx: Ctx, i: ManualSession) {
  assertWritable(ctx);
  assertCan(ctx, 'attendance.correct');
  await assertEmployeeInScope(ctx, i.employeeId);
  assertNotSelf(ctx, i.employeeId);
  const startAt = new Date(i.start);
  const endAt = new Date(i.end);
  if (!(endAt > startAt)) throw badRequest('The end time must be after the start time.');
  if (colomboDate(startAt) !== i.date) throw badRequest('The start time is not on the chosen date.');
  if (endAt.getTime() - startAt.getTime() > 16 * 3600_000) throw badRequest('A session cannot be longer than 16 hours.');
  await assertPeriodOpen(ctx.tenantId, i.date);
  await assertNoOverlap(ctx.tenantId, i.employeeId, startAt, endAt);
  const dates = await db.$transaction(async (tx) => {
    const s = await tx.attendanceSession.create({
      data: { tenantId: ctx.tenantId, employeeId: i.employeeId, date: dbDate(i.date), startAt, mode: i.mode, source: 'MANUAL', flags: ['CORRECTED'] },
    });
    const ds = await closeSession(tx, { ...s }, endAt, {}, 'CORRECTION');
    await writeAudit(tx, ctx, 'attendance.manual', 'AttendanceSession', s.id, null, { ...i });
    return ds;
  });
  for (const d of dates) if (d < colomboDate(new Date())) await closeEmployeeDay(ctx.tenantId, i.employeeId, d);
  return { ok: true };
}

export async function deleteSession(ctx: Ctx, sessionId: string, reason: string) {
  assertWritable(ctx);
  assertCan(ctx, 'attendance.correct');
  const s = await db.attendanceSession.findFirst({ where: { id: sessionId, tenantId: ctx.tenantId } });
  if (!s) throw notFound('Session');
  await assertEmployeeInScope(ctx, s.employeeId);
  assertNotSelf(ctx, s.employeeId);
  const date = fromDbDate(s.date);
  await assertPeriodOpen(ctx.tenantId, date);
  await db.$transaction(async (tx) => {
    await tx.attendanceSession.delete({ where: { id: sessionId } });
    await writeAudit(tx, ctx, 'attendance.delete', 'AttendanceSession', sessionId, { ...s, reason }, null);
  });
  if (date < colomboDate(new Date())) await closeEmployeeDay(ctx.tenantId, s.employeeId, date);
}

async function assertPeriodOpen(tenantId: string, date: string) {
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period: date.slice(0, 7) } } });
  if (run?.status === 'LOCKED') throw rule(`Payroll for ${date.slice(0, 7)} is locked. Attendance in a locked month cannot change; pay the difference as arrears.`);
}

async function assertNoOverlap(tenantId: string, employeeId: string, startAt: Date, endAt: Date) {
  const clash = await db.attendanceSession.findFirst({
    where: { tenantId, employeeId, startAt: { lt: endAt }, OR: [{ endAt: null }, { endAt: { gt: startAt } }] },
  });
  if (clash) throw badRequest('This overlaps an existing session. Remove or change that one first.');
}

export async function requestCorrection(ctx: Ctx, i: { date: string; start: string; end: string; mode: WorkMode; reason: string; sessionId?: string | null }) {
  assertWritable(ctx);
  const e = await employeeFor(ctx);
  const startAt = new Date(i.start);
  const endAt = new Date(i.end);
  if (!(endAt > startAt)) throw badRequest('The end time must be after the start time.');
  if (i.date > colomboDate(new Date())) throw badRequest('You cannot correct a future date.');
  if (i.reason.trim().length < 10) throw badRequest('Explain what happened (10+ characters).');
  await assertPeriodOpen(ctx.tenantId, i.date);
  if (i.sessionId) {
    const own = await db.attendanceSession.findFirst({ where: { id: i.sessionId, tenantId: ctx.tenantId, employeeId: e.id }, select: { id: true } });
    if (!own) throw badRequest('That session is not yours.');
  }
  const c = await db.attendanceCorrection.create({
    data: { tenantId: ctx.tenantId, employeeId: e.id, date: dbDate(i.date), sessionId: i.sessionId ?? null, startAt, endAt, mode: i.mode, reason: i.reason.trim() },
  });
  const to = await approversFor(ctx.tenantId, e.id);
  await notify({ tenantId: ctx.tenantId, userIds: to, type: 'attendance.correction', title: `Attendance correction from ${e.firstName} ${e.lastName}`, body: `${i.date}: ${i.reason.slice(0, 80)}`, link: '/approvals' });
  return c;
}

export async function listCorrections(ctx: Ctx, q: { status?: string; mine?: boolean }) {
  if (q.mine) {
    return db.attendanceCorrection.findMany({ where: { tenantId: ctx.tenantId, employeeId: ctx.employeeId ?? '__' }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  assertCan(ctx, 'attendance.correct');
  const scope = await employeeScope(ctx);
  const rows = await db.attendanceCorrection.findMany({
    where: { tenantId: ctx.tenantId, status: (q.status as never) ?? 'PENDING', employee: scope },
    include: { employee: { select: { id: true, empNo: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  return rows.map((r) => ({ ...r, date: fromDbDate(r.date) }));
}

export async function decideCorrection(ctx: Ctx, id: string, approve: boolean, note?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'attendance.correct');
  const c = await db.attendanceCorrection.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw notFound('Correction');
  if (c.status !== 'PENDING') throw badRequest('This request is already decided.');
  await assertEmployeeInScope(ctx, c.employeeId);
  assertNotSelf(ctx, c.employeeId);
  const date = fromDbDate(c.date);
  if (approve) {
    await assertPeriodOpen(ctx.tenantId, date);
    // the correction replaces the session it names (if any); otherwise it adds one
    await db.$transaction(async (tx) => {
      if (c.sessionId) {
        const old = await tx.attendanceSession.findFirst({ where: { id: c.sessionId, tenantId: ctx.tenantId, employeeId: c.employeeId } });
        if (old) {
          await tx.attendanceSession.deleteMany({ where: { OR: [{ id: old.id }, { splitFromId: old.id }] } });
          await writeAudit(tx, ctx, 'attendance.replace', 'AttendanceSession', old.id, old, null);
        }
      }
      const clash = await tx.attendanceSession.findFirst({ where: { tenantId: ctx.tenantId, employeeId: c.employeeId, startAt: { lt: c.endAt }, OR: [{ endAt: null }, { endAt: { gt: c.startAt } }] } });
      if (clash) throw badRequest('This overlaps an existing session. Edit the sessions for that day instead.');
      const s = await tx.attendanceSession.create({ data: { tenantId: ctx.tenantId, employeeId: c.employeeId, date: c.date, startAt: c.startAt, mode: c.mode, source: 'MANUAL', flags: ['CORRECTED'] } });
      await closeSession(tx, { ...s }, c.endAt, {}, 'CORRECTION');
      await tx.attendanceCorrection.update({ where: { id }, data: { status: 'APPROVED', decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null } });
      await writeAudit(tx, ctx, 'attendance.correction.approve', 'AttendanceCorrection', id, null, { sessionId: s.id });
    });
    for (let d = date; d <= colomboDate(c.endAt) && d < colomboDate(new Date()); d = addDays(d, 1)) await closeEmployeeDay(ctx.tenantId, c.employeeId, d);
  } else {
    if (!note || note.trim().length < 3) throw badRequest('Write a short reason for rejecting.');
    await db.attendanceCorrection.update({ where: { id }, data: { status: 'REJECTED', decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    await writeAudit(db, ctx, 'attendance.correction.reject', 'AttendanceCorrection', id, null, { note });
  }
  const uid = await userIdForEmployee(c.employeeId);
  if (uid) await notify({ tenantId: ctx.tenantId, userIds: [uid], type: 'attendance.correction.decided', title: `Your correction for ${date} was ${approve ? 'approved' : 'rejected'}`, body: note ?? undefined, link: '/attendance' });
  return { ok: true };
}

// ─── Terminals (fingerprint / face devices) ────────────────────

/** A terminal sends punches keyed by employee number. Each punch toggles in/out. */
export async function terminalPunches(terminal: { id: string; tenantId: string; branchId: string | null }, punches: { clientId: string; empNo: string; occurredAt: Date }[]) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: terminal.tenantId }, include: { plan: true } });
  if (!tenant.plan.features.includes('terminals')) throw forbidden('Terminals are not in this plan.');
  const out: PunchOutcome[] = [];
  const sorted = [...punches].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const p of sorted) {
    const cid = `T:${terminal.id}:${p.clientId}`;
    const dup = await db.punchEvent.findUnique({ where: { tenantId_clientId: { tenantId: tenant.id, clientId: cid } } });
    if (dup) {
      out.push({ clientId: p.clientId, result: 'DUPLICATE' });
      continue;
    }
    const e = await db.employee.findFirst({ where: { tenantId: tenant.id, empNo: p.empNo, status: 'ACTIVE' } });
    if (!e) {
      out.push({ clientId: p.clientId, result: 'REJECTED', reason: `Unknown employee number ${p.empNo}` });
      continue;
    }
    const open = await db.attendanceSession.findFirst({ where: { tenantId: tenant.id, employeeId: e.id, endAt: null }, orderBy: { startAt: 'desc' } });
    // ignore a double scan within 2 minutes
    if (open && p.occurredAt.getTime() - open.startAt.getTime() < 120_000) {
      await db.punchEvent.create({ data: { tenantId: tenant.id, employeeId: e.id, clientId: cid, kind: 'OUT', source: 'TERMINAL', occurredAt: p.occurredAt, terminalId: terminal.id, result: 'DUPLICATE', reason: 'Double scan' } });
      out.push({ clientId: p.clientId, result: 'DUPLICATE', reason: 'Double scan' });
      continue;
    }
    const kind = open ? 'OUT' : 'IN';
    const date = colomboDate(p.occurredAt);
    const r = await db.$transaction(async (tx) => {
      let sessionId: string;
      let dates: string[] = [];
      if (!open) {
        const s = await tx.attendanceSession.create({ data: { tenantId: tenant.id, employeeId: e.id, date: dbDate(date), startAt: p.occurredAt, mode: 'OFFICE', source: 'TERMINAL', branchId: terminal.branchId ?? e.branchId } });
        sessionId = s.id;
      } else {
        if (p.occurredAt <= open.startAt) throw badRequest('Out of order');
        dates = await closeSession(tx, { ...open }, p.occurredAt, {}, 'USER');
        sessionId = open.id;
      }
      await tx.punchEvent.create({ data: { tenantId: tenant.id, employeeId: e.id, clientId: cid, kind, source: 'TERMINAL', occurredAt: p.occurredAt, terminalId: terminal.id, sessionId, result: 'ACCEPTED' } });
      return { sessionId, dates };
    }).catch((err: Error) => ({ error: err.message }));
    if ('error' in r) out.push({ clientId: p.clientId, result: 'REJECTED', reason: r.error });
    else {
      out.push({ clientId: p.clientId, result: 'ACCEPTED', sessionId: r.sessionId });
      for (const d of r.dates) if (d < colomboDate(new Date())) await closeEmployeeDay(tenant.id, e.id, d).catch(() => undefined);
    }
  }
  await db.terminal.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } });
  return out;
}

export { readSettings };
