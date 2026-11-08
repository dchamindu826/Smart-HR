import { Router } from 'express';
import { parse, z, dateStr } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import * as svc from './service.js';

export const holidaysRouter = Router();

const kind = z.enum(['POYA', 'GAZETTED', 'COMPANY', 'WEEKLY', 'CUSTOM']);
const body = z.object({
  date: dateStr,
  name: z.string().trim().min(2).max(80),
  kind,
  multiplier: z.union([z.string(), z.number()]).transform((v) => Number(v).toFixed(2)).optional(),
  isPaidOff: z.boolean().optional(),
  branchId: z.string().nullable().optional(),
});

holidaysRouter.get('/', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json(await svc.listHolidays(ctxOf(req), year));
});
holidaysRouter.get('/defaults', (_req, res) => res.json(svc.DEFAULT_MULTIPLIER));
holidaysRouter.post('/', async (req, res) => res.status(201).json(await svc.createHoliday(ctxOf(req), parse(body, req.body))));
holidaysRouter.post('/bulk', async (req, res) => res.json(await svc.bulkAdd(ctxOf(req), parse(z.object({ items: z.array(body).max(200) }), req.body).items)));
holidaysRouter.post('/copy-year', async (req, res) => {
  const b = parse(z.object({ fromYear: z.number().int().min(2000).max(2100), toYear: z.number().int().min(2000).max(2100) }), req.body);
  res.json(await svc.copyYear(ctxOf(req), b.fromYear, b.toYear));
});
holidaysRouter.patch('/:id', async (req, res) => res.json(await svc.updateHoliday(ctxOf(req), req.params.id, parse(body.partial(), req.body))));
holidaysRouter.delete('/:id', async (req, res) => {
  await svc.deleteHoliday(ctxOf(req), req.params.id);
  res.json({ ok: true });
});
