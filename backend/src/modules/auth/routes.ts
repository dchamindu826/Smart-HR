import { Router } from 'express';
import { parse, z, password } from '../../core/validate.js';
import { clearWebCookies, clientIp, COOKIE_REFRESH, rateLimit, requireAuth, setWebCookies } from '../../core/auth.js';
import { ctxOf } from '../../core/context.js';
import { upload, streamFile } from '../../core/files.js';
import { badRequest } from '../../core/errors.js';
import { colomboDate } from '../../lib/time.js';
import * as emp from '../employees/service.js';
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

meRouter.post('/deletion-request', async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().max(500).optional().nullable() }), req.body ?? {});
  res.json(await svc.requestDeletion(ctxOf(req), b.reason ?? null));
});
const myEmployeeId = (req: import('express').Request) => {
  const id = ctxOf(req).employeeId;
  if (!id) throw badRequest('This login is not linked to an employee.');
  return id;
};
meRouter.post('/photo', upload.single('file'), async (req, res) => res.json(await emp.setPhoto(ctxOf(req), myEmployeeId(req), req.file)));
meRouter.delete('/photo', async (req, res) => res.json(await emp.removePhoto(ctxOf(req), myEmployeeId(req))));
meRouter.get('/photo', async (req, res) => {
  const f = await emp.photoFile(ctxOf(req), myEmployeeId(req));
  res.setHeader('cache-control', 'private, no-cache');
  streamFile(res, f.path, f.mimeType);
});
meRouter.get('/people/:employeeId/photo', async (req, res) => {
  const f = await emp.photoFile(ctxOf(req), req.params.employeeId as string);
  res.setHeader('cache-control', 'private, max-age=300');
  streamFile(res, f.path, f.mimeType);
});
meRouter.patch('/preferences', async (req, res) => {
  const b = parse(z.object({ birthdayOptOut: z.boolean() }), req.body);
  res.json(await svc.setBirthdayHidden(ctxOf(req), b.birthdayOptOut));
});
meRouter.get('/birthdays', async (req, res) => {
  res.json(await emp.birthdays(ctxOf(req), colomboDate(new Date()), 7));
});
