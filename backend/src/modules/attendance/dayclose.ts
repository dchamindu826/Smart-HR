/**
 * Day close. Runs after 00:00 Asia/Colombo for the day that ended (and again
 * whenever a correction touches a past day). Safe to run any number of times.
 *
 *  1. A session still open from that day: a night shift continues (it is split
 *     at midnight); a forgotten mark-out is closed at the rostered end (or after
 *     a normal day) and flagged MISSING_MARK_OUT.
 *  2. AttendanceDay is written from the sessions, the published roster, leave
 *     and the holiday calendar (rules/attendance.ts computeDay).
 *  3. Overtime claims: PLANNED is approved with the roster; UNROSTERED waits for
 *     the employee's reason. Decided claims are never changed.
 */

import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { readSettings, attendanceRules, rosterRules } from '../../core/settings.js';
import { notify, userIdForEmployee } from '../../core/notify.js';
import { computeDay, mergeTouching, toBlock, type Block } from '../../rules/attendance.js';
import { addDays, colomboInstant, colomboMidnightAfter, dbDate, fromDbDate, minutesBetween } from '../../lib/time.js';
import { publishedRosterDays } from '../roster/service.js';
import { holidayMap } from '../holidays/service.js';
import { invalidateRuns } from '../payroll/invalidate.js';

async function tenantContext(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true, plan: { select: { features: true } } } });
  const s = readSettings(t.settings);
  return { s, rules: attendanceRules(s), rRules: rosterRules(s), usesOvertime: true };
}

/** Close forgotten sessions that began on `date`. */
export async function autoCloseOpen(tenantId: string, date: string) {
  const { s, rRules } = await tenantContext(tenantId);
  const open = await db.attendanceSession.findMany({ where: { tenantId, date: dbDate(date), endAt: null } });
  if (!open.length) return 0;
  const ids = [...new Set(open.map((o) => o.employeeId))];
  const roster = await publishedRosterDays(tenantId, ids, date, addDays(date, 1), rRules);
  const midnight = colomboMidnightAfter(date);
  let n = 0;
  for (const o of open) {
    const today = roster.get(`${o.employeeId}|${date}`);
    const next = roster.get(`${o.employeeId}|${addDays(date, 1)}`);
    const nightShift = !!today?.segments.some((x) => x.end === 1440) && !!next?.segments.some((x) => x.start === 0);
    await db.$transaction(async (tx) => {
      if (nightShift) {
        // legitimate night shift: cut at midnight, continue on the next date
        await tx.attendanceSession.update({ where: { id: o.id }, data: { endAt: midnight, minutes: minutesBetween(o.startAt, midnight), closedBy: 'DAY_CLOSE' } });
        await tx.attendanceSession.create({
          data: { tenantId, employeeId: o.employeeId, date: dbDate(addDays(date, 1)), startAt: midnight, mode: o.mode, source: o.source, branchId: o.branchId, flags: o.flags, splitFromId: o.id },
        });
      } else {
        // forgotten mark-out: end at the rostered end, else after a normal day + meal
        let end: Date;
        const rEnd = today && today.segments.length ? Math.max(...today.segments.map((x) => x.end)) : null;
        const rEndAt = rEnd !== null ? colomboInstant(date, rEnd) : null;
        if (rEndAt && rEndAt > o.startAt) end = rEndAt;
        else end = new Date(o.startAt.getTime() + (s.normalDayMinutes + s.mealMinutes) * 60_000);
        if (end > midnight) end = midnight;
        await tx.attendanceSession.update({
          where: { id: o.id },
          data: { endAt: end, minutes: minutesBetween(o.startAt, end), closedBy: 'DAY_CLOSE', flags: [...new Set([...o.flags, 'AUTO_CLOSED', 'MISSING_MARK_OUT'])] },
        });
      }
    });
    if (!nightShift) {
      const uid = await userIdForEmployee(o.employeeId);
      if (uid) await notify({ tenantId, userIds: [uid], type: 'attendance.missingOut', title: `You did not mark out on ${date}`, body: 'The system closed your session. Request a correction if the time is wrong.', link: '/attendance' });
    }
    n++;
  }
  return n;
}

/** Recompute one employee's day. */
export async function closeEmployeeDay(tenantId: string, employeeId: string, date: string) {
  const { rules, rRules } = await tenantContext(tenantId);
  const e = await db.employee.findFirst({ where: { id: employeeId, tenantId }, select: { id: true, branchId: true, rosterGroupId: true, joinDate: true, endDate: true, status: true } });
  if (!e) return null;
  return computeAndStore(tenantId, e, date, rules, rRules);
}

/** Recompute every active employee's day for a tenant. */
export async function closeTenantDay(tenantId: string, date: string) {
  await autoCloseOpen(tenantId, date);
  const { rules, rRules } = await tenantContext(tenantId);
  const emps = await db.employee.findMany({
    where: { tenantId, joinDate: { lte: dbDate(date) }, OR: [{ endDate: null }, { endDate: { gte: dbDate(date) } }] },
    select: { id: true, branchId: true, rosterGroupId: true, joinDate: true, endDate: true, status: true },
  });
  let n = 0;
  for (const e of emps) {
    await computeAndStore(tenantId, e, date, rules, rRules);
    n++;
  }
  return n;
}

async function computeAndStore(
  tenantId: string,
  e: { id: string; branchId: string | null; rosterGroupId: string | null; joinDate: Date; endDate: Date | null; status: string },
  date: string,
  rules: ReturnType<typeof attendanceRules>,
  rRules: ReturnType<typeof rosterRules>,
) {
  if (fromDbDate(e.joinDate) > date || (e.endDate && fromDbDate(e.endDate) < date)) return null;
  const [sessions, roster, holidays, leave] = await Promise.all([
    db.attendanceSession.findMany({ where: { tenantId, employeeId: e.id, date: dbDate(date) }, orderBy: { startAt: 'asc' } }),
    publishedRosterDays(tenantId, [e.id], date, date, rRules),
    holidayMap(tenantId, date, date, e.branchId),
    db.leaveRequest.findMany({ where: { tenantId, employeeId: e.id, status: 'APPROVED', fromDate: { lte: dbDate(date) }, toDate: { gte: dbDate(date) } }, include: { leaveType: { select: { paid: true } } } }),
  ]);
  const closed = sessions.filter((s) => s.endAt);
  const blocks: Block[] = closed.map((s) => toBlock(date, s.startAt, s.endAt!));
  const hadOpen = sessions.some((s) => s.flags.includes('MISSING_MARK_OUT') || !s.endAt);
  const r = roster.get(`${e.id}|${date}`);
  const h = holidays.get(date) ?? null;
  const leaveDays = leave.length ? Math.min(1, leave.reduce((a, l) => a + (l.halfDay ? 0.5 : 1), 0)) : 0;

  const result = computeDay(
    {
      date,
      sessions: mergeTouching(blocks),
      hadOpenSession: hadOpen,
      roster: r ? { isOff: r.isOff || r.segments.length === 0, blocks: r.segments, paidMinutes: r.paidMinutes, plannedOtMinutes: r.plannedOtMinutes } : null,
      usesRoster: !!e.rosterGroupId,
      holiday: h ? { multiplier: h.multiplier, isPaidOff: h.isPaidOff } : null,
      leave: leaveDays ? { days: leaveDays } : null,
    },
    rules,
  );

  const data = {
    status: result.status,
    rosteredMinutes: result.rosteredMinutes,
    workedMinutes: result.workedMinutes,
    mealMinutes: result.mealMinutes,
    paidMinutes: result.paidMinutes,
    lateMinutes: result.lateMinutes,
    earlyMinutes: result.earlyMinutes,
    otMinutes: result.plannedOtMinutes + result.unrosteredOtMinutes,
    holidayMinutes: result.holidayMinutes,
    multiplier: String(result.multiplier),
    flags: [...new Set([...result.flags, ...sessions.flatMap((s) => s.flags)])],
    closedAt: new Date(),
  };
  const before = await db.attendanceDay.findUnique({ where: { tenantId_employeeId_date: { tenantId, employeeId: e.id, date: dbDate(date) } } });
  const changed =
    !before || before.status !== data.status || before.paidMinutes !== data.paidMinutes || before.otMinutes !== data.otMinutes || before.holidayMinutes !== data.holidayMinutes;
  if (changed) await invalidateRuns(tenantId, date, `Attendance changed on ${date}`);
  await db.attendanceDay.upsert({
    where: { tenantId_employeeId_date: { tenantId, employeeId: e.id, date: dbDate(date) } },
    create: { tenantId, employeeId: e.id, date: dbDate(date), ...data },
    update: data,
  });

  await upsertClaim(tenantId, e.id, date, 'PLANNED', result.plannedOtMinutes);
  const created = await upsertClaim(tenantId, e.id, date, 'UNROSTERED', result.unrosteredOtMinutes);
  if (created) {
    const uid = await userIdForEmployee(e.id);
    if (uid) {
      await notify({
        tenantId,
        userIds: [uid],
        type: 'overtime.needsReason',
        title: `Overtime on ${date}: give a reason`,
        body: `${Math.floor(result.unrosteredOtMinutes / 60)} h ${result.unrosteredOtMinutes % 60} min beyond your roster. Add a reason so your manager can approve it.`,
        link: '/overtime',
      });
    }
  }
  return result;
}

/** Returns true when a new UNROSTERED claim was created. */
async function upsertClaim(tenantId: string, employeeId: string, date: string, kind: 'PLANNED' | 'UNROSTERED', minutes: number): Promise<boolean> {
  const where = { tenantId_employeeId_date_kind: { tenantId, employeeId, date: dbDate(date), kind } } as const;
  const existing = await db.overtimeClaim.findUnique({ where });
  if (existing && (existing.status === 'APPROVED' || existing.status === 'REJECTED') && kind === 'UNROSTERED') return false;
  if (minutes <= 0) {
    if (existing && existing.status !== 'APPROVED' && existing.status !== 'REJECTED') await db.overtimeClaim.delete({ where: { id: existing.id } });
    if (existing && kind === 'PLANNED' && existing.status === 'APPROVED' && !existing.payrollRunId) await db.overtimeClaim.delete({ where: { id: existing.id } });
    return false;
  }
  const status = kind === 'PLANNED' ? 'APPROVED' : existing?.status ?? 'NEEDS_REASON';
  const data: Prisma.OvertimeClaimUncheckedCreateInput = { tenantId, employeeId, date: dbDate(date), kind, minutes, status };
  if (existing) {
    if (existing.payrollRunId) {
      const run = await db.payrollRun.findUnique({ where: { id: existing.payrollRunId }, select: { status: true } });
      if (!run || run.status === 'LOCKED') return false; // already paid: corrections go in as arrears
    }
    if (existing.minutes !== minutes || existing.status !== status) await db.overtimeClaim.update({ where: { id: existing.id }, data: { minutes, status } });
    return false;
  }
  await db.overtimeClaim.create({ data });
  return kind === 'UNROSTERED';
}
