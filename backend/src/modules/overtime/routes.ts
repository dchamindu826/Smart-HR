import { Router } from 'express';
import { parse, z, dateStr, optionalText, pageQuery } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { colomboDate } from '../../lib/time.js';
import * as svc from './service.js';

export const overtimeRouter = Router();

overtimeRouter.get('/', async (req, res) => {
  const q = parse(pageQuery.extend({ status: z.string().optional(), from: dateStr.optional(), to: dateStr.optional(), employeeId: z.string().optional(), kind: z.string().optional(), mine: z.enum(['1', '0']).optional() }), req.query);
  res.json(await svc.list(ctxOf(req), { ...q, mine: q.mine === '1' }));
});
overtimeRouter.get('/weekly', async (req, res) => {
  const q = parse(z.object({ week: dateStr.optional() }), req.query);
  res.json(await svc.weekly(ctxOf(req), q.week ?? colomboDate(new Date())));
});
overtimeRouter.post('/:id/reason', async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(10, 'Explain the overtime in at least 10 characters.').max(500) }), req.body);
  res.json(await svc.submitReason(ctxOf(req), req.params.id, b.reason));
});
overtimeRouter.post('/:id/decide', async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), note: optionalText(300), minutes: z.number().int().positive().optional() }), req.body);
  res.json(await svc.decide(ctxOf(req), req.params.id, b.approve, b.note, b.minutes));
});
