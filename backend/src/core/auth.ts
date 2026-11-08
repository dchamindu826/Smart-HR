/**
 * Authentication.
 *   Web:    access JWT (15 min) + refresh token (30 days) in httpOnly cookies.
 *   Mobile: the same tokens in the JSON body; sent as "Authorization: Bearer".
 * Refresh tokens rotate on every use. Re-using an old one revokes the whole family.
 * Platform admins use a separate opaque session cookie (see platform module).
 */

import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { db } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { readSettings } from './settings.js';
import type { Ctx } from './context.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 86_400_000;
export const COOKIE_ACCESS = 'sh_at';
export const COOKIE_REFRESH = 'sh_rt';
export const COOKIE_PLATFORM = 'sh_pa';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** A readable temporary password, e.g. "Kite-4821-Moon". */
export function tempPassword(): string {
  const words = ['Lotus', 'River', 'Mango', 'Tiger', 'Cloud', 'Pearl', 'Ocean', 'Maple', 'Coral', 'Amber', 'Delta', 'Falcon'];
  const w = () => words[randomBytes(1)[0] % words.length];
  const n = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
  return `${w()}-${n}-${w()}`;
}

export interface AccessClaims {
  sub: string;
  tid: string;
  role: string;
  sup?: string; // support session id (platform admin viewing a tenant)
}

export async function signAccess(c: AccessClaims, ttlS = ACCESS_TTL_S): Promise<string> {
  return new SignJWT({ tid: c.tid, role: c.role, ...(c.sup ? { sup: c.sup } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .setIssuer('smarthr')
    .setAudience('smarthr-api')
    .sign(secret);
}

export async function verifyAccess(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: 'smarthr', audience: 'smarthr-api' });
    if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') return null;
    return { sub: payload.sub, tid: payload.tid, role: String(payload.role), sup: typeof payload.sup === 'string' ? payload.sup : undefined };
  } catch {
    return null;
  }
}

/** Short-lived signed token for password reset; dies when the password changes. */
export async function signReset(userId: string, passwordHash: string): Promise<string> {
  return new SignJWT({ pwh: sha256(passwordHash).slice(0, 16), typ: 'reset' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('30m')
    .sign(secret);
}

export async function verifyReset(token: string): Promise<{ userId: string; pwh: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.typ !== 'reset' || typeof payload.sub !== 'string') return null;
    return { userId: payload.sub, pwh: String(payload.pwh) };
  } catch {
    return null;
  }
}

export async function issueRefresh(userId: string, kind: 'WEB' | 'MOBILE', meta: { ua?: string; ip?: string }, family?: string) {
  const raw = randomToken(48);
  const row = await db.refreshToken.create({
    data: {
      userId,
      kind,
      tokenHash: sha256(raw),
      family: family ?? randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: meta.ua?.slice(0, 300),
      ip: meta.ip ?? undefined,
    },
  });
  return { raw, row };
}

/** Rotates a refresh token. Returns null if invalid; revokes the family on reuse. */
export async function rotateRefresh(raw: string, meta: { ua?: string; ip?: string }) {
  const row = await db.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!row) return null;
  if (row.revokedAt) {
    // two tabs refreshing at the same moment: not theft, just say no
    if (Date.now() - row.revokedAt.getTime() < 15_000) return null;
    // a used token came back: someone copied it. Kill every token in the family.
    await db.refreshToken.updateMany({ where: { family: row.family, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }
  if (row.expiresAt < new Date()) return null;
  // claim the token atomically so two simultaneous refreshes cannot both succeed
  const claimed = await db.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (claimed.count !== 1) return null;
  const next = await issueRefresh(row.userId, row.kind, meta, row.family);
  await db.refreshToken.update({ where: { id: row.id }, data: { replacedBy: next.row.id } });
  return { userId: row.userId, kind: row.kind, raw: next.raw };
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function cookieOpts(maxAgeMs: number, path = '/') {
  return { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax' as const, path, maxAge: maxAgeMs };
}

export function setWebCookies(res: Response, access: string, refresh: string) {
  res.cookie(COOKIE_ACCESS, access, cookieOpts(ACCESS_TTL_S * 1000));
  res.cookie(COOKIE_REFRESH, refresh, cookieOpts(REFRESH_TTL_MS, '/api/v1/auth'));
}

export function clearWebCookies(res: Response) {
  res.clearCookie(COOKIE_ACCESS, { path: '/' });
  res.clearCookie(COOKIE_REFRESH, { path: '/api/v1/auth' });
}

export function clientIp(req: Request): string | null {
  return (req.headers['x-real-ip'] as string) ?? req.ip ?? null;
}

function tokenFrom(req: Request): { token: string | null; viaCookie: boolean } {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return { token: h.slice(7), viaCookie: false };
  const c = (req.cookies as Record<string, string> | undefined)?.[COOKIE_ACCESS];
  return { token: c ?? null, viaCookie: !!c };
}

/** Paths a suspended company may still write to. */
const SUSPENDED_WRITABLE = ['/api/v1/auth/', '/api/v1/attendance/punch', '/api/v1/attendance/sync', '/api/v1/notifications', '/api/v1/me/'];

/** Express middleware: sets req.ctx for a logged-in company user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const { token, viaCookie } = tokenFrom(req);
  if (!token) return next(unauthorized());
  const claims = await verifyAccess(token);
  if (!claims) return next(unauthorized('Your session has expired. Please log in again.'));

  // Cookie auth + a state-changing method must carry our custom header (CSRF guard).
  if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers['x-smarthr-client']) {
    return next(forbidden('Missing client header.'));
  }

  const user = await db.user.findUnique({
    where: { id: claims.sub },
    include: { tenant: { include: { plan: true } } },
  });
  if (!user || user.tenantId !== claims.tid) return next(unauthorized());

  let support: Ctx['support'];
  let supportName: string | undefined;
  if (claims.sup) {
    const s = await db.supportSession.findUnique({ where: { id: claims.sup }, include: { admin: { select: { name: true, active: true } } } });
    if (!s || s.endedAt || s.expiresAt < new Date() || s.tenantId !== user.tenantId || !s.admin.active) return next(unauthorized('The support session has ended.'));
    support = { adminId: s.adminId, sessionId: s.id, reasonType: s.reasonType };
    supportName = s.admin.name;
  } else if (!user.active) {
    return next(unauthorized('Your account is disabled. Contact HR.'));
  }

  const t = user.tenant;
  if (t.status === 'CANCELLED' && !support) return next(forbidden('This company account is closed.'));
  if (t.isDemo && t.demoExpiresAt && t.demoExpiresAt < new Date() && !support) return next(forbidden('This demo account has expired. Contact Lumi AI to start your subscription.'));
  if (t.status === 'SUSPENDED' && !support && !['GET', 'HEAD'].includes(req.method) && !SUSPENDED_WRITABLE.some((p) => req.originalUrl.startsWith(p))) {
    return next(forbidden('This account is suspended. Staff can still mark attendance. Contact Lumi AI to reactivate.'));
  }

  const ctx: Ctx = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    name: supportName ?? user.name,
    employeeId: support ? null : user.employeeId,
    branchScope: user.branchScope,
    deptScope: user.deptScope,
    features: new Set(t.plan.features),
    planCode: t.plan.code,
    tenantStatus: t.status,
    settings: readSettings(t.settings),
    ip: clientIp(req),
    support,
  };
  (req as Request & { ctx?: Ctx }).ctx = ctx;

  // last seen, at most once a minute
  if (!support && (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 60_000)) {
    db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  next();
}

/** For console routes: the role must be allowed into the web console. */
export function consoleOnly(req: Request, _res: Response, next: NextFunction) {
  const ctx = (req as Request & { ctx?: Ctx }).ctx;
  if (!ctx) return next(unauthorized());
  if (ctx.role === 'EMPLOYEE' && !ctx.support) return next(forbidden('The web console is for HR and managers. Use the SmartHR app.'));
  next();
}

// ─── Simple in-memory rate limiter (one server process) ────────

const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) {
      buckets.set(key, { n: 1, reset: now + windowMs });
      return next();
    }
    b.n++;
    if (b.n > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
      return res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many attempts. Wait a minute and try again.' } });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();
