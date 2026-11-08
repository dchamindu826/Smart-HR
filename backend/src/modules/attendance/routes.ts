import { Router } from 'express';
import { parse, z, dateStr, periodStr } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { rateLimit, sha256 } from '../../core/auth.js';
import { db } from '../../core/db.js';
import { forbidden, unauthorized } from '../../core/errors.js';
import { colomboDate } from '../../lib/time.js';
import * as svc from './service.js';
import { closeTenantDay } from './dayclose.js';
import { assertCan } from '../../core/permissions.js';

export const attendanceRouter = Router();
export const terminalRouter = Router();

const punchBody = z.object({
  clientId: z.string().min(8).max(64),
  kind: z.enum(['IN', 'OUT']),
  mode: z.enum(['OFFICE', 'REMOTE']).default('OFFICE'),
  occurredAt: z.coerce.date(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  accuracyM: z.number().min(0).max(100_000).nullable().optional(),
  mocked: z.boolean().optional(),
  faceScore: z.number().min(0).max(1).nullable().optional(),
  faceVerified: z.boolean().nullable().optional(),
});

/** App: one punch. */
attendanceRouter.post('/punch', rateLimit('punch', 30, 60_000), async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(punchBody, req.body);
  const r = await svc.punch(ctx, b, req.headers['x-smarthr-client'] === 'web' ? 'WEB' : 'APP');
  if (r.result === 'ACCEPTED' || r.result === 'DUPLICATE') return res.json({ ...r, today: await svc.today(ctx) });
  res.status(422).json({ error: { code: 'PUNCH_REJECTED', message: r.reason }, ...r });
});

/** App: the offline queue. */
attendanceRouter.post('/sync', rateLimit('sync', 20, 60_000), async (req, res) => {
  const ctx = ctxOf(req);
  const b = parse(z.object({ punches: z.array(punchBody).min(1).max(200) }), req.body);
  const results = await svc.sync(ctx, b.punches);
  res.json({ results, today: await svc.today(ctx) });
});

attendanceRouter.get('/today', async (req, res) => res.json(await svc.today(ctxOf(req))));

attendanceRouter.get('/day', async (req, res) => {
  const q = parse(z.object({ date: dateStr.optional(), branchId: z.string().optional(), departmentId: z.string().optional(), status: z.string().optional(), q: z.string().optional() }), req.query);
  res.json(await svc.dayBoard(ctxOf(req), q.date ?? colomboDate(new Date()), q));
});

attendanceRouter.get('/month', async (req, res) => {
  const ctx = ctxOf(req);
  const q = parse(z.object({ employeeId: z.string().optional(), period: periodStr.optional() }), req.query);
  const employeeId = q.employeeId ?? ctx.employeeId;
  if (!employeeId) throw forbidden('Choose an employee.');
  res.json(await svc.employeeMonth(ctx, employeeId, q.period ?? colomboDate(new Date()).slice(0, 7)));
});

attendanceRouter.post('/sessions', async (req, res) => {
  const b = parse(
    z.object({ employeeId: z.string(), date: dateStr, start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), mode: z.enum(['OFFICE', 'REMOTE']), reason: z.string().trim().min(5).max(300) }),
    req.body,
  );
  res.status(201).json(await svc.addManualSession(ctxOf(req), b));
});
attendanceRouter.delete('/sessions/:id', async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body ?? {});
  await svc.deleteSession(ctxOf(req), req.params.id, b.reason);
  res.json({ ok: true });
});

attendanceRouter.get('/corrections', async (req, res) => {
  const q = parse(z.object({ status: z.string().optional(), mine: z.enum(['1', '0']).optional() }), req.query);
  res.json(await svc.listCorrections(ctxOf(req), { status: q.status, mine: q.mine === '1' }));
});
attendanceRouter.post('/corrections', async (req, res) => {
  const b = parse(
    z.object({ date: dateStr, start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), mode: z.enum(['OFFICE', 'REMOTE']), reason: z.string().trim().min(10).max(500), sessionId: z.string().nullable().optional() }),
    req.body,
  );
  res.status(201).json(await svc.requestCorrection(ctxOf(req), b));
});
attendanceRouter.post('/corrections/:id/decide', async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), note: z.string().max(300).nullable().optional() }), req.body);
  res.json(await svc.decideCorrection(ctxOf(req), req.params.id, b.approve, b.note));
});

/** HR: re-run the day close for a past date (after fixing a roster or a holiday). */
attendanceRouter.post('/recalculate', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'attendance.correct');
  const b = parse(z.object({ date: dateStr }), req.body);
  if (b.date >= colomboDate(new Date())) throw forbidden('Only past days can be recalculated.');
  res.json({ employees: await closeTenantDay(ctx.tenantId, b.date) });
});

// ─── Terminal ingest (no user login; the device key authenticates) ──

terminalRouter.post('/punches', rateLimit('terminal', 120, 60_000), async (req, res) => {
  const key = req.headers['x-terminal-key'];
  if (typeof key !== 'string' || !key.startsWith('trm_')) throw unauthorized('Missing terminal key.');
  const t = await db.terminal.findUnique({ where: { apiKeyHash: sha256(key) } });
  if (!t || t.status !== 'ALLOCATED' || !t.tenantId) throw unauthorized('Unknown or unallocated terminal.');
  const b = parse(z.object({ punches: z.array(z.object({ clientId: z.string().min(1).max(64), empNo: z.string().min(1).max(20), occurredAt: z.coerce.date() })).min(1).max(500) }), req.body);
  res.json({ results: await svc.terminalPunches({ id: t.id, tenantId: t.tenantId, branchId: t.branchId }, b.punches) });
});

terminalRouter.get('/ping', async (req, res) => {
  const key = req.headers['x-terminal-key'];
  if (typeof key !== 'string') throw unauthorized();
  const t = await db.terminal.findUnique({ where: { apiKeyHash: sha256(key) }, select: { id: true, serialNo: true, tenantId: true } });
  if (!t) throw unauthorized();
  await db.terminal.update({ where: { id: t.id }, data: { lastSeenAt: new Date() } });
  res.json({ ok: true, serialNo: t.serialNo, serverTime: new Date().toISOString() });
});
