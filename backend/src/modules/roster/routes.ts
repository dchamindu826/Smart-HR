import { Router } from 'express';
import { parse, z, dateStr, minute, optionalText } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { addDays, colomboDate, weekStart } from '../../lib/time.js';
import * as svc from './service.js';

export const shiftsRouter = Router();
export const rosterRouter = Router();

const block = z.object({ start: minute, end: minute });
const patternBody = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(60),
  blocks: z.array(block).min(1).max(4),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  active: z.boolean().optional(),
});

shiftsRouter.get('/', async (req, res) => res.json(await svc.listPatterns(ctxOf(req))));
shiftsRouter.post('/', async (req, res) => res.status(201).json(await svc.createPattern(ctxOf(req), parse(patternBody, req.body))));
shiftsRouter.patch('/:id', async (req, res) => res.json(await svc.updatePattern(ctxOf(req), req.params.id, parse(patternBody.partial(), req.body))));
shiftsRouter.delete('/:id', async (req, res) => {
  await svc.deletePattern(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

// ─── groups ────────────────────────────────────────────────────

const groupBody = z.object({
  name: z.string().trim().min(2).max(80),
  makerId: z.string(),
  approverId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).max(1000),
  active: z.boolean().optional(),
});
rosterRouter.get('/groups', async (req, res) => res.json(await svc.listGroups(ctxOf(req))));
rosterRouter.post('/groups', async (req, res) => res.status(201).json(await svc.createGroup(ctxOf(req), parse(groupBody, req.body))));
rosterRouter.patch('/groups/:id', async (req, res) => res.json(await svc.updateGroup(ctxOf(req), req.params.id, parse(groupBody.partial(), req.body))));
rosterRouter.delete('/groups/:id', async (req, res) => {
  await svc.deleteGroup(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

rosterRouter.get('/pending', async (req, res) => res.json(await svc.pendingForMe(ctxOf(req))));

/** The signed-in employee's published roster (app). */
rosterRouter.get('/mine', async (req, res) => {
  const today = colomboDate(new Date());
  const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
  const from = q.from ?? weekStart(today);
  const to = q.to ?? addDays(from, 13);
  res.json(await svc.myRoster(ctxOf(req), from, to));
});

// ─── weeks ─────────────────────────────────────────────────────

const wk = (req: import('express').Request) => parse(z.object({ groupId: z.string(), weekStart: dateStr }), req.params);

rosterRouter.get('/groups/:groupId/weeks/:weekStart', async (req, res) => {
  const p = wk(req);
  res.json(await svc.getWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.put('/groups/:groupId/weeks/:weekStart/days', async (req, res) => {
  const p = wk(req);
  const b = parse(
    z.object({
      days: z
        .array(
          z.object({
            employeeId: z.string(),
            date: dateStr,
            isOff: z.boolean().optional(),
            shiftPatternId: z.string().nullable().optional(),
            blocks: z.array(block.extend({ mode: z.enum(['OFFICE', 'REMOTE']).optional() })).max(4).optional(),
            note: optionalText(200),
          }),
        )
        .max(5000),
    }),
    req.body,
  );
  await svc.saveDays(ctxOf(req), p.groupId, p.weekStart, b.days);
  res.json(await svc.getWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/fill', async (req, res) => {
  const p = wk(req);
  await svc.fillDefaults(ctxOf(req), p.groupId, p.weekStart);
  res.json(await svc.getWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/copy-previous', async (req, res) => {
  const p = wk(req);
  await svc.copyPreviousWeek(ctxOf(req), p.groupId, p.weekStart);
  res.json(await svc.getWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/submit', async (req, res) => {
  const p = wk(req);
  res.json(await svc.submitWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/withdraw', async (req, res) => {
  const p = wk(req);
  res.json(await svc.withdrawWeek(ctxOf(req), p.groupId, p.weekStart));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/decide', async (req, res) => {
  const p = wk(req);
  const b = parse(z.object({ approve: z.boolean(), note: optionalText(500) }), req.body);
  res.json(await svc.decideWeek(ctxOf(req), p.groupId, p.weekStart, b.approve, b.note));
});
rosterRouter.post('/groups/:groupId/weeks/:weekStart/publish', async (req, res) => {
  const p = wk(req);
  res.json(await svc.publishWeek(ctxOf(req), p.groupId, p.weekStart));
});
