import { Router } from 'express';
import { parse, z, dateStr, optionalText, pageQuery } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { colomboDate, addDays } from '../../lib/time.js';
import * as svc from './service.js';

export const leaveRouter = Router();

const typeBody = z.object({
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().trim().min(2).max(60),
  paid: z.boolean().optional(),
  rule: z.enum(['STATUTORY_ANNUAL', 'STATUTORY_CASUAL', 'FIXED', 'MATERNITY', 'NO_PAY']).optional(),
  daysPerYear: z.number().min(0).max(366).optional(),
  allowHalfDay: z.boolean().optional(),
  allowNegative: z.boolean().optional(),
  carryForwardMax: z.number().min(0).max(100).optional(),
  requireDocument: z.boolean().optional(),
  noticeDays: z.number().int().min(0).max(90).optional(),
  genderOnly: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

leaveRouter.get('/types', async (req, res) => res.json(await svc.listTypes(ctxOf(req), req.query.all === '1')));
leaveRouter.post('/types', async (req, res) => res.status(201).json(await svc.createType(ctxOf(req), parse(typeBody, req.body))));
leaveRouter.patch('/types/:id', async (req, res) => res.json(await svc.updateType(ctxOf(req), req.params.id, parse(typeBody.partial(), req.body))));

const year = () => Number(colomboDate(new Date()).slice(0, 4));

leaveRouter.get('/balances', async (req, res) => {
  const q = parse(z.object({ year: z.coerce.number().int().optional(), employeeId: z.string().optional(), branchId: z.string().optional(), departmentId: z.string().optional() }), req.query);
  res.json(await svc.balances(ctxOf(req), q.year ?? year(), q));
});
leaveRouter.get('/balances/mine', async (req, res) => res.json(await svc.myBalances(ctxOf(req), Number(req.query.year) || year())));
leaveRouter.post('/balances/generate', async (req, res) => {
  const b = parse(z.object({ year: z.number().int().min(2000).max(2100) }), req.body);
  res.json(await svc.generateYear(ctxOf(req), b.year));
});
leaveRouter.post('/balances/adjust', async (req, res) => {
  const b = parse(z.object({ employeeId: z.string(), leaveTypeId: z.string(), year: z.number().int(), days: z.number().min(-100).max(100).refine((v) => v !== 0, 'Enter a number of days.'), reason: z.string().trim().min(5).max(300) }), req.body);
  res.json(await svc.adjust(ctxOf(req), b));
});

leaveRouter.get('/requests', async (req, res) => {
  const q = parse(pageQuery.extend({ status: z.string().optional(), from: dateStr.optional(), to: dateStr.optional(), employeeId: z.string().optional(), mine: z.enum(['1', '0']).optional() }), req.query);
  res.json(await svc.listRequests(ctxOf(req), { ...q, mine: q.mine === '1' }));
});
leaveRouter.post('/requests', async (req, res) => {
  const b = parse(
    z.object({
      employeeId: z.string().optional(),
      leaveTypeId: z.string(),
      fromDate: dateStr,
      toDate: dateStr,
      halfDay: z.enum(['AM', 'PM']).nullable().optional(),
      reason: optionalText(500),
      autoApprove: z.boolean().optional(),
    }),
    req.body,
  );
  res.status(201).json(await svc.apply(ctxOf(req), b));
});
leaveRouter.post('/requests/:id/decide', async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), note: optionalText(300) }), req.body);
  res.json(await svc.decide(ctxOf(req), req.params.id, b.approve, b.note));
});
leaveRouter.post('/requests/:id/cancel', async (req, res) => res.json(await svc.cancel(ctxOf(req), req.params.id)));

leaveRouter.get('/calendar', async (req, res) => {
  const today = colomboDate(new Date());
  const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
  res.json(await svc.calendar(ctxOf(req), q.from ?? today.slice(0, 8) + '01', q.to ?? addDays(today, 45)));
});
