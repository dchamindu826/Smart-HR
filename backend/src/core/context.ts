/**
 * The request context every service receives first. Services filter every
 * query by ctx.tenantId and reach employees only through employeeScope().
 */

import type { Request } from 'express';
import type { Role, Prisma } from '@prisma/client';
import { db } from './db.js';
import { forbidden, notFound, planLimit, unauthorized } from './errors.js';
import { hasFeature, FEATURES, type Feature } from './features.js';
import { readSettings, type TenantSettings } from './settings.js';

export interface Ctx {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  employeeId: string | null;
  branchScope: string[];
  deptScope: string[];
  features: Set<string>;
  planCode: string;
  tenantStatus: string;
  settings: TenantSettings;
  ip: string | null;
  support?: { adminId: string; sessionId: string; reasonType: string };
  /** cached ids of everyone under a MANAGER */
  _reports?: string[];
}

export function ctxOf(req: Request): Ctx {
  const c = (req as Request & { ctx?: Ctx }).ctx;
  if (!c) throw unauthorized();
  return c;
}

export function requireFeature(ctx: Ctx, f: Feature): void {
  if (!hasFeature(ctx.features, f)) {
    throw planLimit(`${FEATURES[f]} is not in your plan. Ask the account owner to upgrade.`);
  }
}

export function isHrWide(role: Role): boolean {
  return role === 'OWNER' || role === 'HR_MANAGER' || role === 'PAYROLL_OFFICER';
}

/** Ids of everyone reporting to this employee, directly or indirectly. */
export async function reportIds(ctx: Ctx): Promise<string[]> {
  if (ctx._reports) return ctx._reports;
  if (!ctx.employeeId) return (ctx._reports = []);
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE r AS (
      SELECT id FROM "Employee" WHERE "managerId" = ${ctx.employeeId} AND "tenantId" = ${ctx.tenantId}
      UNION
      SELECT e.id FROM "Employee" e JOIN r ON e."managerId" = r.id WHERE e."tenantId" = ${ctx.tenantId}
    )
    SELECT id FROM r LIMIT 5000`;
  ctx._reports = rows.map((r) => r.id);
  return ctx._reports;
}

/**
 * Prisma filter for the employees this user may see.
 * `self` = include the user's own record (for MANAGER/HR_OFFICER self-service).
 */
export async function employeeScope(ctx: Ctx, opts: { self?: boolean } = {}): Promise<Prisma.EmployeeWhereInput> {
  const base: Prisma.EmployeeWhereInput = { tenantId: ctx.tenantId };
  if (ctx.support || isHrWide(ctx.role)) return base;
  if (ctx.role === 'HR_OFFICER') {
    const and: Prisma.EmployeeWhereInput[] = [];
    if (ctx.branchScope.length) and.push({ branchId: { in: ctx.branchScope } });
    if (ctx.deptScope.length) and.push({ departmentId: { in: ctx.deptScope } });
    return and.length ? { ...base, AND: and } : base;
  }
  if (ctx.role === 'MANAGER') {
    const ids = await reportIds(ctx);
    const all = opts.self && ctx.employeeId ? [...ids, ctx.employeeId] : ids;
    return { ...base, id: { in: all } };
  }
  return { ...base, id: ctx.employeeId ?? '__none__' };
}

/** Throws 404 unless the employee exists in this tenant and in the user's scope. */
export async function assertEmployeeInScope(ctx: Ctx, employeeId: string, opts: { self?: boolean } = {}) {
  const where = await employeeScope(ctx, opts);
  const e = await db.employee.findFirst({ where: { AND: [where, { id: employeeId }] }, select: { id: true, managerId: true, firstName: true, lastName: true, branchId: true } });
  if (!e) throw notFound('Employee');
  return e;
}

/** A manager never approves their own requests; those go to their manager or HR. */
export function assertNotSelf(ctx: Ctx, employeeId: string): void {
  if (ctx.employeeId && ctx.employeeId === employeeId && ctx.role !== 'OWNER') {
    throw forbidden('You cannot approve your own request. It goes to your manager or HR.');
  }
}

export function assertWritable(ctx: Ctx): void {
  if (ctx.support) throw forbidden('Support view is read-only.');
  if (ctx.tenantStatus === 'SUSPENDED' || ctx.tenantStatus === 'CANCELLED') {
    throw forbidden('This account is suspended. Staff can still mark attendance. Contact Lumi AI to reactivate.');
  }
}

export function systemCtx(tenant: { id: string; settings: unknown; status: string; plan: { code: string; features: string[] } }): Ctx {
  return {
    userId: 'system',
    tenantId: tenant.id,
    role: 'OWNER',
    name: 'System',
    employeeId: null,
    branchScope: [],
    deptScope: [],
    features: new Set(tenant.plan.features),
    planCode: tenant.plan.code,
    tenantStatus: tenant.status,
    settings: readSettings(tenant.settings),
    ip: null,
  };
}

export function fullName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`.trim();
}
