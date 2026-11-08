/** Company profile, company settings, users and roles, sample-data removal. */

import type { Prisma, Role } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertWritable, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit, diff } from '../../core/audit.js';
import { readSettings, tenantSettingsSchema, type TenantSettings } from '../../core/settings.js';
import { hashPassword, revokeAllForUser, tempPassword } from '../../core/auth.js';
import { saveUpload, removeFile } from '../../core/files.js';
import { sendEmail } from '../../core/notify.js';
import { config } from '../../core/config.js';

// ─── Company profile ───────────────────────────────────────────

const PROFILE_OPTIONAL = ['legalName', 'regNo', 'epfRegNo', 'etfRegNo', 'tinNo', 'vatNo', 'address', 'phone', 'email', 'website', 'industry', 'contactName'] as const;
const PROFILE_FIELDS = ['name', ...PROFILE_OPTIONAL] as const;
export type ProfileInput = { name?: string } & Partial<Record<(typeof PROFILE_OPTIONAL)[number], string | null>>;

export async function getProfile(ctx: Ctx) {
  const t = await db.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    include: { plan: { select: { code: true, name: true, maxEmployees: true, priceMonthly: true, features: true } } },
  });
  const employees = await db.employee.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } });
  const sample = await db.employee.count({ where: { tenantId: ctx.tenantId, isSample: true } });
  const out: Record<string, unknown> = {};
  for (const f of PROFILE_FIELDS) out[f] = t[f];
  return {
    ...out,
    code: t.slug,
    status: t.status,
    isDemo: t.isDemo,
    trialEndsAt: t.trialEndsAt,
    demoExpiresAt: t.demoExpiresAt,
    hasLogo: !!t.logoPath,
    plan: { ...t.plan, priceMonthly: can(ctx, 'billing.view') ? t.plan.priceMonthly.toFixed(2) : null },
    usage: { employees, maxEmployees: t.plan.maxEmployees },
    sampleEmployees: sample,
  };
}

function can(ctx: Ctx, a: 'billing.view') {
  try {
    assertCan(ctx, a);
    return true;
  } catch {
    return false;
  }
}

export async function updateProfile(ctx: Ctx, i: ProfileInput) {
  assertWritable(ctx);
  assertCan(ctx, 'settings.edit');
  const before = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  return db.$transaction(async (tx) => {
    const t = await tx.tenant.update({ where: { id: ctx.tenantId }, data: i as Prisma.TenantUpdateInput });
    const d = diff(before as unknown as Record<string, unknown>, i as Record<string, unknown>);
    await writeAudit(tx, ctx, 'company.update', 'Tenant', ctx.tenantId, d.before, d.after);
    return t;
  });
}

export async function uploadLogo(ctx: Ctx, file: Express.Multer.File | undefined) {
  assertWritable(ctx);
  assertCan(ctx, 'settings.edit');
  const f = await saveUpload(file, 'LOGO', ctx.tenantId, ctx.userId);
  const before = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { logoPath: f.path } });
  if (before.logoPath) await removeFile(before.logoPath);
  await writeAudit(db, ctx, 'company.logo', 'Tenant', ctx.tenantId);
  return { ok: true };
}

export async function logoFile(tenantId: string) {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { logoPath: true } });
  if (!t?.logoPath) throw notFound('Logo');
  const f = await db.storedFile.findUnique({ where: { path: t.logoPath } });
  return { path: t.logoPath, mimeType: f?.mimeType ?? 'image/png' };
}

// ─── Company settings (incl. location / face on-off) ───────────

export async function getSettings(ctx: Ctx): Promise<TenantSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  return readSettings(t.settings);
}

export async function updateSettings(ctx: Ctx, patch: Partial<TenantSettings>) {
  assertWritable(ctx);
  assertCan(ctx, 'settings.edit');
  if (patch.requireFace) requireFeature(ctx, 'face');
  if (patch.weeklyOtCapMinutes !== undefined && patch.weeklyOtCapMinutes > 720) {
    throw badRequest('The weekly overtime limit is 12 hours by law and cannot be raised.');
  }
  if (patch.mealStart !== undefined || patch.mealEnd !== undefined) {
    const cur = await getSettings(ctx);
    const s = patch.mealStart ?? cur.mealStart;
    const e = patch.mealEnd ?? cur.mealEnd;
    if (e <= s) throw badRequest('The meal window must end after it starts.');
  }
  const current = await getSettings(ctx);
  const next = tenantSettingsSchema.parse({ ...current, ...patch });
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: next as Prisma.InputJsonValue } });
    const d = diff(current as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    await writeAudit(tx, ctx, 'settings.update', 'Tenant', ctx.tenantId, d.before, d.after);
  });
  return next;
}

// ─── Users and roles ───────────────────────────────────────────

export async function listUsers(ctx: Ctx, q: { role?: Role; q?: string; active?: boolean }) {
  assertCan(ctx, 'users.manage');
  return db.user.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(q.role ? { role: q.role } : {}),
      ...(q.active !== undefined ? { active: q.active } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}),
    },
    select: {
      id: true, name: true, email: true, phone: true, role: true, branchScope: true, deptScope: true, active: true, mustChangePassword: true,
      lastLoginAt: true, lastSeenAt: true, lockedUntil: true, createdAt: true,
      employee: { select: { id: true, empNo: true, firstName: true, lastName: true, designation: true } },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
}

export interface UserInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: Role;
  branchScope?: string[];
  deptScope?: string[];
  employeeId?: string | null;
}

async function checkUserRefs(ctx: Ctx, i: Partial<UserInput>) {
  if (i.role === 'OWNER' && ctx.role !== 'OWNER') throw forbidden('Only an owner can make another owner.');
  if (i.branchScope?.length) {
    const n = await db.branch.count({ where: { tenantId: ctx.tenantId, id: { in: i.branchScope } } });
    if (n !== i.branchScope.length) throw badRequest('Unknown branch in the branch list.');
    if (i.role === 'HR_OFFICER') requireFeature(ctx, 'multi_branch');
  }
  if (i.deptScope?.length) {
    const n = await db.department.count({ where: { tenantId: ctx.tenantId, id: { in: i.deptScope } } });
    if (n !== i.deptScope.length) throw badRequest('Unknown department in the department list.');
  }
  if (i.employeeId) {
    const e = await db.employee.findFirst({ where: { id: i.employeeId, tenantId: ctx.tenantId }, include: { user: { select: { id: true } } } });
    if (!e) throw badRequest('Unknown employee.');
    return e;
  }
  return null;
}

export async function createUser(ctx: Ctx, i: UserInput, sendInvite = true) {
  assertWritable(ctx);
  assertCan(ctx, 'users.manage');
  if (!i.email && !i.phone) throw badRequest('Give an email or a mobile number to log in with.');
  const e = await checkUserRefs(ctx, i);
  if (e?.user) throw conflict('This employee already has a login.');
  const pw = tempPassword();
  const u = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        tenantId: ctx.tenantId,
        name: i.name,
        email: i.email?.toLowerCase() ?? null,
        phone: i.phone ?? null,
        role: i.role,
        branchScope: i.branchScope ?? [],
        deptScope: i.deptScope ?? [],
        employeeId: i.employeeId ?? null,
        passwordHash: await hashPassword(pw),
        mustChangePassword: true,
      },
    });
    await writeAudit(tx, ctx, 'user.create', 'User', u.id, null, { name: u.name, email: u.email, phone: u.phone, role: u.role });
    return u;
  });
  if (sendInvite && u.email) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, slug: true } });
    await sendEmail(
      u.email,
      `Your SmartHR login for ${t.name}`,
      `Hello ${u.name},\n\n${ctx.name} created a SmartHR login for you at ${t.name}.\n\n` +
        (u.role === 'EMPLOYEE' ? `Install the SmartHR app and log in with:\n` : `Web console: ${config.APP_URL}/login\n`) +
        `Company code: ${t.slug}\nLogin: ${u.email}\nTemporary password: ${pw}\n\nYou will choose your own password after the first login.`,
    );
  }
  return { id: u.id, tempPassword: pw };
}

export async function updateUser(ctx: Ctx, id: string, i: Partial<UserInput> & { active?: boolean }) {
  assertWritable(ctx);
  assertCan(ctx, 'users.manage');
  const before = await db.user.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!before) throw notFound('User');
  if (before.role === 'OWNER' && ctx.role !== 'OWNER') throw forbidden('Only an owner can change an owner.');
  await checkUserRefs(ctx, i);
  const losingOwner = before.role === 'OWNER' && ((i.role && i.role !== 'OWNER') || i.active === false);
  if (losingOwner) {
    const owners = await db.user.count({ where: { tenantId: ctx.tenantId, role: 'OWNER', active: true, id: { not: id } } });
    if (owners === 0) throw conflict('There must always be at least one active owner.');
  }
  if (id === ctx.userId && i.active === false) throw badRequest('You cannot disable your own login.');
  const u = await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { name: i.name, email: i.email === undefined ? undefined : i.email?.toLowerCase() ?? null, phone: i.phone, role: i.role, branchScope: i.branchScope, deptScope: i.deptScope, employeeId: i.employeeId, active: i.active },
    });
    const d = diff(before as unknown as Record<string, unknown>, i as Record<string, unknown>);
    await writeAudit(tx, ctx, 'user.update', 'User', id, d.before, d.after);
    return u;
  });
  if (i.active === false || (i.role && i.role !== before.role)) await revokeAllForUser(id);
  return u;
}

export async function resetUserPassword(ctx: Ctx, id: string) {
  assertWritable(ctx);
  const u = await db.user.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!u) throw notFound('User');
  // HR can reset employee logins; owner/HR-manager logins need users.manage.
  if (u.role === 'EMPLOYEE') assertCan(ctx, 'employee.account');
  else assertCan(ctx, 'users.manage');
  if (u.role === 'OWNER' && ctx.role !== 'OWNER') throw forbidden('Only an owner can reset an owner password.');
  const pw = tempPassword();
  await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
  await revokeAllForUser(id);
  await writeAudit(db, ctx, 'user.password.reset', 'User', id);
  return { tempPassword: pw };
}

// ─── Sample data ───────────────────────────────────────────────

/** Removes everything a demo account created as sample data. Real records are untouched. */
export async function clearSampleData(tenantId: string) {
  const sampleUsers = await db.user.findMany({ where: { tenantId, employee: { isSample: true } }, select: { id: true } });
  const ids = sampleUsers.map((u) => u.id);
  await db.$transaction(
    async (tx) => {
      if (ids.length) {
        await tx.message.deleteMany({ where: { senderId: { in: ids } } });
        await tx.announcement.deleteMany({ where: { authorId: { in: ids } } });
        await tx.rosterGroup.deleteMany({ where: { tenantId, makerId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      }
      await tx.conversation.deleteMany({ where: { tenantId, members: { none: {} } } });
      await tx.asset.deleteMany({ where: { tenantId, tag: { startsWith: 'DEMO-' } } });
      await tx.employee.deleteMany({ where: { tenantId, isSample: true } });
      await tx.payrollRun.deleteMany({ where: { tenantId, payslips: { none: {} } } });
      await tx.returnFiling.deleteMany({ where: { tenantId } });
      await tx.auditLog.create({ data: { tenantId, actorId: 'system', actorName: 'System', action: 'sample.clear', entity: 'Tenant', entityId: tenantId, after: { users: ids.length } } });
    },
    { timeout: 60_000 },
  );
}

export async function clearSample(ctx: Ctx) {
  assertWritable(ctx);
  assertCan(ctx, 'sample.clear');
  const n = await db.employee.count({ where: { tenantId: ctx.tenantId, isSample: true } });
  if (n === 0) return { removed: 0 };
  await clearSampleData(ctx.tenantId);
  return { removed: n };
}
