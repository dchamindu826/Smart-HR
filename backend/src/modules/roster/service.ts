/**
 * Shift patterns, roster groups and the weekly roster.
 *
 * HR decides who makes the roster: a RosterGroup has members, a maker (any
 * manager or HR user) and an optional approver. The maker drafts each week,
 * submits; HR (or the named approver) approves or returns; then it is published
 * to the employees. A published week is changed only through a new revision.
 */

import type { Prisma, RosterStatus } from '@prisma/client';
import { db, db as rootDb, type Tx } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound, rule } from '../../core/errors.js';
import { assertCan, can } from '../../core/permissions.js';
import { assertWritable, employeeScope, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { hasFeature } from '../../core/features.js';
import { notify, usersWithRoles, userIdForEmployee } from '../../core/notify.js';
import { rosterRules } from '../../core/settings.js';
import { addDays, dbDate, fromDbDate, isoWeekday, weekStart as mondayOf } from '../../lib/time.js';
import { hasErrors, planDay, splitShift, validateWeek, type RosterRules, type RosterSegment, type WeekDayInput } from '../../rules/roster.js';
import { holidayMap } from '../holidays/service.js';

// ─── Shift patterns ────────────────────────────────────────────

export interface PatternInput {
  code: string;
  name: string;
  // blocks as typed: end ≤ start means the block runs past midnight
  blocks: { start: number; end: number }[];
  color?: string;
  active?: boolean;
}

function normaliseBlocks(blocks: { start: number; end: number }[]) {
  if (!blocks.length) throw badRequest('Add at least one time block.');
  const out = blocks.map((b) => {
    if (b.start < 0 || b.start >= 1440 || b.end < 0 || b.end > 1440) throw badRequest('Times must be between 00:00 and 24:00.');
    return { start: b.start, end: b.end > b.start ? b.end : b.end + 1440 };
  });
  out.sort((a, b) => a.start - b.start);
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end) throw badRequest('Time blocks overlap.');
  const total = out.reduce((a, b) => a + (b.end - b.start), 0);
  if (total > 16 * 60) throw badRequest('A shift cannot be longer than 16 hours.');
  return { segments: out, total };
}

export async function listPatterns(ctx: Ctx) {
  return db.shiftPattern.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { employees: true } } } });
}

export async function createPattern(ctx: Ctx, i: PatternInput) {
  assertWritable(ctx);
  assertCan(ctx, 'shift.edit');
  const { segments, total } = normaliseBlocks(i.blocks);
  return db.$transaction(async (tx) => {
    const p = await tx.shiftPattern.create({ data: { tenantId: ctx.tenantId, code: i.code.toUpperCase(), name: i.name, segments, totalMinutes: total, color: i.color ?? '#0B6FD4' } });
    await writeAudit(tx, ctx, 'shift.create', 'ShiftPattern', p.id, null, p);
    return p;
  });
}

export async function updatePattern(ctx: Ctx, id: string, i: Partial<PatternInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'shift.edit');
  const before = await db.shiftPattern.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!before) throw notFound('Shift pattern');
  const seg = i.blocks ? normaliseBlocks(i.blocks) : null;
  return db.$transaction(async (tx) => {
    const p = await tx.shiftPattern.update({
      where: { id },
      data: { code: i.code?.toUpperCase(), name: i.name, color: i.color, active: i.active, ...(seg ? { segments: seg.segments, totalMinutes: seg.total } : {}) },
    });
    await writeAudit(tx, ctx, 'shift.update', 'ShiftPattern', id, before, p);
    return p;
  });
}

export async function deletePattern(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'shift.edit');
  const p = await db.shiftPattern.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { employees: true, rosterDays: true } } } });
  if (!p) throw notFound('Shift pattern');
  if (p._count.employees + p._count.rosterDays > 0) throw conflict('This shift is used by employees or rosters. Make it inactive instead.');
  await db.shiftPattern.delete({ where: { id } });
  await writeAudit(db, ctx, 'shift.delete', 'ShiftPattern', id, p, null);
}

// ─── Roster groups ─────────────────────────────────────────────

export interface GroupInput {
  name: string;
  makerId: string; // user id
  approverId?: string | null;
  memberIds: string[]; // employee ids
  active?: boolean;
}

async function checkGroup(ctx: Ctx, i: Partial<GroupInput>) {
  if (i.makerId) {
    const m = await db.user.findFirst({ where: { id: i.makerId, tenantId: ctx.tenantId, active: true } });
    if (!m) throw badRequest('Unknown roster maker.');
    if (m.role === 'EMPLOYEE') throw badRequest('The roster maker must be a manager or HR user. Change their role in Roles & users first.');
  }
  if (i.approverId) {
    const a = await db.user.findFirst({ where: { id: i.approverId, tenantId: ctx.tenantId, active: true } });
    if (!a || !['OWNER', 'HR_MANAGER', 'HR_OFFICER'].includes(a.role)) throw badRequest('The approver must be an owner or HR user.');
  }
  if (i.memberIds?.length) {
    const n = await db.employee.count({ where: { tenantId: ctx.tenantId, id: { in: i.memberIds } } });
    if (n !== new Set(i.memberIds).size) throw badRequest('Unknown employee in the member list.');
  }
}

export async function listGroups(ctx: Ctx) {
  requireFeature(ctx, 'roster');
  const where: Prisma.RosterGroupWhereInput = { tenantId: ctx.tenantId };
  if (!can(ctx, 'roster.groups') && !can(ctx, 'roster.approve')) where.OR = [{ makerId: ctx.userId }, { approverId: ctx.userId }];
  const groups = await db.rosterGroup.findMany({
    where,
    include: {
      maker: { select: { id: true, name: true, role: true } },
      approver: { select: { id: true, name: true } },
      members: { where: { status: 'ACTIVE' }, select: { id: true, empNo: true, firstName: true, lastName: true, designation: true }, orderBy: { firstName: 'asc' } },
      weeks: { orderBy: [{ weekStart: 'desc' }, { revision: 'desc' }], take: 3, select: { id: true, weekStart: true, status: true, revision: true } },
    },
    orderBy: { name: 'asc' },
  });
  return groups.map((g) => ({ ...g, weeks: g.weeks.map((w) => ({ ...w, weekStart: fromDbDate(w.weekStart) })) }));
}

export async function createGroup(ctx: Ctx, i: GroupInput) {
  assertWritable(ctx);
  assertCan(ctx, 'roster.groups');
  requireFeature(ctx, 'roster');
  await checkGroup(ctx, i);
  return db.$transaction(async (tx) => {
    const g = await tx.rosterGroup.create({ data: { tenantId: ctx.tenantId, name: i.name, makerId: i.makerId, approverId: i.approverId ?? null } });
    if (i.memberIds.length) await tx.employee.updateMany({ where: { tenantId: ctx.tenantId, id: { in: i.memberIds } }, data: { rosterGroupId: g.id } });
    await writeAudit(tx, ctx, 'roster.group.create', 'RosterGroup', g.id, null, i);
    return g;
  });
}

export async function updateGroup(ctx: Ctx, id: string, i: Partial<GroupInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'roster.groups');
  const g = await db.rosterGroup.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!g) throw notFound('Roster group');
  await checkGroup(ctx, i);
  return db.$transaction(async (tx) => {
    const n = await tx.rosterGroup.update({ where: { id }, data: { name: i.name, makerId: i.makerId, approverId: i.approverId, active: i.active } });
    if (i.memberIds) {
      await tx.employee.updateMany({ where: { tenantId: ctx.tenantId, rosterGroupId: id, id: { notIn: i.memberIds } }, data: { rosterGroupId: null } });
      await tx.employee.updateMany({ where: { tenantId: ctx.tenantId, id: { in: i.memberIds } }, data: { rosterGroupId: id } });
    }
    await writeAudit(tx, ctx, 'roster.group.update', 'RosterGroup', id, { name: g.name, makerId: g.makerId, approverId: g.approverId }, i);
    return n;
  });
}

export async function deleteGroup(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'roster.groups');
  const g = await db.rosterGroup.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { weeks: true } } } });
  if (!g) throw notFound('Roster group');
  if (g._count.weeks > 0) {
    await db.rosterGroup.update({ where: { id }, data: { active: false } });
    await db.employee.updateMany({ where: { rosterGroupId: id }, data: { rosterGroupId: null } });
  } else {
    await db.employee.updateMany({ where: { rosterGroupId: id }, data: { rosterGroupId: null } });
    await db.rosterGroup.delete({ where: { id } });
  }
  await writeAudit(db, ctx, 'roster.group.delete', 'RosterGroup', id, g, null);
}

// ─── Weekly roster ─────────────────────────────────────────────

type Access = { canView: boolean; canEdit: boolean; canApprove: boolean };

async function officerSeesGroup(ctx: Ctx, groupId: string) {
  const scope = await employeeScope(ctx);
  return (await db.employee.count({ where: { AND: [scope, { rosterGroupId: groupId }] } })) > 0;
}

async function groupAccess(ctx: Ctx, groupId: string) {
  requireFeature(ctx, 'roster');
  const g = await db.rosterGroup.findFirst({ where: { id: groupId, tenantId: ctx.tenantId }, include: { maker: { select: { id: true, name: true } } } });
  if (!g) throw notFound('Roster group');
  const hr = ctx.role === 'OWNER' || ctx.role === 'HR_MANAGER';
  const access: Access = {
    canView: hr || (ctx.role === 'HR_OFFICER' && (await officerSeesGroup(ctx, g.id))) || g.makerId === ctx.userId || g.approverId === ctx.userId || !!ctx.support,
    canEdit: !ctx.support && (g.makerId === ctx.userId || hr),
    canApprove: !ctx.support && (g.approverId ? g.approverId === ctx.userId || hr : hr),
  };
  if (!access.canView) throw forbidden('You do not make or approve this roster.');
  return { g, access };
}

async function latestWeek(tenantId: string, groupId: string, weekStart: string) {
  return db.rosterWeek.findFirst({ where: { tenantId, groupId, weekStart: dbDate(weekStart) }, orderBy: { revision: 'desc' } });
}

function assertMonday(d: string) {
  if (isoWeekday(d) !== 1) throw badRequest('A roster week starts on Monday.');
}

export async function getWeek(ctx: Ctx, groupId: string, weekStart: string) {
  assertMonday(weekStart);
  const { g, access } = await groupAccess(ctx, groupId);
  const weekEnd = addDays(weekStart, 6);
  const week = await latestWeek(ctx.tenantId, groupId, weekStart);
  const members = await db.employee.findMany({
    where: { tenantId: ctx.tenantId, rosterGroupId: groupId, status: 'ACTIVE' },
    select: { id: true, empNo: true, firstName: true, lastName: true, designation: true, branchId: true, defaultShiftPatternId: true },
    orderBy: { firstName: 'asc' },
  });
  const days = week ? await db.rosterDay.findMany({ where: { weekId: week.id }, orderBy: [{ date: 'asc' }] }) : [];
  const holidays = await holidayMap(ctx.tenantId, weekStart, weekEnd);
  const ids = members.map((m) => m.id);
  const [leave, approvedOt, published] = await Promise.all([
    db.leaveRequest.findMany({
      where: { tenantId: ctx.tenantId, employeeId: { in: ids }, status: { in: ['APPROVED', 'PENDING'] }, fromDate: { lte: dbDate(weekEnd) }, toDate: { gte: dbDate(weekStart) } },
      select: { employeeId: true, fromDate: true, toDate: true, status: true, halfDay: true, leaveType: { select: { name: true, color: true } } },
    }),
    approvedUnrosteredOt(ctx.tenantId, ids, weekStart),
    week && week.status !== 'PUBLISHED' ? db.rosterWeek.findFirst({ where: { tenantId: ctx.tenantId, groupId, weekStart: dbDate(weekStart), status: 'PUBLISHED' }, orderBy: { revision: 'desc' }, select: { revision: true } }) : null,
  ]);
  const check = validateWeek(
    weekStart,
    // a Sunday night shift's after-midnight part is stored with next Monday; it is checked in that week
    toInputs(days.filter((d) => fromDbDate(d.date) <= weekEnd), members),
    rosterRules(ctx.settings),
    approvedOt,
    Object.fromEntries([...holidays].map(([d, h]) => [d, h.name])),
  );
  return {
    group: { id: g.id, name: g.name, maker: g.maker, approverId: g.approverId },
    access,
    weekStart,
    week: week ? { ...week, weekStart: fromDbDate(week.weekStart) } : null,
    publishedRevision: published?.revision ?? (week?.status === 'PUBLISHED' ? week.revision : null),
    members,
    days: days.map((d) => ({ ...d, date: fromDbDate(d.date) })),
    holidays: Object.fromEntries(holidays),
    leave: leave.map((l) => ({ ...l, fromDate: fromDbDate(l.fromDate), toDate: fromDbDate(l.toDate) })),
    approvedOt,
    check,
  };
}

function toInputs(days: { employeeId: string; date: Date; isOff: boolean; segments: unknown }[], members: { id: string; firstName: string; lastName: string }[]): WeekDayInput[] {
  const names = new Map(members.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
  return days
    .filter((d) => names.has(d.employeeId))
    .map((d) => ({ employeeId: d.employeeId, employeeName: names.get(d.employeeId), date: fromDbDate(d.date), isOff: d.isOff, segments: (d.segments as RosterSegment[]) ?? [] }));
}

export async function approvedUnrosteredOt(tenantId: string, employeeIds: string[], weekStart: string): Promise<Record<string, number>> {
  if (!employeeIds.length) return {};
  const rows = await db.overtimeClaim.groupBy({
    by: ['employeeId'],
    where: { tenantId, employeeId: { in: employeeIds }, kind: 'UNROSTERED', status: 'APPROVED', date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) } },
    _sum: { minutes: true },
  });
  return Object.fromEntries(rows.map((r) => [r.employeeId, r._sum.minutes ?? 0]));
}

export interface DayEdit {
  employeeId: string;
  date: string;
  isOff?: boolean;
  shiftPatternId?: string | null;
  // as typed by the maker; end ≤ start means past midnight
  blocks?: { start: number; end: number; mode?: 'OFFICE' | 'REMOTE' }[];
  note?: string | null;
}

/** Get the week the maker may write to: DRAFT/RETURNED as is, PUBLISHED/APPROVED → new revision. */
async function writableWeek(ctx: Ctx, groupId: string, weekStart: string, db: Tx | typeof rootDb = rootDb) {
  const w = await latestWeek(ctx.tenantId, groupId, weekStart);
  if (!w) return db.rosterWeek.create({ data: { tenantId: ctx.tenantId, groupId, weekStart: dbDate(weekStart), preparedById: ctx.userId } });
  if (w.status === 'DRAFT' || w.status === 'RETURNED') return w;
  if (w.status === 'SUBMITTED') throw conflict('This week is waiting for approval. Withdraw it before making changes.');
  // APPROVED or PUBLISHED → start a new revision with the same days
  const next = await db.rosterWeek.create({ data: { tenantId: ctx.tenantId, groupId, weekStart: w.weekStart, revision: w.revision + 1, preparedById: ctx.userId } });
  const days = await db.rosterDay.findMany({ where: { weekId: w.id } });
  if (days.length) {
    await db.rosterDay.createMany({
      data: days.map((d) => ({ tenantId: d.tenantId, weekId: next.id, employeeId: d.employeeId, date: d.date, shiftPatternId: d.shiftPatternId, segments: d.segments as Prisma.InputJsonValue, isOff: d.isOff, totalMinutes: d.totalMinutes, paidMinutes: d.paidMinutes, plannedOtMinutes: d.plannedOtMinutes, note: d.note })),
    });
  }
  return next;
}

export async function saveDays(ctx: Ctx, groupId: string, weekStart: string, edits: DayEdit[]) {
  assertWritable(ctx);
  assertMonday(weekStart);
  const { access } = await groupAccess(ctx, groupId);
  if (!access.canEdit) throw forbidden('Only the roster maker or HR can change this roster.');
  const weekEnd = addDays(weekStart, 6);
  const members = new Set((await db.employee.findMany({ where: { tenantId: ctx.tenantId, rosterGroupId: groupId }, select: { id: true } })).map((m) => m.id));
  const patterns = new Map((await db.shiftPattern.findMany({ where: { tenantId: ctx.tenantId } })).map((p) => [p.id, p]));
  const rules = rosterRules(ctx.settings);

  // Build the per-date segments for every edited cell, moving night parts to the next date.
  type Cell = { employeeId: string; date: string; isOff: boolean; patternId: string | null; segments: RosterSegment[]; note: string | null };
  const key = (e: string, d: string) => `${e}|${d}`;
  const cells = new Map<string, Cell>();
  const carry: { employeeId: string; date: string; segment: RosterSegment }[] = [];
  for (const e of edits) {
    if (!members.has(e.employeeId)) throw badRequest('That employee is not in this roster group.');
    if (e.date < weekStart || e.date > weekEnd) throw badRequest(`${e.date} is not in this week.`);
    let segs: { date: string; segment: RosterSegment }[] = [];
    if (!e.isOff) {
      if (e.shiftPatternId) {
        const p = patterns.get(e.shiftPatternId);
        if (!p) throw badRequest('Unknown shift pattern.');
        segs = (p.segments as { start: number; end: number }[]).flatMap((x) => splitShift(e.date, x.start, x.end % 1440, 'OFFICE'));
      } else if (e.blocks?.length) {
        segs = e.blocks.flatMap((b) => splitShift(e.date, b.start, b.end, b.mode ?? 'OFFICE'));
      }
    }
    const own = segs.filter((x) => x.date === e.date).map((x) => x.segment);
    cells.set(key(e.employeeId, e.date), {
      employeeId: e.employeeId,
      date: e.date,
      isOff: own.length === 0,
      patternId: own.length ? e.shiftPatternId ?? null : null,
      segments: own,
      note: e.note ?? null,
    });
    for (const x of segs) if (x.date !== e.date) carry.push({ employeeId: e.employeeId, ...x });
  }

  return db.$transaction(async (tx) => {
    const week = await writableWeek(ctx, groupId, weekStart, tx);
    const existing = await tx.rosterDay.findMany({ where: { weekId: week.id } });
    const byKey = new Map(existing.map((d) => [key(d.employeeId, fromDbDate(d.date)), d]));
    const segsOf = (d: { segments: unknown } | undefined) => ((d?.segments as RosterSegment[] | undefined) ?? []);

    // An edited cell that used to run past midnight leaves an old night part on the
    // next date; remove it (blocks starting at 00:00) unless that date is edited too.
    for (const c of [...cells.values()]) {
      const prior = byKey.get(key(c.employeeId, c.date));
      if (!segsOf(prior).some((x) => x.end === 1440)) continue;
      const next = addDays(c.date, 1);
      const nk = key(c.employeeId, next);
      if (cells.has(nk)) continue;
      const nrow = byKey.get(nk);
      if (!nrow) continue;
      const kept = segsOf(nrow).filter((x) => x.start !== 0);
      cells.set(nk, { employeeId: c.employeeId, date: next, isOff: kept.length === 0, patternId: nrow.shiftPatternId, segments: kept, note: nrow.note });
    }
    // add the new night parts to the next date (may be next Monday)
    for (const c of carry) {
      const k = key(c.employeeId, c.date);
      let cell = cells.get(k);
      if (!cell) {
        const prior = byKey.get(k);
        cell = { employeeId: c.employeeId, date: c.date, isOff: false, patternId: prior?.shiftPatternId ?? null, segments: segsOf(prior).filter((x) => x.start !== 0), note: prior?.note ?? null };
        cells.set(k, cell);
      }
      cell.segments.push(c.segment);
      cell.isOff = false;
    }
    for (const c of cells.values()) {
      const plan = c.isOff ? { totalMinutes: 0, paidMinutes: 0, plannedOtMinutes: 0 } : planDay(c.segments, rules);
      const data = {
        tenantId: ctx.tenantId, weekId: week.id, employeeId: c.employeeId, date: dbDate(c.date), shiftPatternId: c.patternId,
        segments: c.segments as unknown as Prisma.InputJsonValue, isOff: c.isOff,
        totalMinutes: plan.totalMinutes, paidMinutes: plan.paidMinutes, plannedOtMinutes: plan.plannedOtMinutes, note: c.note,
      };
      const prev = byKey.get(key(c.employeeId, c.date));
      if (prev) await tx.rosterDay.update({ where: { id: prev.id }, data });
      else await tx.rosterDay.create({ data });
    }
    if (week.status === 'RETURNED') await tx.rosterWeek.update({ where: { id: week.id }, data: { status: 'DRAFT' } });
    await writeAudit(tx, ctx, 'roster.save', 'RosterWeek', week.id, null, { cells: cells.size });
    return { weekId: week.id };
  });
}

/** Fill empty cells from each member's default shift on working days; other days off. */
export async function fillDefaults(ctx: Ctx, groupId: string, weekStart: string) {
  assertMonday(weekStart);
  const members = await db.employee.findMany({ where: { tenantId: ctx.tenantId, rosterGroupId: groupId, status: 'ACTIVE' }, select: { id: true, defaultShiftPatternId: true } });
  const fallback = await db.shiftPattern.findFirst({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { createdAt: 'asc' } });
  const week = await latestWeek(ctx.tenantId, groupId, weekStart);
  const have = new Set(week ? (await db.rosterDay.findMany({ where: { weekId: week.id }, select: { employeeId: true, date: true } })).map((d) => `${d.employeeId}|${fromDbDate(d.date)}`) : []);
  const edits: DayEdit[] = [];
  for (const m of members) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      if (have.has(`${m.id}|${date}`)) continue;
      const working = (ctx.settings.workWeek[i] ?? 0) > 0;
      const pid = m.defaultShiftPatternId ?? fallback?.id ?? null;
      edits.push(working && pid ? { employeeId: m.id, date, shiftPatternId: pid } : { employeeId: m.id, date, isOff: true });
    }
  }
  if (!edits.length) return { filled: 0 };
  await saveDays(ctx, groupId, weekStart, edits);
  return { filled: edits.length };
}

export async function copyPreviousWeek(ctx: Ctx, groupId: string, weekStart: string) {
  assertMonday(weekStart);
  const prevStart = addDays(weekStart, -7);
  const prev = await db.rosterWeek.findFirst({ where: { tenantId: ctx.tenantId, groupId, weekStart: dbDate(prevStart) }, orderBy: { revision: 'desc' } });
  if (!prev) throw badRequest('There is no roster for the previous week.');
  const days = await db.rosterDay.findMany({ where: { weekId: prev.id, date: { lte: dbDate(addDays(prevStart, 6)) } } });
  const byKey = new Map(days.map((d) => [`${d.employeeId}|${fromDbDate(d.date)}`, d]));
  const edits: DayEdit[] = [];
  for (const d of days) {
    const date = fromDbDate(d.date);
    const segs = (d.segments as unknown as RosterSegment[]) ?? [];
    const prevDay = byKey.get(`${d.employeeId}|${addDays(date, -1)}`);
    const prevRunsPastMidnight = ((prevDay?.segments as unknown as RosterSegment[] | undefined) ?? []).some((x) => x.end === 1440);
    // blocks carried in from the previous night are rebuilt by saveDays, so drop them here
    const ownSegs = prevRunsPastMidnight ? segs.filter((x) => x.start !== 0) : segs;
    const target = addDays(date, 7);
    if (d.shiftPatternId) edits.push({ employeeId: d.employeeId, date: target, shiftPatternId: d.shiftPatternId, note: d.note });
    else if (d.isOff || ownSegs.length === 0) edits.push({ employeeId: d.employeeId, date: target, isOff: true, note: d.note });
    else edits.push({ employeeId: d.employeeId, date: target, blocks: ownSegs.map((x) => ({ start: x.start, end: x.end === 1440 ? 0 : x.end, mode: x.mode })), note: d.note });
  }
  await saveDays(ctx, groupId, weekStart, edits);
  return { copied: edits.length };
}

async function transition(ctx: Ctx, groupId: string, weekStart: string, from: RosterStatus[], to: RosterStatus, extra: Prisma.RosterWeekUpdateInput = {}) {
  const w = await latestWeek(ctx.tenantId, groupId, weekStart);
  if (!w) throw notFound('Roster week');
  if (!from.includes(w.status)) throw conflict(`This week is ${w.status.toLowerCase()}; it cannot be moved to ${to.toLowerCase()}.`);
  const n = await db.rosterWeek.update({ where: { id: w.id }, data: { status: to, ...extra } });
  await writeAudit(db, ctx, `roster.${to.toLowerCase()}`, 'RosterWeek', w.id, { status: w.status }, { status: to, note: extra.note });
  return n;
}

export async function submitWeek(ctx: Ctx, groupId: string, weekStart: string) {
  assertWritable(ctx);
  const data = await getWeek(ctx, groupId, weekStart);
  if (!data.access.canEdit) throw forbidden('Only the roster maker can submit this week.');
  if (!data.week || data.days.length === 0) throw badRequest('The week is empty.');
  const missing = data.members.filter((m) => !data.days.some((d) => d.employeeId === m.id));
  if (missing.length) throw rule(`Fill the week for: ${missing.map((m) => `${m.firstName} ${m.lastName}`).join(', ')}.`);
  if (hasErrors(data.check)) throw rule('Fix the problems shown in red before submitting.', data.check.issues.filter((i) => i.level === 'error'));
  const needApproval = ctx.settings.rosterRequiresApproval && !(ctx.role === 'OWNER' || ctx.role === 'HR_MANAGER');
  const w = await transition(ctx, groupId, weekStart, ['DRAFT', 'RETURNED'], needApproval ? 'SUBMITTED' : 'APPROVED', {
    submittedAt: new Date(),
    ...(needApproval ? {} : { decidedById: ctx.userId, decidedAt: new Date() }),
  });
  if (needApproval) {
    const to = data.group.approverId ? [data.group.approverId] : await usersWithRoles(ctx.tenantId, ['HR_MANAGER', 'OWNER']);
    await notify({ tenantId: ctx.tenantId, userIds: to, type: 'roster.submitted', title: `Roster to approve: ${data.group.name}`, body: `Week of ${weekStart}, from ${ctx.name}.`, link: `/roster?group=${groupId}&week=${weekStart}` });
  }
  return w;
}

export async function withdrawWeek(ctx: Ctx, groupId: string, weekStart: string) {
  assertWritable(ctx);
  const { access } = await groupAccess(ctx, groupId);
  if (!access.canEdit) throw forbidden();
  return transition(ctx, groupId, weekStart, ['SUBMITTED'], 'DRAFT');
}

export async function decideWeek(ctx: Ctx, groupId: string, weekStart: string, approve: boolean, note?: string | null) {
  assertWritable(ctx);
  const { g, access } = await groupAccess(ctx, groupId);
  if (!access.canApprove) throw forbidden('You cannot approve this roster.');
  if (approve) {
    const data = await getWeek(ctx, groupId, weekStart);
    if (hasErrors(data.check)) throw rule('This roster breaks a rule and cannot be approved. Return it to the maker.', data.check.issues.filter((i) => i.level === 'error'));
  } else if (!note || note.trim().length < 5) throw badRequest('Write what needs to change (5+ characters).');
  const w = await transition(ctx, groupId, weekStart, ['SUBMITTED'], approve ? 'APPROVED' : 'RETURNED', { decidedById: ctx.userId, decidedAt: new Date(), note: note ?? null });
  await notify({
    tenantId: ctx.tenantId,
    userIds: [g.makerId],
    type: approve ? 'roster.approved' : 'roster.returned',
    title: approve ? `Roster approved: ${g.name}` : `Roster returned: ${g.name}`,
    body: approve ? `Week of ${weekStart}. You can publish it now.` : note ?? '',
    link: `/roster?group=${groupId}&week=${weekStart}`,
  });
  return w;
}

export async function publishWeek(ctx: Ctx, groupId: string, weekStart: string) {
  assertWritable(ctx);
  const { g, access } = await groupAccess(ctx, groupId);
  if (!access.canEdit && !access.canApprove) throw forbidden();
  const w = await transition(ctx, groupId, weekStart, ['APPROVED'], 'PUBLISHED', { publishedAt: new Date() });
  const days = await db.rosterDay.findMany({ where: { weekId: w.id }, select: { employeeId: true } });
  const userIds = (await Promise.all([...new Set(days.map((d) => d.employeeId))].map(userIdForEmployee))).filter((x): x is string => !!x);
  await notify({ tenantId: ctx.tenantId, userIds, type: 'roster.published', title: w.revision > 1 ? 'Your roster was updated' : 'Your roster is ready', body: `Week of ${weekStart} (${g.name}).`, link: '/roster' });
  return w;
}

/** Weeks waiting for this user to approve. */
export async function pendingForMe(ctx: Ctx) {
  if (!hasFeature(ctx.features, 'roster')) return [];
  const hr = ctx.role === 'OWNER' || ctx.role === 'HR_MANAGER';
  const weeks = await db.rosterWeek.findMany({
    where: { tenantId: ctx.tenantId, status: 'SUBMITTED', group: hr ? {} : { approverId: ctx.userId } },
    include: { group: { select: { id: true, name: true, maker: { select: { name: true } }, approverId: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  return weeks.filter((w) => hr || w.group.approverId === ctx.userId).map((w) => ({ ...w, weekStart: fromDbDate(w.weekStart) }));
}

// ─── Reading the published roster ──────────────────────────────

export interface PublishedDay {
  isOff: boolean;
  segments: RosterSegment[];
  paidMinutes: number;
  plannedOtMinutes: number;
  totalMinutes: number;
  shiftPatternId: string | null;
}

/**
 * employeeId|date → the published plan for that date. Uses the highest published
 * revision of each week and merges a night part carried in from the previous week.
 */
export async function publishedRosterDays(
  tenantId: string,
  employeeIds: string[],
  from: string,
  to: string,
  rules: RosterRules = { normalDayMinutes: 480, mealMinutes: 60, mealStart: 720, mealEnd: 780, weeklyOtCapMinutes: 720, maxDayMinutes: 960, minRestMinutes: 0 },
): Promise<Map<string, PublishedDay>> {
  const out = new Map<string, PublishedDay>();
  if (!employeeIds.length) return out;
  const rows = await db.rosterDay.findMany({
    where: { tenantId, employeeId: { in: employeeIds }, date: { gte: dbDate(from), lte: dbDate(to) }, week: { status: 'PUBLISHED' } },
    include: { week: { select: { groupId: true, weekStart: true, revision: true } } },
  });
  // keep only the latest published revision per group+week
  const best = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.week.groupId}|${fromDbDate(r.week.weekStart)}`;
    best.set(k, Math.max(best.get(k) ?? 0, r.week.revision));
  }
  for (const r of rows) {
    if (best.get(`${r.week.groupId}|${fromDbDate(r.week.weekStart)}`) !== r.week.revision) continue;
    const k = `${r.employeeId}|${fromDbDate(r.date)}`;
    const segs = (r.segments as unknown as RosterSegment[]) ?? [];
    const prev = out.get(k);
    if (!prev) {
      out.set(k, { isOff: r.isOff, segments: segs, paidMinutes: r.paidMinutes, plannedOtMinutes: r.plannedOtMinutes, totalMinutes: r.totalMinutes, shiftPatternId: r.shiftPatternId });
    } else {
      const merged = [...prev.segments, ...segs];
      const p = planDay(merged, rules);
      out.set(k, { isOff: prev.isOff && r.isOff, segments: merged, paidMinutes: p.paidMinutes, plannedOtMinutes: p.plannedOtMinutes, totalMinutes: p.totalMinutes, shiftPatternId: prev.shiftPatternId ?? r.shiftPatternId });
    }
  }
  return out;
}

/** The employee's own published roster. */
export async function myRoster(ctx: Ctx, from: string, to: string) {
  if (!ctx.employeeId) return { days: [] };
  const map = await publishedRosterDays(ctx.tenantId, [ctx.employeeId], from, to, rosterRules(ctx.settings));
  const holidays = await holidayMap(ctx.tenantId, from, to);
  const patterns = new Map((await db.shiftPattern.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, color: true } })).map((p) => [p.id, p]));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = map.get(`${ctx.employeeId}|${d}`);
    days.push({
      date: d,
      rostered: !!r,
      isOff: r ? r.isOff || r.segments.length === 0 : null,
      segments: r?.segments ?? [],
      paidMinutes: r?.paidMinutes ?? 0,
      plannedOtMinutes: r?.plannedOtMinutes ?? 0,
      shift: r?.shiftPatternId ? patterns.get(r.shiftPatternId) ?? null : null,
      holiday: holidays.get(d) ?? null,
    });
  }
  return { days };
}

export { mondayOf };
