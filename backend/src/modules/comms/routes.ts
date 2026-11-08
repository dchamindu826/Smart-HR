import { Router } from 'express';
import { parse, z, optionalText } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { db } from '../../core/db.js';
import * as svc from './service.js';

export const announcementsRouter = Router();
export const messagesRouter = Router();
export const notificationsRouter = Router();

announcementsRouter.get('/', async (req, res) => res.json(await svc.feed(ctxOf(req))));
announcementsRouter.post('/', async (req, res) => {
  const b = parse(
    z.object({
      title: z.string().trim().min(3).max(120),
      body: z.string().trim().min(3).max(5000),
      audience: z.enum(['ALL', 'BRANCHES', 'DEPARTMENTS']).default('ALL'),
      branchIds: z.array(z.string()).max(100).optional(),
      departmentIds: z.array(z.string()).max(100).optional(),
      pinned: z.boolean().optional(),
      requireAck: z.boolean().optional(),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
      push: z.boolean().optional(),
    }),
    req.body,
  );
  res.status(201).json(await svc.post(ctxOf(req), b));
});
announcementsRouter.delete('/:id', async (req, res) => {
  await svc.remove(ctxOf(req), req.params.id);
  res.json({ ok: true });
});
announcementsRouter.post('/:id/read', async (req, res) => res.json(await svc.markRead(ctxOf(req), req.params.id, !!req.body?.acknowledge)));
announcementsRouter.get('/:id/readers', async (req, res) => res.json(await svc.readers(ctxOf(req), req.params.id)));

messagesRouter.get('/people', async (req, res) => res.json(await svc.people(ctxOf(req), req.query.q as string | undefined)));
messagesRouter.get('/unread', async (req, res) => res.json({ unread: await svc.unreadCount(ctxOf(req)) }));
messagesRouter.get('/', async (req, res) => res.json(await svc.conversations(ctxOf(req))));
messagesRouter.post('/', async (req, res) => {
  const b = parse(z.object({ userIds: z.array(z.string()).min(1).max(200), title: optionalText(80) }), req.body);
  res.status(201).json(await svc.startConversation(ctxOf(req), b));
});
messagesRouter.get('/:id', async (req, res) => res.json(await svc.messages(ctxOf(req), req.params.id, req.query.since as string | undefined, req.query.before as string | undefined)));
messagesRouter.post('/:id', async (req, res) => {
  const b = parse(z.object({ body: z.string().min(1).max(4000) }), req.body);
  res.status(201).json(await svc.send(ctxOf(req), req.params.id, b.body));
});
messagesRouter.delete('/message/:messageId', async (req, res) => {
  await svc.deleteMessage(ctxOf(req), req.params.messageId);
  res.json({ ok: true });
});

// ─── notifications ─────────────────────────────────────────────

notificationsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const unreadOnly = req.query.unread === '1';
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: ctx.userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  res.json({ unread, rows });
});
notificationsRouter.post('/read-all', async (req, res) => {
  const ctx = ctxOf(req);
  await db.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
notificationsRouter.post('/:id/read', async (req, res) => {
  const ctx = ctxOf(req);
  await db.notification.updateMany({ where: { id: req.params.id, userId: ctx.userId }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
