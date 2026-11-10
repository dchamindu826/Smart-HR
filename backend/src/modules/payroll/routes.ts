import { Router } from 'express';
import { parse, z, money, optionalText, periodStr } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { assertCan } from '../../core/permissions.js';
import { sendCsv, sendXlsx, workbook } from '../../lib/xlsx.js';
import * as svc from './service.js';
import { payslipPdf } from './pdf.js';

export const payrollRouter = Router();
export const payslipsRouter = Router();

const compBody = z.object({
  code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_]+$/),
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  epfApplicable: z.boolean().optional(),
  taxable: z.boolean().optional(),
  fixed: z.boolean().optional(),
  affectedByNoPay: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
payrollRouter.get('/components', async (req, res) => res.json(await svc.listComponents(ctxOf(req))));
payrollRouter.post('/components', async (req, res) => res.status(201).json(await svc.saveComponent(ctxOf(req), null, parse(compBody, req.body))));
payrollRouter.patch('/components/:id', async (req, res) => res.json(await svc.saveComponent(ctxOf(req), req.params.id, parse(compBody, req.body))));

payrollRouter.get('/adjustments', async (req, res) => res.json(await svc.listAdjustments(ctxOf(req), parse(z.object({ period: periodStr }), req.query).period)));
payrollRouter.post('/adjustments', async (req, res) => {
  const b = parse(
    z.object({
      employeeId: z.string(), period: periodStr, kind: z.enum(['EARNING', 'DEDUCTION']),
      code: z.string().trim().min(2).max(12), label: z.string().trim().min(2).max(60), amount: money,
      epfApplicable: z.boolean().optional(), taxable: z.boolean().optional(), reason: optionalText(300),
    }),
    req.body,
  );
  res.status(201).json(await svc.addAdjustment(ctxOf(req), b));
});
payrollRouter.delete('/adjustments/:id', async (req, res) => {
  await svc.deleteAdjustment(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

payrollRouter.get('/runs', async (req, res) => res.json(await svc.listRuns(ctxOf(req))));
payrollRouter.post('/runs', async (req, res) => res.status(201).json(await svc.createRun(ctxOf(req), parse(z.object({ period: periodStr }), req.body).period)));
payrollRouter.get('/runs/:id', async (req, res) => res.json(await svc.getRun(ctxOf(req), req.params.id)));
payrollRouter.get('/runs/:id/checklist', async (req, res) => res.json(await svc.checklist(ctxOf(req), req.params.id)));
payrollRouter.post('/runs/:id/calculate', async (req, res) => res.json(await svc.calculate(ctxOf(req), req.params.id)));
payrollRouter.post('/runs/:id/approve', async (req, res) => res.json(await svc.approve(ctxOf(req), req.params.id)));
payrollRouter.post('/runs/:id/reopen', async (req, res) => res.json(await svc.reopen(ctxOf(req), req.params.id)));
payrollRouter.post('/runs/:id/lock', async (req, res) => res.json(await svc.lock(ctxOf(req), req.params.id)));
payrollRouter.post('/runs/:id/release', async (req, res) => res.json(await svc.release(ctxOf(req), req.params.id)));
payrollRouter.delete('/runs/:id', async (req, res) => {
  await svc.deleteRun(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

payrollRouter.get('/runs/:id/bank-file.csv', async (req, res) => {
  const rows = await svc.bankRows(ctxOf(req), req.params.id);
  const run = await svc.getRun(ctxOf(req), req.params.id);
  sendCsv(
    res,
    `bank-transfer-${run.period}.csv`,
    [
      { header: 'Emp No', key: 'empNo' }, { header: 'Account name', key: 'name' }, { header: 'Bank', key: 'bankName' },
      { header: 'Bank code', key: 'bankCode' }, { header: 'Branch code', key: 'branchCode' }, { header: 'Account no', key: 'accountNo' }, { header: 'Amount', key: 'amount' },
    ],
    rows,
  );
});
payrollRouter.get('/runs/:id/register.xlsx', async (req, res) => {
  const ctx = ctxOf(req);
  const run = await svc.getRun(ctx, req.params.id);
  const rows = await svc.registerRows(ctx, req.params.id);
  const buf = await workbook(
    'Payroll register',
    [
      { header: 'Emp No', key: 'empNo', width: 10 }, { header: 'Name', key: 'name', width: 24 }, { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Department', key: 'department', width: 16 }, { header: 'Basic', key: 'basic', money: true, width: 13 }, { header: 'Gross', key: 'gross', money: true, width: 13 },
      { header: 'EPF 8%', key: 'epf8', money: true, width: 11 }, { header: 'APIT', key: 'apit', money: true, width: 11 }, { header: 'Total deductions', key: 'deductions', money: true, width: 14 },
      { header: 'Net', key: 'net', money: true, width: 13 }, { header: 'EPF 12%', key: 'epf12', money: true, width: 11 }, { header: 'ETF 3%', key: 'etf3', money: true, width: 11 },
      { header: 'No-pay days', key: 'noPayDays', width: 10 }, { header: 'OT hours', key: 'otHours', width: 9 },
      { header: 'Late days', key: 'lateDays', width: 9 }, { header: 'Late minutes', key: 'lateMinutes', width: 11 },
    ],
    rows,
    `Payroll register — ${run.period} (${run.status})`,
  );
  sendXlsx(res, `payroll-register-${run.period}.xlsx`, buf);
});

payrollRouter.get('/template', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'payroll.view');
  res.json(await svc.getTemplate(ctx));
});
payrollRouter.put('/template', async (req, res) => {
  const b = parse(
    z.object({
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      showLogo: z.boolean().optional(), showAddress: z.boolean().optional(), showRegNumbers: z.boolean().optional(), showBank: z.boolean().optional(),
      showEmployerContrib: z.boolean().optional(), showLeaveBalance: z.boolean().optional(), showAttendance: z.boolean().optional(),
      headerNote: optionalText(300), footerNote: optionalText(300), signatureLabel: optionalText(60),
    }),
    req.body,
  );
  res.json(await svc.updateTemplate(ctxOf(req), b));
});
payrollRouter.get('/ytd/:employeeId', async (req, res) => res.json(await svc.ytd(ctxOf(req), req.params.employeeId, Number(req.query.year) || new Date().getFullYear())));

// payslips (HR and employee)
payslipsRouter.get('/mine', async (req, res) => res.json(await svc.myPayslips(ctxOf(req))));
payslipsRouter.get('/:id', async (req, res) => res.json(await svc.getPayslip(ctxOf(req), req.params.id)));
payslipsRouter.get('/:id/pdf', async (req, res) => {
  const { buffer, filename } = await payslipPdf(ctxOf(req), req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
});
