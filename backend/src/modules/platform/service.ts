/**
 * Lumi AI platform administration: admins, pricing plans, companies,
 * terminals, invoices, demo accounts, customer analytics, support view.
 */

import type { PlatformRole, Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../core/errors.js';
import { hashPassword, randomToken, sha256, signAccess, verifyPassword, tempPassword, revokeAllForUser } from '../../core/auth.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../../rules/totp.js';
import { createTenantWithDefaults, slugify, type NewTenant } from './bootstrap.js';
import { createDemoData } from './demo.js';
import { toCents, fromCents, mulDiv } from '../../lib/money.js';
import { addDays, colomboDate, monthRange } from '../../lib/time.js';
import { FEATURES, type Feature } from '../../core/features.js';
import { SYSTEM_DEFAULTS } from '../../core/settings.js';
import { sendEmail } from '../../core/notify.js';
import { config } from '../../core/config.js';

export interface PCtx {
  adminId: string;
  role: PlatformRole;
  name: string;
  email: string;
  ip: string | null;
  sessionId: string;
}

const SESSION_MS = 8 * 3600_000;

export async function paudit(p: Pick<PCtx, 'adminId' | 'ip'> | null, action: string, o: { tenantId?: string; entity?: string; entityId?: string; detail?: unknown } = {}) {
  await db.platformAudit.create({
    data: {
      adminId: p?.adminId ?? null,
      action,
      tenantId: o.tenantId,
      entity: o.entity,
      entityId: o.entityId,
      detail: o.detail === undefined ? undefined : (JSON.parse(JSON.stringify(o.detail)) as Prisma.InputJsonValue),
      ip: p?.ip ?? null,
    },
  });
}

export function assertRole(p: PCtx, ...roles: PlatformRole[]) {
  if (p.role === 'SUPER_ADMIN') return;
  if (!roles.includes(p.role)) throw forbidden('Your admin role cannot do this.');
}

// ─── Auth ──────────────────────────────────────────────────────

export async function platformLogin(email: string, password: string, code: string | undefined, meta: { ua?: string; ip?: string | null }) {
  const a = await db.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
  if (!a || !a.active) throw unauthorized('The email or password is wrong.');
  if (a.lockedUntil && a.lockedUntil > new Date()) throw forbidden('Too many attempts. Try again in 15 minutes.');
  if (!(await verifyPassword(password, a.passwordHash))) {
    const n = a.failedLogins + 1;
    await db.platformAdmin.update({ where: { id: a.id }, data: { failedLogins: n >= 5 ? 0 : n, lockedUntil: n >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
    await paudit({ adminId: a.id, ip: meta.ip ?? null }, 'auth.failed');
    throw unauthorized('The email or password is wrong.');
  }
  if (a.totpEnabled) {
    if (!code) throw conflict('Enter the 6-digit code from your authenticator app.', { code: 'TOTP_REQUIRED' });
    if (!a.totpSecret || !verifyTotp(a.totpSecret, code)) throw unauthorized('The code is wrong or has expired.');
  }
  const raw = randomToken(48);
  await db.platformSession.create({
    data: { adminId: a.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + SESSION_MS), userAgent: meta.ua?.slice(0, 300), ip: meta.ip ?? null },
  });
  await db.platformAdmin.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await paudit({ adminId: a.id, ip: meta.ip ?? null }, 'auth.login');
  return { token: raw, totpEnabled: a.totpEnabled, maxAgeMs: SESSION_MS };
}

export async function platformSession(raw: string): Promise<PCtx | null> {
  const s = await db.platformSession.findUnique({ where: { tokenHash: sha256(raw) }, include: { admin: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.admin.active) return null;
  return { adminId: s.adminId, role: s.admin.role, name: s.admin.name, email: s.admin.email, ip: null, sessionId: s.id };
}

export async function platformLogout(raw: string) {
  await db.platformSession.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } });
}

export async function totpSetup(p: PCtx) {
  const secret = newTotpSecret();
  await db.platformAdmin.update({ where: { id: p.adminId }, data: { totpSecret: secret, totpEnabled: false } });
  return { secret, otpauthUrl: otpauthUrl(secret, p.email) };
}

export async function totpEnable(p: PCtx, code: string) {
  const a = await db.platformAdmin.findUniqueOrThrow({ where: { id: p.adminId } });
  if (!a.totpSecret || !verifyTotp(a.totpSecret, code)) throw badRequest('That code is not right. Check the time on your phone and try again.');
  await db.platformAdmin.update({ where: { id: a.id }, data: { totpEnabled: true } });
  await paudit(p, 'auth.totp.enable');
}

export async function changeOwnPassword(p: PCtx, current: string, next: string) {
  const a = await db.platformAdmin.findUniqueOrThrow({ where: { id: p.adminId } });
  if (!(await verifyPassword(current, a.passwordHash))) throw badRequest('The current password is wrong.');
  await db.platformAdmin.update({ where: { id: a.id }, data: { passwordHash: await hashPassword(next) } });
  await db.platformSession.updateMany({ where: { adminId: a.id, id: { not: p.sessionId } }, data: { revokedAt: new Date() } });
  await paudit(p, 'auth.password.change');
}

// ─── Admins (multiple admin logins) ────────────────────────────

export async function listAdmins() {
  return db.platformAdmin.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, active: true, totpEnabled: true, lastLoginAt: true, createdAt: true },
  });
}

export async function createAdmin(p: PCtx, i: { email: string; name: string; role: PlatformRole }) {
  assertRole(p, 'SUPER_ADMIN');
  const password = tempPassword();
  const a = await db.platformAdmin.create({ data: { email: i.email.toLowerCase(), name: i.name, role: i.role, passwordHash: await hashPassword(password) } });
  await paudit(p, 'admin.create', { entity: 'PlatformAdmin', entityId: a.id, detail: { email: a.email, role: a.role } });
  await sendEmail(a.email, 'Your SmartHR admin login', `Hello ${a.name},\n\nYou have a SmartHR platform admin login.\nEmail: ${a.email}\nTemporary password: ${password}\n\nLog in at ${config.APP_URL}/admin/login and change it.`);
  return { id: a.id, tempPassword: password };
}

export async function updateAdmin(p: PCtx, id: string, i: { name?: string; role?: PlatformRole; active?: boolean; resetTotp?: boolean; resetPassword?: boolean }) {
  assertRole(p, 'SUPER_ADMIN');
  if (id === p.adminId && (i.active === false || (i.role && i.role !== 'SUPER_ADMIN'))) throw badRequest('You cannot remove your own super admin access.');
  if (i.active === false || (i.role && i.role !== 'SUPER_ADMIN')) {
    const supers = await db.platformAdmin.count({ where: { role: 'SUPER_ADMIN', active: true, id: { not: id } } });
    const target = await db.platformAdmin.findUniqueOrThrow({ where: { id } });
    if (target.role === 'SUPER_ADMIN' && supers === 0) throw badRequest('There must be at least one active super admin.');
  }
  let tempPw: string | undefined;
  const data: Prisma.PlatformAdminUpdateInput = { name: i.name, role: i.role, active: i.active };
  if (i.resetTotp) Object.assign(data, { totpEnabled: false, totpSecret: null });
  if (i.resetPassword) {
    tempPw = tempPassword();
    data.passwordHash = await hashPassword(tempPw);
  }
  await db.platformAdmin.update({ where: { id }, data });
  if (i.active === false || i.resetPassword) await db.platformSession.updateMany({ where: { adminId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await paudit(p, 'admin.update', { entity: 'PlatformAdmin', entityId: id, detail: { ...i } });
  return { ok: true, tempPassword: tempPw };
}

// ─── Plans and pricing ─────────────────────────────────────────

export async function listPlans() {
  const plans = await db.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { tenants: true } } } });
  return {
    features: FEATURES,
    plans: plans.map((pl) => ({ ...pl, priceMonthly: pl.priceMonthly.toFixed(2), priceYearly: pl.priceYearly?.toFixed(2) ?? null, tenantCount: pl._count.tenants })),
  };
}

export interface PlanInput {
  code: string;
  name: string;
  description?: string | null;
  priceMonthly: string;
  priceYearly?: string | null;
  maxEmployees: number;
  features: string[];
  active?: boolean;
  sortOrder?: number;
}

function cleanFeatures(f: string[]): Feature[] {
  const bad = f.filter((x) => !(x in FEATURES));
  if (bad.length) throw badRequest(`Unknown feature: ${bad.join(', ')}`);
  return [...new Set(f)] as Feature[];
}

export async function createPlan(p: PCtx, i: PlanInput) {
  assertRole(p, 'SUPER_ADMIN');
  const pl = await db.plan.create({ data: { ...i, code: i.code.toUpperCase(), features: cleanFeatures(i.features) } });
  await paudit(p, 'plan.create', { entity: 'Plan', entityId: pl.id, detail: i });
  return pl;
}

export async function updatePlan(p: PCtx, id: string, i: Partial<PlanInput>) {
  assertRole(p, 'SUPER_ADMIN');
  const before = await db.plan.findUniqueOrThrow({ where: { id } });
  const pl = await db.plan.update({ where: { id }, data: { ...i, code: i.code?.toUpperCase(), features: i.features ? cleanFeatures(i.features) : undefined } });
  await paudit(p, 'plan.update', { entity: 'Plan', entityId: id, detail: { before: { price: before.priceMonthly.toFixed(2), max: before.maxEmployees, features: before.features }, after: i } });
  return pl;
}

// ─── Companies ─────────────────────────────────────────────────

/** What the company pays per month, after custom price and discount. */
export function monthlyPrice(t: { customPrice: Prisma.Decimal | null; discountPct: Prisma.Decimal | null; billingCycle: string; plan: { priceMonthly: Prisma.Decimal; priceYearly: Prisma.Decimal | null } }): number {
  let cents: number;
  if (t.customPrice) cents = toCents(t.customPrice);
  else if (t.billingCycle === 'YEARLY' && t.plan.priceYearly) cents = mulDiv(toCents(t.plan.priceYearly), 1, 12);
  else cents = toCents(t.plan.priceMonthly);
  if (t.discountPct) cents = cents - mulDiv(cents, Math.round(Number(t.discountPct.toString()) * 100), 10_000);
  return cents;
}

export async function listTenants(q: { q?: string; status?: string; plan?: string; demo?: boolean; page: number; pageSize: number }) {
  const where: Prisma.TenantWhereInput = {
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.plan ? { plan: { code: q.plan } } : {}),
    ...(q.demo !== undefined ? { isDemo: q.demo } : {}),
  };
  const [rows, total] = await Promise.all([
    db.tenant.findMany({
      where,
      include: { plan: true, _count: { select: { employees: { where: { status: 'ACTIVE' } }, users: true, terminals: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.tenant.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const active7 = ids.length
    ? await db.user.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, lastSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true })
    : [];
  const activeMap = new Map(active7.map((a) => [a.tenantId, a._count]));
  return {
    total,
    rows: rows.map((t) => ({
      id: t.id, slug: t.slug, name: t.name, status: t.status, isDemo: t.isDemo, demoExpiresAt: t.demoExpiresAt, trialEndsAt: t.trialEndsAt,
      plan: { id: t.plan.id, code: t.plan.code, name: t.plan.name, maxEmployees: t.plan.maxEmployees },
      billingCycle: t.billingCycle, customPrice: t.customPrice?.toFixed(2) ?? null, discountPct: t.discountPct?.toFixed(2) ?? null,
      monthlyAmount: fromCents(monthlyPrice(t)),
      employees: t._count.employees, users: t._count.users, terminals: t._count.terminals, activeUsers7d: activeMap.get(t.id) ?? 0,
      contactName: t.contactName, email: t.email, phone: t.phone, createdAt: t.createdAt,
    })),
  };
}

export async function getTenant(id: string) {
  const t = await db.tenant.findUnique({
    where: { id },
    include: {
      plan: true,
      branches: { select: { id: true, code: true, name: true } },
      terminals: true,
      invoices: { orderBy: { periodStart: 'desc' }, take: 24 },
      users: { where: { role: { in: ['OWNER', 'HR_MANAGER'] } }, select: { id: true, name: true, email: true, phone: true, role: true, lastLoginAt: true, active: true } },
      _count: { select: { employees: { where: { status: 'ACTIVE' } }, users: true } },
    },
  });
  if (!t) throw notFound('Company');
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [punches30, lastPayroll] = await Promise.all([
    db.punchEvent.count({ where: { tenantId: id, receivedAt: { gte: since }, result: 'ACCEPTED' } }),
    db.payrollRun.findFirst({ where: { tenantId: id }, orderBy: { period: 'desc' }, select: { period: true, status: true } }),
  ]);
  return {
    ...t,
    customPrice: t.customPrice?.toFixed(2) ?? null,
    discountPct: t.discountPct?.toFixed(2) ?? null,
    monthlyAmount: fromCents(monthlyPrice(t)),
    plan: { ...t.plan, priceMonthly: t.plan.priceMonthly.toFixed(2), priceYearly: t.plan.priceYearly?.toFixed(2) ?? null },
    invoices: t.invoices.map((i) => ({ ...i, amount: i.amount.toFixed(2) })),
    terminals: t.terminals.map((x) => ({ ...x, apiKeyHash: undefined, monthlyFee: x.monthlyFee?.toFixed(2) ?? null })),
    usage: { employees: t._count.employees, users: t._count.users, punches30, lastPayroll },
  };
}

async function uniqueSlug(base: string): Promise<string> {
  let s = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? s : `${s}-${i + 1}`;
    if (!(await db.tenant.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  return `${s}-${randomToken(3).toLowerCase()}`;
}

export async function createTenant(p: PCtx, i: Omit<NewTenant, 'slug'> & { slug?: string; sendWelcome?: boolean }) {
  assertRole(p, 'ADMIN', 'SALES');
  if (i.isDemo === false && p.role === 'SALES') throw forbidden('Sales admins can create demo accounts only.');
  const slug = i.slug ? slugify(i.slug) : await uniqueSlug(i.name);
  if (await db.tenant.findUnique({ where: { slug } })) throw conflict(`The company code "${slug}" is taken.`);
  const r = await db.$transaction((tx) => createTenantWithDefaults(tx, { ...i, slug }), { timeout: 30_000 });
  if (i.isDemo) await createDemoData(r.tenant.id);
  await paudit(p, i.isDemo ? 'tenant.demo.create' : 'tenant.create', { tenantId: r.tenant.id, entity: 'Tenant', entityId: r.tenant.id, detail: { name: i.name, slug, planId: i.planId } });
  if (i.sendWelcome !== false) {
    await sendEmail(
      r.owner.email!,
      i.isDemo ? 'Your SmartHR demo account' : 'Welcome to SmartHR',
      `Hello ${r.owner.name},\n\n${i.isDemo ? 'Your SmartHR demo is ready. It has sample employees so you can try every screen.' : `${i.name} is set up on SmartHR.`}\n\n` +
        `Web console: ${config.APP_URL}/login\nCompany code: ${slug}\nLogin: ${r.owner.email}\nTemporary password: ${r.ownerPassword}\n\nYou will be asked to change the password the first time you log in.\n\nSmartHR by Lumi AI`,
    );
  }
  return { id: r.tenant.id, slug, ownerEmail: r.owner.email, ownerPassword: r.ownerPassword };
}

export interface TenantUpdate {
  name?: string;
  planId?: string;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  customPrice?: string | null;
  discountPct?: string | null;
  trialEndsAt?: string | null;
  demoExpiresAt?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  industry?: string | null;
}

export async function updateTenant(p: PCtx, id: string, i: TenantUpdate) {
  if (p.role === 'SALES') {
    // sales may only extend a demo
    const t = await db.tenant.findUniqueOrThrow({ where: { id } });
    if (!t.isDemo || Object.keys(i).some((k) => k !== 'demoExpiresAt')) throw forbidden('Sales admins can only extend demo accounts.');
  } else assertRole(p, 'ADMIN');
  const before = await db.tenant.findUniqueOrThrow({ where: { id }, include: { plan: true } });
  if (i.planId && i.planId !== before.planId) {
    const plan = await db.plan.findUniqueOrThrow({ where: { id: i.planId } });
    const count = await db.employee.count({ where: { tenantId: id, status: 'ACTIVE' } });
    if (count > plan.maxEmployees) throw badRequest(`${before.name} has ${count} active employees. The ${plan.name} plan allows ${plan.maxEmployees}.`);
  }
  const t = await db.tenant.update({
    where: { id },
    data: {
      ...i,
      trialEndsAt: i.trialEndsAt === undefined ? undefined : i.trialEndsAt ? new Date(i.trialEndsAt) : null,
      demoExpiresAt: i.demoExpiresAt === undefined ? undefined : i.demoExpiresAt ? new Date(i.demoExpiresAt) : null,
    },
  });
  await paudit(p, 'tenant.update', { tenantId: id, entity: 'Tenant', entityId: id, detail: i });
  return t;
}

export async function setTenantStatus(p: PCtx, id: string, status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'TRIAL', reason?: string | null) {
  assertRole(p, 'ADMIN');
  const t = await db.tenant.update({
    where: { id },
    data: { status, suspendedAt: status === 'SUSPENDED' ? new Date() : null, suspendReason: status === 'SUSPENDED' ? reason ?? null : null, ...(status === 'ACTIVE' ? { isDemo: false, demoExpiresAt: null } : {}) },
  });
  await paudit(p, `tenant.status.${status.toLowerCase()}`, { tenantId: id, entity: 'Tenant', entityId: id, detail: { reason } });
  return t;
}

/** Convert a demo into a real account: remove sample data, keep the settings. */
export async function convertDemo(p: PCtx, id: string) {
  assertRole(p, 'ADMIN');
  const t = await db.tenant.findUniqueOrThrow({ where: { id } });
  if (!t.isDemo) throw badRequest('This company is not a demo.');
  const { clearSampleData } = await import('../settings/service.js');
  await clearSampleData(id);
  await db.tenant.update({ where: { id }, data: { isDemo: false, demoExpiresAt: null, status: 'TRIAL', trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
  await paudit(p, 'tenant.demo.convert', { tenantId: id, entity: 'Tenant', entityId: id });
}

export async function resetOwnerPassword(p: PCtx, tenantId: string, userId: string) {
  assertRole(p, 'ADMIN');
  const u = await db.user.findFirst({ where: { id: userId, tenantId } });
  if (!u) throw notFound('User');
  const pw = tempPassword();
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
  await revokeAllForUser(u.id);
  await paudit(p, 'tenant.user.password.reset', { tenantId, entity: 'User', entityId: u.id });
  await db.auditLog.create({ data: { tenantId, actorId: `platform:${p.adminId}`, actorName: `Lumi AI (${p.name})`, action: 'user.password.reset', entity: 'User', entityId: u.id } });
  return { tempPassword: pw };
}

// ─── Support view ──────────────────────────────────────────────

export async function startSupport(p: PCtx, tenantId: string, reason: string, reasonType: 'GENERAL' | 'PAYROLL') {
  assertRole(p, 'ADMIN', 'SUPPORT');
  const owner = await db.user.findFirst({ where: { tenantId, role: 'OWNER' }, orderBy: { createdAt: 'asc' } });
  if (!owner) throw badRequest('This company has no owner account.');
  const s = await db.supportSession.create({ data: { adminId: p.adminId, tenantId, reason, reasonType, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  await paudit(p, 'support.start', { tenantId, entity: 'SupportSession', entityId: s.id, detail: { reason, reasonType } });
  await db.auditLog.create({
    data: { tenantId, actorId: `platform:${p.adminId}`, actorName: `Lumi AI support (${p.name})`, action: 'support.start', entity: 'SupportSession', entityId: s.id, after: { reason, reasonType } },
  });
  const token = await signAccess({ sub: owner.id, tid: tenantId, role: owner.role, sup: s.id }, 30 * 60);
  return { accessToken: token, expiresAt: s.expiresAt, sessionId: s.id };
}

export async function endSupport(p: PCtx, sessionId: string) {
  await db.supportSession.updateMany({ where: { id: sessionId, adminId: p.adminId, endedAt: null }, data: { endedAt: new Date() } });
  await paudit(p, 'support.end', { entity: 'SupportSession', entityId: sessionId });
}

// ─── Terminals ─────────────────────────────────────────────────

export async function listTerminals(q: { status?: string; tenantId?: string; q?: string }) {
  const rows = await db.terminal.findMany({
    where: {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.q ? { OR: [{ serialNo: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { model: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    include: { tenant: { select: { id: true, name: true, slug: true } }, branch: { select: { id: true, name: true } } },
    orderBy: [{ status: 'asc' }, { serialNo: 'asc' }],
  });
  return rows.map((t) => ({ ...t, apiKeyHash: undefined, hasKey: !!t.apiKeyHash, monthlyFee: t.monthlyFee?.toFixed(2) ?? null, online: !!t.lastSeenAt && Date.now() - t.lastSeenAt.getTime() < 15 * 60_000 }));
}

export async function createTerminal(p: PCtx, i: { serialNo: string; model: string; name?: string | null; monthlyFee?: string | null; notes?: string | null }) {
  assertRole(p, 'ADMIN');
  const t = await db.terminal.create({ data: { ...i, serialNo: i.serialNo.trim().toUpperCase() } });
  await paudit(p, 'terminal.create', { entity: 'Terminal', entityId: t.id, detail: i });
  return t;
}

export async function updateTerminal(p: PCtx, id: string, i: { name?: string | null; model?: string; monthlyFee?: string | null; notes?: string | null; status?: 'IN_STOCK' | 'REPAIR' | 'RETIRED' }) {
  assertRole(p, 'ADMIN');
  const t = await db.terminal.update({ where: { id }, data: i });
  await paudit(p, 'terminal.update', { entity: 'Terminal', entityId: id, detail: i });
  return t;
}

/** Allocate a terminal to a company (and optionally a branch). Returns the device API key once. */
export async function allocateTerminal(p: PCtx, id: string, tenantId: string, branchId?: string | null) {
  assertRole(p, 'ADMIN');
  const t = await db.terminal.findUniqueOrThrow({ where: { id } });
  if (t.status === 'RETIRED') throw badRequest('This terminal is retired.');
  if (t.tenantId && t.tenantId !== tenantId) throw badRequest('This terminal is allocated to another company. Return it first.');
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
  if (!tenant.plan.features.includes('terminals')) throw badRequest(`The ${tenant.plan.name} plan does not include terminals. Change the plan first.`);
  if (branchId) {
    const b = await db.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!b) throw badRequest('That branch is not in this company.');
  }
  const key = `trm_${randomToken(24)}`;
  await db.terminal.update({ where: { id }, data: { tenantId, branchId: branchId ?? null, status: 'ALLOCATED', allocatedAt: new Date(), apiKeyHash: sha256(key) } });
  await paudit(p, 'terminal.allocate', { tenantId, entity: 'Terminal', entityId: id, detail: { serialNo: t.serialNo, branchId } });
  return { apiKey: key };
}

export async function returnTerminal(p: PCtx, id: string) {
  assertRole(p, 'ADMIN');
  const t = await db.terminal.findUniqueOrThrow({ where: { id } });
  await db.terminal.update({ where: { id }, data: { tenantId: null, branchId: null, status: 'IN_STOCK', allocatedAt: null, apiKeyHash: null } });
  await paudit(p, 'terminal.return', { tenantId: t.tenantId ?? undefined, entity: 'Terminal', entityId: id, detail: { serialNo: t.serialNo } });
}

export async function rotateTerminalKey(p: PCtx, id: string) {
  assertRole(p, 'ADMIN');
  const t = await db.terminal.findUniqueOrThrow({ where: { id } });
  if (!t.tenantId) throw badRequest('Allocate the terminal first.');
  const key = `trm_${randomToken(24)}`;
  await db.terminal.update({ where: { id }, data: { apiKeyHash: sha256(key) } });
  await paudit(p, 'terminal.key.rotate', { tenantId: t.tenantId, entity: 'Terminal', entityId: id });
  return { apiKey: key };
}

// ─── Invoices ──────────────────────────────────────────────────

export async function listInvoices(q: { status?: string; tenantId?: string; period?: string }) {
  const rows = await db.invoice.findMany({
    where: {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.period ? { periodStart: new Date(`${q.period}-01T00:00:00Z`) } : {}),
    },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
    take: 500,
  });
  return rows.map((r) => ({ ...r, amount: r.amount.toFixed(2) }));
}

/** One invoice per active, non-demo company for the month. Safe to run twice. */
export async function generateInvoices(p: PCtx | null, period: string) {
  const { start, end } = monthRange(period);
  const tenants = await db.tenant.findMany({ where: { status: 'ACTIVE', isDemo: false }, include: { plan: true } });
  let created = 0;
  const terminalFees = await db.terminal.groupBy({ by: ['tenantId'], where: { status: 'ALLOCATED', tenantId: { not: null } }, _sum: { monthlyFee: true } });
  const feeMap = new Map(terminalFees.map((f) => [f.tenantId!, f._sum.monthlyFee ? toCents(f._sum.monthlyFee) : 0]));
  for (const t of tenants) {
    const exists = await db.invoice.findFirst({ where: { tenantId: t.id, periodStart: new Date(start + 'T00:00:00Z') } });
    if (exists) continue;
    const employees = await db.employee.count({ where: { tenantId: t.id, status: 'ACTIVE' } });
    const amount = monthlyPrice(t) + (feeMap.get(t.id) ?? 0);
    const seq = (await db.invoice.count({ where: { number: { startsWith: `INV-${period.replace('-', '')}` } } })) + 1;
    await db.invoice.create({
      data: {
        tenantId: t.id,
        number: `INV-${period.replace('-', '')}-${String(seq).padStart(4, '0')}`,
        periodStart: new Date(start + 'T00:00:00Z'),
        periodEnd: new Date(end + 'T00:00:00Z'),
        planCode: t.plan.code,
        employees,
        amount: fromCents(amount),
        dueDate: new Date(addDays(start, 14) + 'T00:00:00Z'),
      },
    });
    created++;
  }
  await paudit(p, 'invoice.generate', { detail: { period, created } });
  return { created };
}

export async function setInvoiceStatus(p: PCtx, id: string, status: 'PAID' | 'VOID' | 'DUE', reference?: string | null) {
  assertRole(p, 'ADMIN');
  const inv = await db.invoice.update({ where: { id }, data: { status, paidAt: status === 'PAID' ? new Date() : null, reference: reference ?? undefined } });
  await paudit(p, `invoice.${status.toLowerCase()}`, { tenantId: inv.tenantId, entity: 'Invoice', entityId: id, detail: { reference } });
  return inv;
}

// ─── Customer analytics ────────────────────────────────────────

export async function analytics() {
  const now = new Date();
  const day = 86_400_000;
  const tenants = await db.tenant.findMany({ include: { plan: true, _count: { select: { employees: { where: { status: 'ACTIVE' } } } } } });
  const real = tenants.filter((t) => !t.isDemo);
  const active = real.filter((t) => t.status === 'ACTIVE');
  const mrr = active.reduce((a, t) => a + monthlyPrice(t), 0);

  const byPlan = new Map<string, { plan: string; companies: number; mrr: number; employees: number }>();
  for (const t of active) {
    const r = byPlan.get(t.plan.code) ?? { plan: t.plan.name, companies: 0, mrr: 0, employees: 0 };
    r.companies++;
    r.mrr += monthlyPrice(t);
    r.employees += t._count.employees;
    byPlan.set(t.plan.code, r);
  }

  // new companies per month, last 12 months
  const months: { month: string; created: number; cancelled: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: d.toISOString().slice(0, 7), created: 0, cancelled: 0 });
  }
  for (const t of real) {
    const m = months.find((x) => x.month === t.createdAt.toISOString().slice(0, 7));
    if (m) m.created++;
    if (t.status === 'CANCELLED') {
      const c = months.find((x) => x.month === t.updatedAt.toISOString().slice(0, 7));
      if (c) c.cancelled++;
    }
  }

  const since30 = new Date(now.getTime() - 30 * day);
  const punchesRaw = await db.$queryRaw<{ d: string; n: bigint }[]>`
    SELECT to_char(("occurredAt" + interval '330 minutes')::date, 'YYYY-MM-DD') AS d, count(*)::bigint AS n
    FROM "PunchEvent" WHERE "receivedAt" >= ${since30} AND result = 'ACCEPTED'
    GROUP BY 1 ORDER BY 1`;
  const punchMap = new Map(punchesRaw.map((r) => [r.d, Number(r.n)]));
  const punchesPerDay = Array.from({ length: 30 }, (_, i) => {
    const d = colomboDate(new Date(now.getTime() - (29 - i) * day));
    return { date: d, punches: punchMap.get(d) ?? 0 };
  });

  const [users7, users30, totalUsers, invoicesDue, terminals, topUsage] = await Promise.all([
    db.user.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 7 * day) }, tenant: { isDemo: false } } }),
    db.user.count({ where: { lastSeenAt: { gte: since30 }, tenant: { isDemo: false } } }),
    db.user.count({ where: { tenant: { isDemo: false } } }),
    db.invoice.aggregate({ where: { status: 'DUE' }, _sum: { amount: true }, _count: true }),
    db.terminal.groupBy({ by: ['status'], _count: true }),
    db.punchEvent.groupBy({ by: ['tenantId'], where: { receivedAt: { gte: since30 } }, _count: true, orderBy: { _count: { tenantId: 'desc' } }, take: 10 }),
  ]);
  const overdue = await db.invoice.aggregate({ where: { status: 'DUE', dueDate: { lt: now } }, _sum: { amount: true }, _count: true });
  const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
  const convertedTrials = real.filter((t) => t.status === 'ACTIVE' && t.trialEndsAt).length;
  const trialsTotal = real.filter((t) => t.trialEndsAt).length;

  return {
    totals: {
      companies: real.length,
      active: active.length,
      trial: real.filter((t) => t.status === 'TRIAL').length,
      suspended: real.filter((t) => t.status === 'SUSPENDED').length,
      cancelled: real.filter((t) => t.status === 'CANCELLED').length,
      demos: tenants.filter((t) => t.isDemo).length,
      employees: real.reduce((a, t) => a + t._count.employees, 0),
      users: totalUsers,
      activeUsers7d: users7,
      activeUsers30d: users30,
      mrr: fromCents(mrr),
      arr: fromCents(mrr * 12),
      arpa: fromCents(active.length ? Math.round(mrr / active.length) : 0),
      invoicesDue: { count: invoicesDue._count, amount: invoicesDue._sum.amount?.toFixed(2) ?? '0.00' },
      overdue: { count: overdue._count, amount: overdue._sum.amount?.toFixed(2) ?? '0.00' },
      trialConversionPct: trialsTotal ? Math.round((convertedTrials / trialsTotal) * 100) : 0,
    },
    byPlan: [...byPlan.entries()].map(([code, r]) => ({ code, ...r, mrr: fromCents(r.mrr) })),
    months,
    punchesPerDay,
    terminals: Object.fromEntries(terminals.map((t) => [t.status, t._count])),
    trialsEnding: real
      .filter((t) => t.status === 'TRIAL' && t.trialEndsAt && t.trialEndsAt.getTime() - now.getTime() < 14 * day)
      .map((t) => ({ id: t.id, name: t.name, trialEndsAt: t.trialEndsAt, employees: t._count.employees })),
    nearLimit: real
      .filter((t) => t._count.employees >= t.plan.maxEmployees * 0.9)
      .map((t) => ({ id: t.id, name: t.name, employees: t._count.employees, max: t.plan.maxEmployees, plan: t.plan.name })),
    mostActive: topUsage.map((u) => ({ tenantId: u.tenantId, name: nameOf.get(u.tenantId) ?? '—', punches30d: u._count })),
  };
}

// ─── System settings and tax table ─────────────────────────────

export async function getSystemSettings() {
  const rows = await db.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r]));
  const settings = Object.entries(SYSTEM_DEFAULTS).map(([key, d]) => ({ key, value: map.get(key)?.value ?? d.value, note: d.note, isDefault: !map.has(key) }));
  const bands = await db.taxBand.findMany({ where: { table: 'APIT_MONTHLY' }, orderBy: [{ effectiveFrom: 'desc' }, { sortOrder: 'asc' }] });
  return { settings, taxBands: bands.map((b) => ({ ...b, fromAmount: b.fromAmount.toFixed(2), toAmount: b.toAmount?.toFixed(2) ?? null, ratePct: b.ratePct.toFixed(2), effectiveFrom: b.effectiveFrom.toISOString().slice(0, 10) })) };
}

export async function setSystemSetting(p: PCtx, key: string, value: unknown) {
  assertRole(p, 'SUPER_ADMIN');
  if (!(key in SYSTEM_DEFAULTS)) throw badRequest('Unknown setting.');
  await db.systemSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
  await paudit(p, 'system.setting', { entity: 'SystemSetting', entityId: key, detail: { value } });
}

export async function replaceTaxTable(p: PCtx, effectiveFrom: string, bands: { fromAmount: string; toAmount: string | null; ratePct: string }[]) {
  assertRole(p, 'SUPER_ADMIN');
  const sorted = [...bands].sort((a, b) => toCents(a.fromAmount) - toCents(b.fromAmount));
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.toAmount !== null && toCents(b.toAmount) <= toCents(b.fromAmount)) throw badRequest(`Band ${i + 1}: the upper amount must be above the lower amount.`);
    if (i > 0 && sorted[i - 1].toAmount !== b.fromAmount) throw badRequest(`Band ${i + 1} must start where band ${i} ends.`);
    if (i < sorted.length - 1 && b.toAmount === null) throw badRequest('Only the last band can have no upper amount.');
  }
  const date = new Date(effectiveFrom + 'T00:00:00Z');
  await db.$transaction([
    db.taxBand.deleteMany({ where: { table: 'APIT_MONTHLY', effectiveFrom: date } }),
    db.taxBand.createMany({ data: sorted.map((b, i) => ({ table: 'APIT_MONTHLY', effectiveFrom: date, sortOrder: i + 1, fromAmount: b.fromAmount, toAmount: b.toAmount, ratePct: b.ratePct })) }),
  ]);
  await paudit(p, 'system.taxTable', { detail: { effectiveFrom, bands: sorted } });
}

export async function listPublicPlans() {
  const plans = await db.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      priceMonthly: true,
      priceYearly: true,
      maxEmployees: true,
      sortOrder: true,
    },
  });
  return plans.map((pl) => ({
    code: pl.code,
    name: pl.name,
    description: pl.description,
    priceMonthly: pl.priceMonthly.toFixed(0),
    priceYearly: pl.priceYearly ? pl.priceYearly.toFixed(0) : null,
    maxEmployees: pl.maxEmployees,
    sortOrder: pl.sortOrder,
  }));
}

export async function platformAuditList(q: { tenantId?: string; adminId?: string; page: number; pageSize: number }) {
  const where: Prisma.PlatformAuditWhereInput = { ...(q.tenantId ? { tenantId: q.tenantId } : {}), ...(q.adminId ? { adminId: q.adminId } : {}) };
  const [rows, total] = await Promise.all([
    db.platformAudit.findMany({ where, include: { admin: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.platformAudit.count({ where }),
  ]);
  return { rows, total };
}
