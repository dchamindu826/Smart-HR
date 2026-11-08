/**
 * Holiday and pay calendar. The Head of HR marks dates and their pay multiplier
 * (Poya 2×, gazetted 2×, company 1.5×, weekly holiday 1.5×, or custom).
 * One function, holidayMap(), is read by roster, day close and payroll.
 */

import type { HolidayKind } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertWritable, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { dbDate, fromDbDate, periodOf } from '../../lib/time.js';

export const DEFAULT_MULTIPLIER: Record<HolidayKind, string> = {
  POYA: '2.00',
  GAZETTED: '2.00',
  COMPANY: '1.50',
  WEEKLY: '1.50',
  CUSTOM: '1.00',
};

export interface HolidayInfo {
  name: string;
  kind: HolidayKind;
  multiplier: number;
  isPaidOff: boolean;
}

/** date → holiday for one branch (a branch-specific date wins over a company-wide one). */
export async function holidayMap(tenantId: string, from: string, to: string, branchId?: string | null): Promise<Map<string, HolidayInfo>> {
  const rows = await db.holidayDate.findMany({
    where: { tenantId, date: { gte: dbDate(from), lte: dbDate(to) }, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
    orderBy: { branchId: 'asc' },
  });
  const map = new Map<string, HolidayInfo>();
  for (const r of rows) {
    const d = fromDbDate(r.date);
    const info = { name: r.name, kind: r.kind, multiplier: Number(r.multiplier.toString()), isPaidOff: r.isPaidOff };
    if (r.branchId || !map.has(d)) map.set(d, info);
  }
  return map;
}

export async function listHolidays(ctx: Ctx, year: number) {
  const rows = await db.holidayDate.findMany({
    where: { tenantId: ctx.tenantId, date: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) } },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({ ...r, date: fromDbDate(r.date), multiplier: r.multiplier.toFixed(2) }));
}

async function assertMonthOpen(tenantId: string, date: string) {
  const run = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period: periodOf(date) } } });
  if (run && run.status === 'LOCKED') throw conflict(`Payroll for ${periodOf(date)} is locked. Holiday dates in a locked month cannot change.`);
}

export interface HolidayInput {
  date: string;
  name: string;
  kind: HolidayKind;
  multiplier?: string;
  isPaidOff?: boolean;
  branchId?: string | null;
}

export async function createHoliday(ctx: Ctx, i: HolidayInput) {
  assertWritable(ctx);
  assertCan(ctx, 'holiday.edit');
  await assertMonthOpen(ctx.tenantId, i.date);
  if (i.branchId && !(await db.branch.findFirst({ where: { id: i.branchId, tenantId: ctx.tenantId } }))) throw badRequest('Unknown branch.');
  const exists = await db.holidayDate.findFirst({ where: { tenantId: ctx.tenantId, date: dbDate(i.date), branchId: i.branchId ?? null } });
  if (exists) throw conflict(`${i.date} is already marked as ${exists.name}.`);
  const mult = i.multiplier ?? DEFAULT_MULTIPLIER[i.kind];
  if (Number(mult) < 1 || Number(mult) > 3) throw badRequest('The multiplier must be between 1.0 and 3.0.');
  return db.$transaction(async (tx) => {
    const h = await tx.holidayDate.create({
      data: { tenantId: ctx.tenantId, date: dbDate(i.date), name: i.name, kind: i.kind, multiplier: mult, isPaidOff: i.isPaidOff ?? i.kind !== 'CUSTOM', branchId: i.branchId ?? null },
    });
    await writeAudit(tx, ctx, 'holiday.create', 'HolidayDate', h.id, null, { ...i, multiplier: mult });
    return h;
  });
}

export async function updateHoliday(ctx: Ctx, id: string, i: Partial<HolidayInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'holiday.edit');
  const h = await db.holidayDate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!h) throw notFound('Holiday');
  await assertMonthOpen(ctx.tenantId, fromDbDate(h.date));
  if (i.date) await assertMonthOpen(ctx.tenantId, i.date);
  if (i.branchId && !(await db.branch.findFirst({ where: { id: i.branchId, tenantId: ctx.tenantId } }))) throw badRequest('Unknown branch.');
  return db.$transaction(async (tx) => {
    const n = await tx.holidayDate.update({
      where: { id },
      data: { name: i.name, kind: i.kind, multiplier: i.multiplier, isPaidOff: i.isPaidOff, branchId: i.branchId, date: i.date ? dbDate(i.date) : undefined },
    });
    await writeAudit(tx, ctx, 'holiday.update', 'HolidayDate', id, { name: h.name, multiplier: h.multiplier.toFixed(2) }, i);
    return n;
  });
}

export async function deleteHoliday(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'holiday.edit');
  const h = await db.holidayDate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!h) throw notFound('Holiday');
  await assertMonthOpen(ctx.tenantId, fromDbDate(h.date));
  await db.$transaction(async (tx) => {
    await tx.holidayDate.delete({ where: { id } });
    await writeAudit(tx, ctx, 'holiday.delete', 'HolidayDate', id, { date: fromDbDate(h.date), name: h.name }, null);
  });
}

/** Copy COMPANY and WEEKLY dates from one year to the next (same day and month). Poya and gazetted dates change every year and are not copied. */
export async function copyYear(ctx: Ctx, fromYear: number, toYear: number) {
  assertWritable(ctx);
  assertCan(ctx, 'holiday.edit');
  const src = await db.holidayDate.findMany({
    where: { tenantId: ctx.tenantId, kind: { in: ['COMPANY', 'WEEKLY'] }, date: { gte: dbDate(`${fromYear}-01-01`), lte: dbDate(`${fromYear}-12-31`) } },
  });
  let created = 0;
  for (const h of src) {
    const md = fromDbDate(h.date).slice(5);
    if (md === '02-29') continue;
    const date = `${toYear}-${md}`;
    const exists = await db.holidayDate.findFirst({ where: { tenantId: ctx.tenantId, date: dbDate(date), branchId: h.branchId } });
    if (exists) continue;
    await db.holidayDate.create({ data: { tenantId: ctx.tenantId, date: dbDate(date), name: h.name, kind: h.kind, multiplier: h.multiplier, isPaidOff: h.isPaidOff, branchId: h.branchId } });
    created++;
  }
  await writeAudit(db, ctx, 'holiday.copyYear', 'HolidayDate', null, null, { fromYear, toYear, created });
  return { created };
}

/** Add many dates at once (e.g. the gazette list typed in by HR). Existing dates are skipped. */
export async function bulkAdd(ctx: Ctx, items: HolidayInput[]) {
  let created = 0;
  const skipped: string[] = [];
  for (const i of items) {
    try {
      await createHoliday(ctx, i);
      created++;
    } catch (e) {
      skipped.push(`${i.date}: ${(e as Error).message}`);
    }
  }
  return { created, skipped };
}
