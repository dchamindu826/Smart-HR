import { db } from '../../core/db.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../core/errors.js';
import { hashPassword, issueRefresh, revokeAllForUser, rotateRefresh, signAccess, signReset, verifyPassword, verifyReset, sha256 } from '../../core/auth.js';
import { sendEmail } from '../../core/notify.js';
import { config } from '../../core/config.js';
import { normalisePhone } from '../../core/validate.js';
import { actionsFor, ROLE_LABELS } from '../../core/permissions.js';
import { readSettings } from '../../core/settings.js';
import { ALWAYS_ON } from '../../core/features.js';
import type { Ctx } from '../../core/context.js';

const MAX_FAILS = 5;
let dummy: string | undefined;
async function dummyHash() {
  return (dummy ??= await hashPassword('not-a-real-password-0'));
}
const LOCK_MS = 15 * 60_000;

export interface LoginInput {
  login: string; // email or mobile number
  password: string;
  company?: string; // tenant slug, only needed when the login exists in several companies
  client: 'web' | 'mobile';
}

export async function login(i: LoginInput, meta: { ua?: string; ip?: string }) {
  const raw = i.login.trim().toLowerCase();
  const isEmail = raw.includes('@');
  const where = isEmail ? { email: raw } : { phone: normalisePhone(raw) };
  const candidates = await db.user.findMany({
    where: { ...where, ...(i.company ? { tenant: { slug: i.company.toLowerCase() } } : {}) },
    include: { tenant: { select: { id: true, slug: true, name: true, status: true, isDemo: true, demoExpiresAt: true } } },
    take: 10,
  });
  if (candidates.length === 0) {
    await verifyPassword(i.password, await dummyHash()); // same timing whether or not the login exists
    throw unauthorized('The login or password is wrong.');
  }
  if (candidates.length > 1) {
    // only list the companies where this password is right, so the endpoint does not reveal accounts
    const matching = [];
    for (const c of candidates) if (await verifyPassword(i.password, c.passwordHash)) matching.push(c);
    if (matching.length === 0) throw unauthorized('The login or password is wrong.');
    if (matching.length > 1) {
      throw conflict('This login is used in more than one company. Choose your company.', {
        code: 'COMPANY_REQUIRED',
        companies: matching.map((c) => ({ code: c.tenant.slug, name: c.tenant.name })),
      });
    }
    candidates.splice(0, candidates.length, matching[0]);
  }
  const user = candidates[0];
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw forbidden(`Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask HR to reset it.`);
  }
  const ok = await verifyPassword(i.password, user.passwordHash);
  if (!ok) {
    const fails = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS) : null },
    });
    throw unauthorized(fails >= MAX_FAILS ? 'Too many wrong passwords. Your account is locked for 15 minutes.' : 'The login or password is wrong.');
  }
  if (!user.active) throw forbidden('Your account is disabled. Contact HR.');
  if (user.tenant.status === 'CANCELLED') throw forbidden('This company account is closed.');
  if (user.tenant.isDemo && user.tenant.demoExpiresAt && user.tenant.demoExpiresAt < new Date()) throw forbidden('This demo account has expired.');
  if (i.client === 'web' && user.role === 'EMPLOYEE') throw forbidden('The web console is for HR and managers. Please use the SmartHR mobile app.');

  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const access = await signAccess({ sub: user.id, tid: user.tenantId, role: user.role });
  const refresh = await issueRefresh(user.id, i.client === 'web' ? 'WEB' : 'MOBILE', meta);
  return { accessToken: access, refreshToken: refresh.raw, mustChangePassword: user.mustChangePassword, userId: user.id };
}

export async function refresh(raw: string, meta: { ua?: string; ip?: string }) {
  const r = await rotateRefresh(raw, meta);
  if (!r) throw unauthorized('Your session has expired. Please log in again.');
  const user = await db.user.findUnique({ where: { id: r.userId } });
  if (!user || !user.active) throw unauthorized();
  const access = await signAccess({ sub: user.id, tid: user.tenantId, role: user.role });
  return { accessToken: access, refreshToken: r.raw };
}

export async function logout(raw: string | undefined) {
  if (!raw) return;
  await db.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function changePassword(ctx: Ctx, current: string, next: string) {
  if (ctx.support) throw forbidden();
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(current, u.passwordHash))) throw badRequest('The current password is wrong.');
  if (current === next) throw badRequest('Choose a new password that is different from the current one.');
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await db.auditLog.create({ data: { tenantId: ctx.tenantId, actorId: ctx.userId, actorName: ctx.name, action: 'user.password.change', entity: 'User', entityId: u.id } });
}

export async function forgotPassword(email: string, company?: string) {
  const users = await db.user.findMany({
    where: { email: email.toLowerCase(), active: true, ...(company ? { tenant: { slug: company.toLowerCase() } } : {}) },
    include: { tenant: { select: { name: true } } },
    take: 5,
  });
  for (const u of users) {
    const token = await signReset(u.id, u.passwordHash);
    await sendEmail(
      u.email!,
      'Reset your SmartHR password',
      `Hello ${u.name},\n\nSomeone asked to reset your SmartHR password for ${u.tenant.name}.\n` +
        `Open this link within 30 minutes to choose a new password:\n\n${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}\n\n` +
        `If you did not ask for this, ignore this email.\n\nSmartHR by Lumi AI`,
    );
  }
  // Always the same answer, so the endpoint does not reveal which emails exist.
}

export async function resetPassword(token: string, next: string) {
  const t = await verifyReset(token);
  if (!t) throw badRequest('This reset link has expired. Ask for a new one.');
  const u = await db.user.findUnique({ where: { id: t.userId } });
  if (!u || sha256(u.passwordHash).slice(0, 16) !== t.pwh) throw badRequest('This reset link has already been used.');
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
  await revokeAllForUser(u.id);
}

/** Everything the web console and the app need to know about the signed-in user. */
export async function me(ctx: Ctx) {
  const [user, tenant] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: {
        id: true, name: true, email: true, phone: true, role: true, mustChangePassword: true, branchScope: true, deptScope: true,
        employee: {
          select: {
            id: true, empNo: true, firstName: true, lastName: true, designation: true, photoPath: true, joinDate: true,
            allowRemote: true, requireLocation: true, requireFace: true, remoteLat: true, remoteLng: true,
            branch: { select: { id: true, name: true } }, department: { select: { id: true, name: true } },
            manager: { select: { id: true, firstName: true, lastName: true } },
            rosterGroupId: true,
          },
        },
      },
    }),
    db.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { id: true, slug: true, name: true, status: true, isDemo: true, demoExpiresAt: true, trialEndsAt: true, logoPath: true, settings: true, plan: { select: { code: true, name: true, features: true, maxEmployees: true } } },
    }),
  ]);
  const s = readSettings(tenant.settings);
  const [hasReports, makesRoster] = await Promise.all([
    user.employee ? db.employee.count({ where: { tenantId: ctx.tenantId, managerId: user.employee.id, status: 'ACTIVE' } }) : Promise.resolve(0),
    db.rosterGroup.count({ where: { tenantId: ctx.tenantId, makerId: ctx.userId, active: true } }),
  ]);
  const e = user.employee;
  return {
    user: { ...user, roleLabel: ROLE_LABELS[user.role] },
    tenant: {
      id: tenant.id, code: tenant.slug, name: tenant.name, status: tenant.status, isDemo: tenant.isDemo,
      demoExpiresAt: tenant.demoExpiresAt, trialEndsAt: tenant.trialEndsAt, hasLogo: !!tenant.logoPath, plan: tenant.plan,
      features: [...new Set([...ALWAYS_ON, ...tenant.plan.features])],
    },
    permissions: actionsFor(ctx),
    isManager: hasReports > 0,
    makesRoster: makesRoster > 0,
    support: ctx.support ? { reasonType: ctx.support.reasonType } : null,
    attendance: e
      ? {
          requireLocation: e.requireLocation ?? s.requireLocation,
          requireFace: (e.requireFace ?? s.requireFace) && tenant.plan.features.includes('face'),
          allowRemote: e.allowRemote ?? s.allowRemote,
          allowWebPunch: s.allowWebPunch,
          hasHomeLocation: e.remoteLat !== null && e.remoteLng !== null,
          mealStart: s.mealStart,
          mealEnd: s.mealEnd,
          normalDayMinutes: s.normalDayMinutes,
        }
      : null,
  };
}

export async function savePushToken(ctx: Ctx, token: string, platform: string) {
  if (ctx.support) throw forbidden('Support view is read-only.');
  await db.pushToken.upsert({
    where: { token },
    create: { token, platform, userId: ctx.userId, tenantId: ctx.tenantId },
    update: { userId: ctx.userId, tenantId: ctx.tenantId, platform },
  });
}

export async function removePushToken(ctx: Ctx, token: string) {
  if (ctx.support) throw forbidden('Support view is read-only.');
  await db.pushToken.deleteMany({ where: { token, userId: ctx.userId } });
}
