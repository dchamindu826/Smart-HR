import { Router } from 'express';
import { parse, z, money, optionalText, dateStr } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import * as svc from './service.js';

export const assetsRouter = Router();

const body = z.object({
  tag: z.string().trim().max(20).optional(),
  name: z.string().trim().min(2).max(100),
  category: z.enum(svc.CATEGORIES),
  brand: optionalText(60),
  model: optionalText(60),
  serialNo: optionalText(60),
  purchaseDate: dateStr.nullable().optional(),
  cost: money.nullable().optional(),
  warrantyTo: dateStr.nullable().optional(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR']).nullable().optional(),
  branchId: z.string().nullable().optional(),
  notes: optionalText(500),
  status: z.enum(['IN_STOCK', 'REPAIR', 'LOST', 'RETIRED']).optional(),
});

assetsRouter.get('/categories', (_req, res) => res.json(svc.CATEGORIES));
assetsRouter.get('/mine', async (req, res) => res.json(await svc.mine(ctxOf(req))));
assetsRouter.get('/requests', async (req, res) => res.json(await svc.listRequests(ctxOf(req), req.query.status as string | undefined)));
assetsRouter.post('/requests', async (req, res) => {
  const b = parse(z.object({ category: z.enum(svc.CATEGORIES), item: z.string().trim().min(2).max(100), reason: z.string().trim().min(5).max(500), neededBy: dateStr.nullable().optional(), employeeId: z.string().optional() }), req.body);
  res.status(201).json(await svc.request(ctxOf(req), b));
});
assetsRouter.post('/requests/:id/decide', async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), note: optionalText(300), assetId: z.string().nullable().optional() }), req.body);
  res.json(await svc.decideRequest(ctxOf(req), req.params.id, b.approve, b.note, b.assetId));
});

assetsRouter.get('/', async (req, res) => res.json(await svc.list(ctxOf(req), parse(z.object({ status: z.string().optional(), category: z.string().optional(), q: z.string().optional(), assignedToId: z.string().optional() }), req.query))));
assetsRouter.post('/', async (req, res) => res.status(201).json(await svc.create(ctxOf(req), parse(body, req.body))));
assetsRouter.patch('/:id', async (req, res) => res.json(await svc.update(ctxOf(req), req.params.id, parse(body.partial(), req.body))));
assetsRouter.delete('/:id', async (req, res) => {
  await svc.remove(ctxOf(req), req.params.id);
  res.json({ ok: true });
});
assetsRouter.post('/:id/assign', async (req, res) => {
  const b = parse(z.object({ employeeId: z.string(), note: optionalText(300) }), req.body);
  res.json(await svc.assign(ctxOf(req), req.params.id, b.employeeId, b.note));
});
assetsRouter.post('/:id/return', async (req, res) => {
  const b = parse(z.object({ condition: z.enum(['NEW', 'GOOD', 'FAIR', 'POOR']).nullable().optional(), note: optionalText(300) }), req.body);
  res.json(await svc.giveBack(ctxOf(req), req.params.id, b.condition, b.note));
});
