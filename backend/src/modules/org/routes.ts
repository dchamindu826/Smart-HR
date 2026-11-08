import { Router } from 'express';
import { parse, z, optionalText } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import * as svc from './service.js';

export const orgRouter = Router();

const branchBody = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/, 'Letters and numbers only.'),
  name: z.string().trim().min(2).max(80),
  address: optionalText(300),
  phone: optionalText(30),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  radiusM: z.number().int().min(30).max(5000).optional(),
  active: z.boolean().optional(),
});

orgRouter.get('/branches', async (req, res) => res.json(await svc.listBranches(ctxOf(req), req.query.all === '1')));
orgRouter.get('/branches/overview', async (req, res) => res.json(await svc.branchesOverview(ctxOf(req))));
orgRouter.post('/branches', async (req, res) => res.status(201).json(await svc.createBranch(ctxOf(req), parse(branchBody, req.body))));
orgRouter.patch('/branches/:id', async (req, res) => res.json(await svc.updateBranch(ctxOf(req), req.params.id, parse(branchBody.partial(), req.body))));
orgRouter.delete('/branches/:id', async (req, res) => {
  await svc.deleteBranch(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

const deptBody = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/, 'Letters and numbers only.'),
  name: z.string().trim().min(2).max(80),
  branchId: z.string().nullable().optional(),
  headId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});
orgRouter.get('/departments', async (req, res) => res.json(await svc.listDepartments(ctxOf(req))));
orgRouter.post('/departments', async (req, res) => res.status(201).json(await svc.createDepartment(ctxOf(req), parse(deptBody, req.body))));
orgRouter.patch('/departments/:id', async (req, res) => res.json(await svc.updateDepartment(ctxOf(req), req.params.id, parse(deptBody.partial(), req.body))));
orgRouter.delete('/departments/:id', async (req, res) => {
  await svc.deleteDepartment(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

orgRouter.get('/chart', async (req, res) => res.json(await svc.orgChart(ctxOf(req))));
