import { Router } from 'express';
import { parse, z, optionalText, dateStr, money, pageQuery, email, phone, nic } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { upload, streamFile } from '../../core/files.js';
import { assertCan, can } from '../../core/permissions.js';
import { workbook, sendXlsx } from '../../lib/xlsx.js';
import { fromDbDate, colomboDate } from '../../lib/time.js';
import * as svc from './service.js';

export const employeesRouter = Router();

const t = (n = 200) => optionalText(n);
const empBody = z.object({
  empNo: z.string().trim().max(20).optional(),
  title: t(10),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  nameWithInitials: t(120),
  callingName: t(40),
  nic: nic.nullable().optional(),
  dob: dateStr.nullable().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  maritalStatus: t(20),
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
  address: t(300),
  emergencyName: t(100),
  emergencyPhone: t(30),
  branchId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  designation: t(80),
  grade: t(20),
  managerId: z.string().nullable().optional(),
  employmentType: z.enum(['PERMANENT', 'PROBATION', 'CONTRACT', 'TRAINEE', 'CASUAL']).optional(),
  joinDate: dateStr,
  confirmDate: dateStr.nullable().optional(),
  payType: z.enum(['MONTHLY', 'DAILY']).optional(),
  basicSalary: money.optional(),
  epfNo: t(20),
  epfEligible: z.boolean().optional(),
  otEligible: z.boolean().optional(),
  bankName: t(80),
  bankCode: t(10),
  bankBranchCode: t(10),
  accountNo: t(30),
  accountName: t(100),
  defaultShiftPatternId: z.string().nullable().optional(),
  rosterGroupId: z.string().nullable().optional(),
  allowRemote: z.boolean().nullable().optional(),
  requireLocation: z.boolean().nullable().optional(),
  requireFace: z.boolean().nullable().optional(),
  remoteAddress: t(300),
  remoteLat: z.number().min(-90).max(90).nullable().optional(),
  remoteLng: z.number().min(-180).max(180).nullable().optional(),
  birthdayOptOut: z.boolean().optional(),
});

employeesRouter.get('/', async (req, res) => {
  const q = parse(
    pageQuery.extend({
      branchId: z.string().optional(), departmentId: z.string().optional(), status: z.string().optional(),
      employmentType: z.string().optional(), managerId: z.string().optional(), noLogin: z.enum(['1', '0']).optional(),
    }),
    req.query,
  );
  res.json(await svc.listEmployees(ctxOf(req), { ...q, noLogin: q.noLogin === '1' }));
});

employeesRouter.get('/next-number', async (req, res) => res.json({ empNo: await svc.nextEmpNo(ctxOf(req)) }));

employeesRouter.get('/export.xlsx', async (req, res) => {
  const ctx = ctxOf(req);
  const data = await svc.listEmployees(ctx, { page: 1, pageSize: 5000, status: (req.query.status as string) || undefined });
  const showPay = can(ctx, 'employee.pay.view');
  const buf = await workbook(
    'Employees',
    [
      { header: 'Emp No', key: 'empNo', width: 10 },
      { header: 'First name', key: 'firstName', width: 16 },
      { header: 'Last name', key: 'lastName', width: 18 },
      { header: 'NIC', key: 'nic', width: 15 },
      { header: 'Designation', key: 'designation', width: 22 },
      { header: 'Branch', key: 'branch', width: 16 },
      { header: 'Department', key: 'department', width: 18 },
      { header: 'Type', key: 'employmentType', width: 12 },
      { header: 'Joined', key: 'joinDate', width: 12 },
      { header: 'Mobile', key: 'phone', width: 14 },
      { header: 'Email', key: 'email', width: 24 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'App login', key: 'login', width: 10 },
    ],
    data.rows.map((r) => ({
      ...r,
      branch: r.branch?.name,
      department: r.department?.name,
      joinDate: fromDbDate(r.joinDate),
      login: r.user ? (r.user.active ? 'Yes' : 'Disabled') : 'No',
    })),
    `Employees — ${colomboDate(new Date())}${showPay ? '' : ''}`,
  );
  sendXlsx(res, `employees-${colomboDate(new Date())}.xlsx`, buf);
});

employeesRouter.post('/accounts/bulk', async (req, res) => {
  const b = parse(z.object({ employeeIds: z.array(z.string()).max(1000).optional(), sendInvite: z.boolean().default(true) }), req.body);
  res.json(await svc.createAccountsBulk(ctxOf(req), b.employeeIds, b.sendInvite));
});

employeesRouter.get('/birthdays', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'dashboard.view');
  res.json(await svc.birthdays(ctx, colomboDate(new Date()), Number(req.query.days ?? 7)));
});

employeesRouter.get('/:id', async (req, res) => res.json(await svc.getEmployee(ctxOf(req), req.params.id)));
employeesRouter.post('/', async (req, res) => {
  const b = parse(empBody.extend({ createLogin: z.boolean().optional() }), req.body);
  const { createLogin, ...data } = b;
  res.status(201).json(await svc.createEmployee(ctxOf(req), data as svc.EmployeeInput, { createLogin }));
});
employeesRouter.patch('/:id', async (req, res) => res.json(await svc.updateEmployee(ctxOf(req), req.params.id, parse(empBody.partial(), req.body) as Partial<svc.EmployeeInput>)));
employeesRouter.delete('/:id', async (req, res) => {
  await svc.deleteEmployee(ctxOf(req), req.params.id);
  res.json({ ok: true });
});

employeesRouter.post('/:id/events', async (req, res) => {
  const b = parse(
    z.object({
      kind: z.enum(['CONFIRMED', 'PROMOTED', 'TRANSFERRED', 'WARNING', 'RESIGNED', 'TERMINATED', 'RETIRED', 'REHIRED', 'NOTE']),
      effective: dateStr,
      note: t(1000),
      branchId: z.string().nullable().optional(),
      departmentId: z.string().nullable().optional(),
      managerId: z.string().nullable().optional(),
      designation: t(80),
      grade: t(20),
      basicSalary: money.optional(),
      employmentType: z.enum(['PERMANENT', 'PROBATION', 'CONTRACT', 'TRAINEE', 'CASUAL']).optional(),
      reason: t(500),
    }),
    req.body,
  );
  res.json(await svc.lifecycle(ctxOf(req), req.params.id, b));
});

employeesRouter.put('/:id/components', async (req, res) => {
  const b = parse(z.object({ effectiveFrom: dateStr, items: z.array(z.object({ componentId: z.string(), amount: money })).max(50) }), req.body);
  res.json(await svc.setComponents(ctxOf(req), req.params.id, b.effectiveFrom, b.items));
});

employeesRouter.post('/:id/account', async (req, res) => {
  const b = parse(
    z.object({ email: email.nullable().optional(), phone: phone.nullable().optional(), role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_OFFICER', 'HR_MANAGER', 'PAYROLL_OFFICER']).optional(), sendInvite: z.boolean().default(true) }),
    req.body,
  );
  res.status(201).json(await svc.createAccount(ctxOf(req), req.params.id, b));
});

employeesRouter.post('/:id/documents', upload.single('file'), async (req, res) => {
  const b = parse(z.object({ kind: z.string().trim().min(2).max(30), title: z.string().trim().min(2).max(120), expiresOn: dateStr.nullable().optional() }), req.body);
  res.status(201).json(await svc.addDocument(ctxOf(req), req.params.id as string, req.file, b));
});
employeesRouter.get('/documents/:docId/file', async (req, res) => {
  const f = await svc.getDocumentFile(ctxOf(req), req.params.docId as string);
  streamFile(res, f.path, f.mimeType, f.originalName);
});
employeesRouter.delete('/documents/:docId', async (req, res) => {
  await svc.deleteDocument(ctxOf(req), req.params.docId as string);
  res.json({ ok: true });
});

employeesRouter.post('/:id/photo', upload.single('file'), async (req, res) => res.json(await svc.setPhoto(ctxOf(req), req.params.id as string, req.file)));
employeesRouter.get('/:id/photo', async (req, res) => {
  const f = await svc.photoFile(ctxOf(req), req.params.id);
  streamFile(res, f.path, f.mimeType);
});
