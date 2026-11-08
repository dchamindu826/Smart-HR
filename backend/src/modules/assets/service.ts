/** Hardware and equipment register, assignment history, and the employee request form. */

import type { AssetStatus, Prisma } from '@prisma/client';
import { db, dec } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertEmployeeInScope, assertWritable, employeeScope, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { notify, usersWithRoles, userIdForEmployee } from '../../core/notify.js';
import { dbDate, fromDbDate } from '../../lib/time.js';

export const CATEGORIES = ['LAPTOP', 'DESKTOP', 'PHONE', 'SIM', 'TABLET', 'VEHICLE', 'UNIFORM', 'TOOL', 'FURNITURE', 'ACCESS_CARD', 'OTHER'] as const;

export interface AssetInput {
  tag?: string;
  name: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  serialNo?: string | null;
  purchaseDate?: string | null;
  cost?: string | null;
  warrantyTo?: string | null;
  condition?: string | null;
  branchId?: string | null;
  notes?: string | null;
  status?: AssetStatus;
}

type HistoryItem = { at: string; action: string; employeeId?: string | null; employeeName?: string | null; by: string; note?: string | null };

function pushHistory(h: Prisma.JsonValue, item: HistoryItem): Prisma.InputJsonValue {
  const arr = Array.isArray(h) ? (h as unknown as HistoryItem[]) : [];
  return [...arr, item].slice(-200) as unknown as Prisma.InputJsonValue;
}

export async function list(ctx: Ctx, q: { status?: string; category?: string; q?: string; assignedToId?: string }) {
  requireFeature(ctx, 'assets');
  assertCan(ctx, 'asset.manage');
  const rows = await db.asset.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(q.status ? { status: q.status as AssetStatus } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.q ? { OR: [{ tag: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { serialNo: { contains: q.q, mode: 'insensitive' } }, { brand: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    include: { assignedTo: { select: { id: true, empNo: true, firstName: true, lastName: true } }, branch: { select: { id: true, name: true } } },
    orderBy: [{ category: 'asc' }, { tag: 'asc' }],
  });
  const counts = await db.asset.groupBy({ by: ['status'], where: { tenantId: ctx.tenantId }, _count: true });
  return {
    rows: rows.map((a) => ({ ...a, cost: dec(a.cost), purchaseDate: a.purchaseDate ? fromDbDate(a.purchaseDate) : null, warrantyTo: a.warrantyTo ? fromDbDate(a.warrantyTo) : null })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

async function nextTag(tenantId: string, category: string) {
  const prefix = category.slice(0, 3).toUpperCase();
  const n = await db.asset.count({ where: { tenantId, tag: { startsWith: prefix + '-' } } });
  return `${prefix}-${String(n + 1).padStart(4, '0')}`;
}

export async function create(ctx: Ctx, i: AssetInput) {
  assertWritable(ctx);
  requireFeature(ctx, 'assets');
  assertCan(ctx, 'asset.manage');
  const tag = i.tag?.trim().toUpperCase() || (await nextTag(ctx.tenantId, i.category));
  const a = await db.asset.create({
    data: {
      tenantId: ctx.tenantId, tag, name: i.name, category: i.category, brand: i.brand, model: i.model, serialNo: i.serialNo,
      purchaseDate: i.purchaseDate ? dbDate(i.purchaseDate) : null, warrantyTo: i.warrantyTo ? dbDate(i.warrantyTo) : null,
      cost: i.cost ?? null, condition: i.condition ?? 'NEW', branchId: i.branchId ?? null, notes: i.notes,
      history: [{ at: new Date().toISOString(), action: 'ADDED', by: ctx.name }],
    },
  });
  await writeAudit(db, ctx, 'asset.create', 'Asset', a.id, null, { tag, name: i.name });
  return a;
}

export async function update(ctx: Ctx, id: string, i: Partial<AssetInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'asset.manage');
  const a = await db.asset.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Asset');
  if (i.status === 'ASSIGNED') throw badRequest('Use Assign to give an asset to someone.');
  if (i.status && i.status !== a.status && a.assignedToId) throw conflict('Take the asset back from the employee first.');
  const n = await db.asset.update({
    where: { id },
    data: {
      ...i,
      tag: i.tag?.toUpperCase(),
      purchaseDate: i.purchaseDate === undefined ? undefined : i.purchaseDate ? dbDate(i.purchaseDate) : null,
      warrantyTo: i.warrantyTo === undefined ? undefined : i.warrantyTo ? dbDate(i.warrantyTo) : null,
      ...(i.status && i.status !== a.status ? { history: pushHistory(a.history, { at: new Date().toISOString(), action: i.status, by: ctx.name }) } : {}),
    },
  });
  await writeAudit(db, ctx, 'asset.update', 'Asset', id, null, i);
  return n;
}

export async function assign(ctx: Ctx, id: string, employeeId: string, note?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'asset.manage');
  await assertEmployeeInScope(ctx, employeeId);
  const a = await db.asset.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Asset');
  if (a.status !== 'IN_STOCK') throw conflict(`This asset is ${a.status.toLowerCase().replace('_', ' ')}.`);
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: ctx.tenantId }, select: { firstName: true, lastName: true, status: true } });
  if (e.status !== 'ACTIVE') throw badRequest('This employee is not active.');
  const name = `${e.firstName} ${e.lastName}`;
  await db.asset.update({
    where: { id },
    data: { status: 'ASSIGNED', assignedToId: employeeId, assignedAt: new Date(), history: pushHistory(a.history, { at: new Date().toISOString(), action: 'ASSIGNED', employeeId, employeeName: name, by: ctx.name, note }) },
  });
  await writeAudit(db, ctx, 'asset.assign', 'Asset', id, null, { employeeId, note });
  const uid = await userIdForEmployee(employeeId);
  if (uid) await notify({ tenantId: ctx.tenantId, userIds: [uid], type: 'asset.assigned', title: `${a.name} (${a.tag}) is assigned to you`, body: note ?? undefined, link: '/assets' });
  return { ok: true };
}

export async function giveBack(ctx: Ctx, id: string, condition: string | null | undefined, note?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'asset.manage');
  const a = await db.asset.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { assignedTo: { select: { firstName: true, lastName: true } } } });
  if (!a) throw notFound('Asset');
  if (a.status !== 'ASSIGNED') throw conflict('This asset is not assigned.');
  await db.asset.update({
    where: { id },
    data: {
      status: condition === 'POOR' ? 'REPAIR' : 'IN_STOCK', assignedToId: null, assignedAt: null, condition: condition ?? a.condition,
      history: pushHistory(a.history, { at: new Date().toISOString(), action: 'RETURNED', employeeId: a.assignedToId, employeeName: a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : null, by: ctx.name, note }),
    },
  });
  await writeAudit(db, ctx, 'asset.return', 'Asset', id, null, { condition, note });
  return { ok: true };
}

export async function remove(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'asset.manage');
  const a = await db.asset.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Asset');
  if (a.status === 'ASSIGNED') throw conflict('Take the asset back first.');
  await db.asset.delete({ where: { id } });
  await writeAudit(db, ctx, 'asset.delete', 'Asset', id, { tag: a.tag, name: a.name }, null);
}

/** The employee's own equipment (app). */
export async function mine(ctx: Ctx) {
  if (!ctx.employeeId) return { assets: [], requests: [] };
  const [assets, requests] = await Promise.all([
    db.asset.findMany({ where: { tenantId: ctx.tenantId, assignedToId: ctx.employeeId }, select: { id: true, tag: true, name: true, category: true, brand: true, model: true, serialNo: true, assignedAt: true } }),
    db.assetRequest.findMany({ where: { tenantId: ctx.tenantId, employeeId: ctx.employeeId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  return { assets, requests: requests.map((r) => ({ ...r, neededBy: r.neededBy ? fromDbDate(r.neededBy) : null })) };
}

// ─── Request form ──────────────────────────────────────────────

export async function request(ctx: Ctx, i: { category: string; item: string; reason: string; neededBy?: string | null; employeeId?: string }) {
  assertWritable(ctx);
  requireFeature(ctx, 'assets');
  const employeeId = i.employeeId ?? ctx.employeeId;
  if (!employeeId) throw forbidden('Your login is not linked to an employee record.');
  if (employeeId !== ctx.employeeId) {
    assertCan(ctx, 'asset.manage');
    await assertEmployeeInScope(ctx, employeeId);
  }
  const r = await db.assetRequest.create({ data: { tenantId: ctx.tenantId, employeeId, category: i.category, item: i.item, reason: i.reason, neededBy: i.neededBy ? dbDate(i.neededBy) : null } });
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
  const to = await usersWithRoles(ctx.tenantId, ['HR_MANAGER', 'HR_OFFICER', 'OWNER']);
  await notify({ tenantId: ctx.tenantId, userIds: to, type: 'asset.request', title: `Equipment request: ${e.firstName} ${e.lastName}`, body: `${i.item} — ${i.reason.slice(0, 80)}`, link: '/assets?tab=requests', push: false });
  return r;
}

export async function listRequests(ctx: Ctx, status?: string) {
  assertCan(ctx, 'asset.decide');
  const scope = await employeeScope(ctx);
  const rows = await db.assetRequest.findMany({
    where: { tenantId: ctx.tenantId, employee: scope, ...(status ? { status: status as never } : {}) },
    include: { employee: { select: { id: true, empNo: true, firstName: true, lastName: true, designation: true } }, asset: { select: { id: true, tag: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return rows.map((r) => ({ ...r, neededBy: r.neededBy ? fromDbDate(r.neededBy) : null }));
}

/** Approve (optionally giving an asset from stock) or reject. */
export async function decideRequest(ctx: Ctx, id: string, approve: boolean, note?: string | null, assetId?: string | null) {
  assertWritable(ctx);
  assertCan(ctx, 'asset.decide');
  const r = await db.assetRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw notFound('Request');
  if (r.status !== 'PENDING') throw conflict('This request is already decided.');
  await assertEmployeeInScope(ctx, r.employeeId);
  if (!approve && (!note || note.trim().length < 3)) throw badRequest('Write a short reason for rejecting.');
  if (approve && assetId) await assign(ctx, assetId, r.employeeId, note ?? `Request ${r.item}`);
  await db.assetRequest.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note ?? null, assetId: assetId ?? null } });
  await writeAudit(db, ctx, approve ? 'asset.request.approve' : 'asset.request.reject', 'AssetRequest', id, null, { note, assetId });
  const uid = await userIdForEmployee(r.employeeId);
  if (uid) await notify({ tenantId: ctx.tenantId, userIds: [uid], type: 'asset.request.decided', title: `Your request for ${r.item} was ${approve ? 'approved' : 'rejected'}`, body: note ?? undefined, link: '/assets' });
  return { ok: true };
}
