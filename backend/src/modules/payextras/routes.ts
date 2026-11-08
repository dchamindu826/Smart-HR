import { Router } from 'express';
import { parse, z, money, optionalText, periodStr, dateStr } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { sendCsv, sendXlsx, workbook } from '../../lib/xlsx.js';
import { colomboDate } from '../../lib/time.js';
import * as svc from './service.js';

export const loansRouter = Router();
export const gratuityRouter = Router();
export const returnsRouter = Router();

loansRouter.get('/', async (req, res) => res.json(await svc.listLoans(ctxOf(req), parse(z.object({ status: z.string().optional(), employeeId: z.string().optional() }), req.query))));
loansRouter.post('/', async (req, res) => {
  const b = parse(z.object({ employeeId: z.string(), kind: z.enum(['LOAN', 'ADVANCE', 'FESTIVAL']), principal: money, installment: money, startPeriod: periodStr, note: optionalText(300) }), req.body);
  res.status(201).json(await svc.createLoan(ctxOf(req), b));
});
loansRouter.patch('/:id', async (req, res) => {
  const b = parse(z.object({ installment: money.optional(), status: z.enum(['ACTIVE', 'CANCELLED']).optional(), note: optionalText(300) }), req.body);
  res.json(await svc.updateLoan(ctxOf(req), req.params.id, b));
});
loansRouter.post('/:id/settle', async (req, res) => res.json(await svc.settleLoan(ctxOf(req), req.params.id, parse(z.object({ note: optionalText(300) }), req.body ?? {}).note)));

gratuityRouter.get('/', async (req, res) => {
  const q = parse(z.object({ asOf: dateStr.optional() }), req.query);
  res.json(await svc.gratuityReport(ctxOf(req), q.asOf ?? colomboDate(new Date())));
});
gratuityRouter.get('/export.xlsx', async (req, res) => {
  const asOf = (req.query.asOf as string) || colomboDate(new Date());
  const r = await svc.gratuityReport(ctxOf(req), asOf);
  const buf = await workbook(
    'Gratuity',
    [
      { header: 'Emp No', key: 'empNo', width: 10 }, { header: 'Name', key: 'name', width: 24 }, { header: 'Joined', key: 'joinDate', width: 12 },
      { header: 'Years', key: 'years', width: 8 }, { header: 'Salary', key: 'salary', money: true, width: 13 }, { header: 'Liability', key: 'liability', money: true, width: 14 },
      { header: 'Payable now', key: 'payable', money: true, width: 14 },
    ],
    r.rows.map((x) => ({ ...x, empNo: x.employee.empNo, name: x.employee.name })),
    `Gratuity liability as of ${asOf}`,
  );
  sendXlsx(res, `gratuity-${asOf}.xlsx`, buf);
});

const rtype = z.enum(['EPF_C_FORM', 'ETF_R4', 'APIT_T10', 'BANK_SLIPS']);
returnsRouter.get('/', async (req, res) => res.json(await svc.returnsFor(ctxOf(req), parse(z.object({ period: periodStr }), req.query).period)));
returnsRouter.get('/:period/:type.csv', async (req, res) => {
  const p = parse(z.object({ period: periodStr, type: rtype }), req.params);
  const rows = (await svc.returnRows(ctxOf(req), p.period, p.type)) as Record<string, unknown>[];
  const keys = rows[0] ? Object.keys(rows[0]) : ['empNo'];
  sendCsv(res, `${p.type.toLowerCase()}-${p.period}.csv`, keys.map((k) => ({ header: k, key: k })), rows);
});
returnsRouter.post('/:period/:type/filed', async (req, res) => {
  const p = parse(z.object({ period: periodStr, type: rtype }), req.params);
  const b = parse(z.object({ reference: optionalText(100) }), req.body ?? {});
  res.json(await svc.markFiled(ctxOf(req), p.period, p.type, b.reference));
});
