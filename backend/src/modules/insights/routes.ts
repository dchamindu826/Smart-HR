import { Router } from 'express';
import { parse, z, dateStr, periodStr, pageQuery } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { requireFeature } from '../../core/context.js';
import { sendXlsx, workbook, type Col } from '../../lib/xlsx.js';
import { colomboDate } from '../../lib/time.js';
import * as svc from './service.js';

export const dashboardRouter = Router();
export const approvalsRouter = Router();
export const reportsRouter = Router();
export const auditRouter = Router();

dashboardRouter.get('/', async (req, res) => res.json(await svc.dashboard(ctxOf(req))));
approvalsRouter.get('/', async (req, res) => res.json(await svc.approvals(ctxOf(req))));

const thisPeriod = () => colomboDate(new Date()).slice(0, 7);

reportsRouter.get('/headcount', async (req, res) => res.json(await svc.headcountReport(ctxOf(req))));
reportsRouter.get('/attendance', async (req, res) => {
  const q = parse(z.object({ period: periodStr.optional(), branchId: z.string().optional(), format: z.enum(['json', 'xlsx']).optional() }), req.query);
  const rows = await svc.attendanceReport(ctxOf(req), q.period ?? thisPeriod(), q.branchId);
  if (q.format !== 'xlsx') return res.json(rows);
  const cols: Col[] = [
    { header: 'Emp No', key: 'empNo', width: 10 }, { header: 'Name', key: 'name', width: 24 }, { header: 'Department', key: 'department', width: 18 },
    { header: 'Present', key: 'present' }, { header: 'Absent', key: 'absent' }, { header: 'Leave', key: 'leave' }, { header: 'Off', key: 'off' },
    { header: 'Late days', key: 'lateDays' }, { header: 'Late minutes', key: 'lateMinutes' }, { header: 'Worked h', key: 'workedHours' }, { header: 'OT h', key: 'otHours' }, { header: 'Missing mark-out', key: 'missingOut' },
  ];
  sendXlsx(res, `attendance-${q.period ?? thisPeriod()}.xlsx`, await workbook('Attendance', cols, rows, `Attendance summary — ${q.period ?? thisPeriod()}`));
});
reportsRouter.get('/overtime', async (req, res) => {
  const ctx = ctxOf(req);
  requireFeature(ctx, 'overtime');
  const q = parse(z.object({ period: periodStr.optional(), format: z.enum(['json', 'xlsx']).optional() }), req.query);
  const r = await svc.overtimeReport(ctx, q.period ?? thisPeriod());
  if (q.format !== 'xlsx') return res.json(r);
  const cols: Col[] = [{ header: 'Date', key: 'date', width: 12 }, { header: 'Emp No', key: 'empNo' }, { header: 'Name', key: 'name', width: 24 }, { header: 'Kind', key: 'kind' }, { header: 'Minutes', key: 'minutes' }, { header: 'Status', key: 'status' }, { header: 'Reason', key: 'reason', width: 40 }];
  sendXlsx(res, `overtime-${q.period ?? thisPeriod()}.xlsx`, await workbook('Overtime', cols, r.rows));
});
reportsRouter.get('/leave', async (req, res) => {
  const q = parse(z.object({ year: z.coerce.number().int().optional(), format: z.enum(['json', 'xlsx']).optional() }), req.query);
  const year = q.year ?? new Date().getFullYear();
  const rows = await svc.leaveReport(ctxOf(req), year);
  if (q.format !== 'xlsx') return res.json(rows);
  const cols: Col[] = [{ header: 'Emp No', key: 'empNo' }, { header: 'Name', key: 'name', width: 24 }, { header: 'Leave', key: 'leave', width: 16 }, { header: 'Entitled', key: 'entitled' }, { header: 'Carried', key: 'carried' }, { header: 'Adjusted', key: 'adjusted' }, { header: 'Taken', key: 'taken' }, { header: 'Available', key: 'available' }];
  sendXlsx(res, `leave-${year}.xlsx`, await workbook('Leave', cols, rows, `Leave balances — ${year}`));
});
reportsRouter.get('/payroll-summary', async (req, res) => res.json(await svc.payrollSummary(ctxOf(req), Number(req.query.year) || new Date().getFullYear())));
reportsRouter.get('/salary-cost', async (req, res) => res.json(await svc.salaryCostByDepartment(ctxOf(req), parse(z.object({ period: periodStr }), req.query).period)));

auditRouter.get('/', async (req, res) => {
  const q = parse(pageQuery.extend({ entity: z.string().optional(), entityId: z.string().optional(), actorId: z.string().optional(), action: z.string().optional(), from: dateStr.optional(), to: dateStr.optional() }), req.query);
  res.json(await svc.auditLog(ctxOf(req), q));
});
