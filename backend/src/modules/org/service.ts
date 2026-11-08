/** Branches and departments, and the all-branches overview. */

import { db } from '../../core/db.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertWritable, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit, diff } from '../../core/audit.js';
import { colomboDate, dbDate } from '../../lib/time.js';

export interface BranchInput {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number;
  active?: boolean;
}

function visibleBranchIds(ctx: Ctx): string[] | null {
  return ctx.role === 'HR_OFFICER' && ctx.branchScope.length ? ctx.branchScope : null;
}

export async function listBranches(ctx: Ctx, includeInactive = false) {
  const scope = visibleBranchIds(ctx);
  return db.branch.findMany({
    where: { tenantId: ctx.tenantId, ...(includeInactive ? {} : { active: true }), ...(scope ? { id: { in: scope } } : {}) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: { where: { status: 'ACTIVE' } }, departments: true, terminals: true } } },
  });
}

export async function createBranch(ctx: Ctx, i: BranchInput) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  return db.$transaction(async (tx) => {
    const b = await tx.branch.create({ data: { ...i, code: i.code.toUpperCase(), tenantId: ctx.tenantId } });
    await writeAudit(tx, ctx, 'branch.create', 'Branch', b.id, null, b);
    return b;
  });
}

export async function updateBranch(ctx: Ctx, id: string, i: Partial<BranchInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  const before = await db.branch.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!before) throw notFound('Branch');
  if (i.active === false) {
    const people = await db.employee.count({ where: { tenantId: ctx.tenantId, branchId: id, status: 'ACTIVE' } });
    if (people > 0) throw conflict(`Move the ${people} active employee(s) out of this branch first.`);
  }
  return db.$transaction(async (tx) => {
    const b = await tx.branch.update({ where: { id }, data: { ...i, code: i.code?.toUpperCase() } });
    const d = diff(before as unknown as Record<string, unknown>, i as Record<string, unknown>);
    await writeAudit(tx, ctx, 'branch.update', 'Branch', id, d.before, d.after);
    return b;
  });
}

export async function deleteBranch(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  const b = await db.branch.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { employees: true, departments: true, terminals: true, sessions: true } } } });
  if (!b) throw notFound('Branch');
  const used = b._count.employees + b._count.departments + b._count.terminals + b._count.sessions;
  if (used > 0) throw conflict('This branch has employees, departments, terminals or attendance history. Make it inactive instead of removing it.');
  const total = await db.branch.count({ where: { tenantId: ctx.tenantId } });
  if (total <= 1) throw conflict('A company needs at least one branch.');
  await db.$transaction(async (tx) => {
    await tx.branch.delete({ where: { id } });
    await writeAudit(tx, ctx, 'branch.delete', 'Branch', id, b, null);
  });
}

/** All branches overview: today's attendance and headcount per branch. */
export async function branchesOverview(ctx: Ctx) {
  assertCan(ctx, 'dashboard.view');
  const today = colomboDate(new Date());
  const branches = await listBranches(ctx);
  const ids = branches.map((b) => b.id);
  const [present, openNow, onLeave, pending, late] = await Promise.all([
    db.attendanceSession.groupBy({ by: ['employeeId'], where: { tenantId: ctx.tenantId, date: dbDate(today) } }),
    db.attendanceSession.findMany({ where: { tenantId: ctx.tenantId, date: dbDate(today), endAt: null }, select: { employeeId: true, mode: true } }),
    db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'APPROVED', fromDate: { lte: dbDate(today) }, toDate: { gte: dbDate(today) } }, select: { employeeId: true } }),
    db.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING' }, select: { employeeId: true } }),
    db.attendanceDay.findMany({ where: { tenantId: ctx.tenantId, date: { gte: dbDate(today.slice(0, 8) + '01') }, lateMinutes: { gt: 0 } }, select: { employeeId: true } }),
  ]);
  const emps = await db.employee.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE', branchId: { in: ids } }, select: { id: true, branchId: true } });
  const branchOf = new Map(emps.map((e) => [e.id, e.branchId]));
  const presentSet = new Set(present.map((p) => p.employeeId));
  const count = (list: { employeeId: string }[], b: string) => new Set(list.filter((x) => branchOf.get(x.employeeId) === b).map((x) => x.employeeId)).size;

  return branches.map((b) => {
    const headcount = emps.filter((e) => e.branchId === b.id).length;
    const p = emps.filter((e) => e.branchId === b.id && presentSet.has(e.id)).length;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      address: b.address,
      hasFence: b.lat !== null && b.lng !== null,
      headcount,
      present: p,
      inNow: openNow.filter((o) => branchOf.get(o.employeeId) === b.id).length,
      remoteNow: openNow.filter((o) => branchOf.get(o.employeeId) === b.id && o.mode === 'REMOTE').length,
      onLeave: count(onLeave, b.id),
      notIn: Math.max(0, headcount - p - count(onLeave, b.id)),
      pendingLeave: count(pending, b.id),
      lateThisMonth: late.filter((l) => branchOf.get(l.employeeId) === b.id).length,
      attendancePct: headcount ? Math.round((p / headcount) * 100) : 0,
      terminals: b._count.terminals,
      departments: b._count.departments,
    };
  });
}

// ─── Departments ───────────────────────────────────────────────

export interface DeptInput {
  code: string;
  name: string;
  branchId?: string | null;
  headId?: string | null;
  active?: boolean;
}

export async function listDepartments(ctx: Ctx) {
  return db.department.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { name: 'asc' },
    include: {
      branch: { select: { id: true, name: true } },
      head: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { employees: { where: { status: 'ACTIVE' } } } },
    },
  });
}

async function checkRefs(ctx: Ctx, i: Partial<DeptInput>) {
  if (i.branchId && !(await db.branch.findFirst({ where: { id: i.branchId, tenantId: ctx.tenantId } }))) throw badRequest('Unknown branch.');
  if (i.headId && !(await db.employee.findFirst({ where: { id: i.headId, tenantId: ctx.tenantId } }))) throw badRequest('Unknown employee for department head.');
}

export async function createDepartment(ctx: Ctx, i: DeptInput) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  await checkRefs(ctx, i);
  return db.$transaction(async (tx) => {
    const d = await tx.department.create({ data: { ...i, code: i.code.toUpperCase(), tenantId: ctx.tenantId } });
    await writeAudit(tx, ctx, 'department.create', 'Department', d.id, null, d);
    return d;
  });
}

export async function updateDepartment(ctx: Ctx, id: string, i: Partial<DeptInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  const before = await db.department.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!before) throw notFound('Department');
  await checkRefs(ctx, i);
  return db.$transaction(async (tx) => {
    const d = await tx.department.update({ where: { id }, data: { ...i, code: i.code?.toUpperCase() } });
    const x = diff(before as unknown as Record<string, unknown>, i as Record<string, unknown>);
    await writeAudit(tx, ctx, 'department.update', 'Department', id, x.before, x.after);
    return d;
  });
}

export async function deleteDepartment(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'org.edit');
  const d = await db.department.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { _count: { select: { employees: true } } } });
  if (!d) throw notFound('Department');
  if (d._count.employees > 0) throw conflict('Move the employees out of this department first, or make it inactive.');
  await db.$transaction(async (tx) => {
    await tx.department.delete({ where: { id } });
    await writeAudit(tx, ctx, 'department.delete', 'Department', id, d, null);
  });
}

/** Org chart: everyone with their manager id, for drawing a tree. */
export async function orgChart(ctx: Ctx) {
  assertCan(ctx, 'employee.view');
  requireFeature(ctx, 'people');
  return db.employee.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, empNo: true, firstName: true, lastName: true, designation: true, managerId: true, photoPath: true, department: { select: { name: true } }, branch: { select: { name: true } } },
    orderBy: { firstName: 'asc' },
  });
}
