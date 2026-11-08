import { Router, type NextFunction, type Request, type Response } from 'express';
import { parse, z, money, optionalText, email, password, dateStr, periodStr, pageQuery } from '../../core/validate.js';
import { clientIp, COOKIE_PLATFORM, cookieOpts, rateLimit } from '../../core/auth.js';
import { forbidden, unauthorized } from '../../core/errors.js';
import { config } from '../../core/config.js';
import * as svc from './service.js';
import type { PCtx } from './service.js';

export const platformRouter = Router();

function pctx(req: Request): PCtx {
  const p = (req as Request & { pctx?: PCtx }).pctx;
  if (!p) throw unauthorized();
  return p;
}

async function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const raw = h?.startsWith('Platform ') ? h.slice(9) : (req.cookies as Record<string, string> | undefined)?.[COOKIE_PLATFORM];
  if (!raw) return next(unauthorized());
  if (!h && !['GET', 'HEAD'].includes(req.method) && !req.headers['x-smarthr-client']) return next(forbidden('Missing client header.'));
  const p = await svc.platformSession(raw);
  if (!p) return next(unauthorized('Your admin session has expired.'));
  p.ip = clientIp(req);
  (req as Request & { pctx?: PCtx }).pctx = p;
  next();
}

// ─── auth ──────────────────────────────────────────────────────

platformRouter.post('/auth/login', rateLimit('plogin', 10, 60_000), async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string().min(1), code: z.string().optional() }), req.body);
  const r = await svc.platformLogin(b.email, b.password, b.code, { ua: req.headers['user-agent'], ip: clientIp(req) });
  res.cookie(COOKIE_PLATFORM, r.token, cookieOpts(r.maxAgeMs, '/'));
  res.json({ ok: true, totpEnabled: r.totpEnabled });
});

platformRouter.post('/auth/logout', async (req, res) => {
  const raw = (req.cookies as Record<string, string> | undefined)?.[COOKIE_PLATFORM];
  if (raw) await svc.platformLogout(raw);
  res.clearCookie(COOKIE_PLATFORM, { path: '/' });
  res.json({ ok: true });
});

platformRouter.use(requirePlatform);

platformRouter.get('/me', (req, res) => {
  const p = pctx(req);
  res.json({ id: p.adminId, name: p.name, email: p.email, role: p.role });
});
platformRouter.post('/me/totp/setup', async (req, res) => res.json(await svc.totpSetup(pctx(req))));
platformRouter.post('/me/totp/enable', async (req, res) => {
  const b = parse(z.object({ code: z.string() }), req.body);
  await svc.totpEnable(pctx(req), b.code);
  res.json({ ok: true });
});
platformRouter.post('/me/password', async (req, res) => {
  const b = parse(z.object({ current: z.string(), next: password }), req.body);
  await svc.changeOwnPassword(pctx(req), b.current, b.next);
  res.json({ ok: true });
});

// ─── admins ────────────────────────────────────────────────────

const roleEnum = z.enum(['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'SALES']);
platformRouter.get('/admins', async (_req, res) => res.json(await svc.listAdmins()));
platformRouter.post('/admins', async (req, res) => {
  const b = parse(z.object({ email, name: z.string().trim().min(2).max(100), role: roleEnum }), req.body);
  res.status(201).json(await svc.createAdmin(pctx(req), b));
});
platformRouter.patch('/admins/:id', async (req, res) => {
  const b = parse(
    z.object({ name: z.string().trim().min(2).optional(), role: roleEnum.optional(), active: z.boolean().optional(), resetTotp: z.boolean().optional(), resetPassword: z.boolean().optional() }),
    req.body,
  );
  res.json(await svc.updateAdmin(pctx(req), req.params.id, b));
});

// ─── plans ─────────────────────────────────────────────────────

const planBody = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().trim().min(2).max(60),
  description: optionalText(300),
  priceMonthly: money,
  priceYearly: money.nullable().optional(),
  maxEmployees: z.number().int().min(1).max(100_000),
  features: z.array(z.string()),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
platformRouter.get('/plans', async (_req, res) => res.json(await svc.listPlans()));
platformRouter.post('/plans', async (req, res) => res.status(201).json(await svc.createPlan(pctx(req), parse(planBody, req.body))));
platformRouter.patch('/plans/:id', async (req, res) => res.json(await svc.updatePlan(pctx(req), req.params.id, parse(planBody.partial(), req.body))));

// ─── companies ─────────────────────────────────────────────────

platformRouter.get('/tenants', async (req, res) => {
  const q = parse(pageQuery.extend({ status: z.string().optional(), plan: z.string().optional(), demo: z.enum(['true', 'false']).optional() }), req.query);
  res.json(await svc.listTenants({ ...q, demo: q.demo === undefined ? undefined : q.demo === 'true' }));
});
platformRouter.get('/tenants/:id', async (req, res) => res.json(await svc.getTenant(req.params.id)));

const tenantCreate = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(30).optional(),
  planId: z.string(),
  status: z.enum(['TRIAL', 'ACTIVE']).default('TRIAL'),
  trialDays: z.number().int().min(1).max(90).optional(),
  isDemo: z.boolean().default(false),
  demoDays: z.number().int().min(1).max(60).optional(),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
  customPrice: money.nullable().optional(),
  discountPct: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  contactName: optionalText(100),
  phone: optionalText(30),
  email: optionalText(120),
  address: optionalText(300),
  industry: optionalText(60),
  owner: z.object({ name: z.string().trim().min(2).max(100), email, phone: optionalText(30), password: password.optional() }),
  sendWelcome: z.boolean().optional(),
});
platformRouter.post('/tenants', async (req, res) => res.status(201).json(await svc.createTenant(pctx(req), parse(tenantCreate, req.body))));

/** Demo account: a company filled with sample data, expiring after N days. */
platformRouter.post('/demos', async (req, res) => {
  const b = parse(
    z.object({ name: z.string().trim().min(2).max(120), planId: z.string(), demoDays: z.number().int().min(1).max(60).default(14), owner: z.object({ name: z.string().min(2), email, phone: optionalText(30) }) }),
    req.body,
  );
  res.status(201).json(await svc.createTenant(pctx(req), { ...b, isDemo: true, status: 'TRIAL', trialDays: b.demoDays }));
});
platformRouter.post('/tenants/:id/convert-demo', async (req, res) => {
  await svc.convertDemo(pctx(req), req.params.id);
  res.json({ ok: true });
});

platformRouter.patch('/tenants/:id', async (req, res) => {
  const b = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      planId: z.string().optional(),
      billingCycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
      customPrice: money.nullable().optional(),
      discountPct: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
      trialEndsAt: dateStr.nullable().optional(),
      demoExpiresAt: dateStr.nullable().optional(),
      contactName: optionalText(100),
      email: optionalText(120),
      phone: optionalText(30),
      address: optionalText(300),
      industry: optionalText(60),
    }),
    req.body,
  );
  res.json(await svc.updateTenant(pctx(req), req.params.id, b));
});
platformRouter.post('/tenants/:id/status', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'TRIAL']), reason: optionalText(300) }), req.body);
  res.json(await svc.setTenantStatus(pctx(req), req.params.id, b.status, b.reason));
});
platformRouter.post('/tenants/:id/users/:userId/reset-password', async (req, res) => {
  res.json(await svc.resetOwnerPassword(pctx(req), req.params.id, req.params.userId));
});

/** Read-only support view: sets a 30-minute company session cookie for this browser. */
platformRouter.post('/tenants/:id/support', async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(10, 'Write why you need to open this company (10+ characters).').max(300), reasonType: z.enum(['GENERAL', 'PAYROLL']) }), req.body);
  const r = await svc.startSupport(pctx(req), req.params.id, b.reason, b.reasonType);
  res.cookie('sh_at', r.accessToken, cookieOpts(30 * 60_000));
  res.json({ ok: true, expiresAt: r.expiresAt, sessionId: r.sessionId, url: `${config.APP_URL}/dashboard` });
});
platformRouter.post('/support/:sessionId/end', async (req, res) => {
  await svc.endSupport(pctx(req), req.params.sessionId);
  res.clearCookie('sh_at', { path: '/' });
  res.json({ ok: true });
});

// ─── terminals ─────────────────────────────────────────────────

platformRouter.get('/terminals', async (req, res) => {
  const q = parse(z.object({ status: z.string().optional(), tenantId: z.string().optional(), q: z.string().optional() }), req.query);
  res.json(await svc.listTerminals(q));
});
platformRouter.post('/terminals', async (req, res) => {
  const b = parse(z.object({ serialNo: z.string().trim().min(3).max(60), model: z.string().trim().min(2).max(60), name: optionalText(60), monthlyFee: money.nullable().optional(), notes: optionalText(300) }), req.body);
  res.status(201).json(await svc.createTerminal(pctx(req), b));
});
platformRouter.patch('/terminals/:id', async (req, res) => {
  const b = parse(z.object({ name: optionalText(60), model: z.string().optional(), monthlyFee: money.nullable().optional(), notes: optionalText(300), status: z.enum(['IN_STOCK', 'REPAIR', 'RETIRED']).optional() }), req.body);
  res.json(await svc.updateTerminal(pctx(req), req.params.id, b));
});
platformRouter.post('/terminals/:id/allocate', async (req, res) => {
  const b = parse(z.object({ tenantId: z.string(), branchId: z.string().nullable().optional() }), req.body);
  res.json(await svc.allocateTerminal(pctx(req), req.params.id, b.tenantId, b.branchId));
});
platformRouter.post('/terminals/:id/return', async (req, res) => {
  await svc.returnTerminal(pctx(req), req.params.id);
  res.json({ ok: true });
});
platformRouter.post('/terminals/:id/rotate-key', async (req, res) => res.json(await svc.rotateTerminalKey(pctx(req), req.params.id)));

// ─── invoices ──────────────────────────────────────────────────

platformRouter.get('/invoices', async (req, res) => {
  const q = parse(z.object({ status: z.string().optional(), tenantId: z.string().optional(), period: periodStr.optional() }), req.query);
  res.json(await svc.listInvoices(q));
});
platformRouter.post('/invoices/generate', async (req, res) => {
  const b = parse(z.object({ period: periodStr }), req.body);
  res.json(await svc.generateInvoices(pctx(req), b.period));
});
platformRouter.post('/invoices/:id/status', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['PAID', 'VOID', 'DUE']), reference: optionalText(100) }), req.body);
  res.json(await svc.setInvoiceStatus(pctx(req), req.params.id, b.status, b.reference));
});

// ─── analytics, settings, audit ────────────────────────────────

platformRouter.get('/analytics', async (_req, res) => res.json(await svc.analytics()));
platformRouter.get('/system', async (_req, res) => res.json(await svc.getSystemSettings()));
platformRouter.put('/system/:key', async (req, res) => {
  await svc.setSystemSetting(pctx(req), req.params.key, req.body?.value);
  res.json({ ok: true });
});
platformRouter.put('/system-tax-table', async (req, res) => {
  const b = parse(
    z.object({ effectiveFrom: dateStr, bands: z.array(z.object({ fromAmount: money, toAmount: money.nullable(), ratePct: z.union([z.string(), z.number()]).transform(String) })).min(1).max(20) }),
    req.body,
  );
  await svc.replaceTaxTable(pctx(req), b.effectiveFrom, b.bands);
  res.json({ ok: true });
});
platformRouter.get('/audit', async (req, res) => {
  const q = parse(pageQuery.extend({ tenantId: z.string().optional(), adminId: z.string().optional() }), req.query);
  res.json(await svc.platformAuditList(q));
});
