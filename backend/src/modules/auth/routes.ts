import { Router } from 'express';
import { parse, z, password } from '../../core/validate.js';
import { clearWebCookies, clientIp, COOKIE_REFRESH, rateLimit, requireAuth, setWebCookies } from '../../core/auth.js';
import { ctxOf } from '../../core/context.js';
import * as svc from './service.js';

export const authRouter = Router();
export const meRouter = Router();

const meta = (req: import('express').Request) => ({ ua: req.headers['user-agent'], ip: clientIp(req) ?? undefined });

authRouter.post('/login', rateLimit('login', 20, 60_000), async (req, res) => {
  const b = parse(
    z.object({
      login: z.string().trim().min(3).max(120),
      password: z.string().min(1).max(200),
      company: z.string().trim().max(60).optional(),
      client: z.enum(['web', 'mobile']).default('web'),
    }),
    req.body,
  );
  const r = await svc.login(b, meta(req));
  if (b.client === 'web') {
    setWebCookies(res, r.accessToken, r.refreshToken);
    return res.json({ ok: true, mustChangePassword: r.mustChangePassword });
  }
  res.json(r);
});

authRouter.post('/refresh', rateLimit('refresh', 60, 60_000), async (req, res) => {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
  const raw = (req.body?.refreshToken as string | undefined) ?? cookie;
  if (!raw) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Please log in.' } });
  const r = await svc.refresh(raw, meta(req));
  if (cookie && !req.body?.refreshToken) {
    setWebCookies(res, r.accessToken, r.refreshToken);
    return res.json({ ok: true });
  }
  res.json(r);
});

authRouter.post('/logout', async (req, res) => {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE_REFRESH];
  await svc.logout((req.body?.refreshToken as string | undefined) ?? cookie);
  clearWebCookies(res);
  res.json({ ok: true });
});

authRouter.post('/forgot-password', rateLimit('forgot', 5, 60_000), async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().email(), company: z.string().optional() }), req.body);
  await svc.forgotPassword(b.email, b.company);
  res.json({ ok: true, message: 'If this email has an account, a reset link is on its way.' });
});

authRouter.post('/reset-password', rateLimit('reset', 10, 60_000), async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10), password }), req.body);
  await svc.resetPassword(b.token, b.password);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1), next: password }), req.body);
  await svc.changePassword(ctxOf(req), b.current, b.next);
  res.json({ ok: true });
});

meRouter.use(requireAuth);
meRouter.get('/', async (req, res) => {
  res.json(await svc.me(ctxOf(req)));
});
meRouter.post('/push-token', async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(500), platform: z.enum(['android', 'ios']) }), req.body);
  await svc.savePushToken(ctxOf(req), b.token, b.platform);
  res.json({ ok: true });
});
meRouter.delete('/push-token', async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(500) }), req.body);
  await svc.removePushToken(ctxOf(req), b.token);
  res.json({ ok: true });
});
