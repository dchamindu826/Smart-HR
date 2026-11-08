/** Employees: list, profile, create, edit, lifecycle, salary components, logins, documents. */

import type { EmployeeEventKind, Prisma, Role } from '@prisma/client';
import { db, dec } from '../../core/db.js';
import { badRequest, conflict, notFound, planLimit } from '../../core/errors.js';
import { assertCan, can } from '../../core/permissions.js';
import { assertEmployeeInScope, assertWritable, employeeScope, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit, diff } from '../../core/audit.js';
import { hashPassword, revokeAllForUser, tempPassword } from '../../core/auth.js';
import { saveUpload, removeFile } from '../../core/files.js';
import { sendEmail } from '../../core/notify.js';
import { colomboDate, dbDate, fromDbDate } from '../../lib/time.js';

export const PAY_FIELDS = ['payType', 'basicSalary', 'epfNo', 'epfEligible', 'otEligible', 'bankName', 'bankCode', 'bankBranchCode', 'accountNo', 'accountName'] as const;

export interface EmployeeInput {
  empNo?: string;
  title?: string | null;
  firstName: string;
  lastName: string;
  nameWithInitials?: string | null;
  callingName?: string | null;
  nic?: string | null;
  dob?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  maritalStatus?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
  designation?: string | null;
  grade?: string | null;
  managerId?: string | null;
  employmentType?: 'PERMANENT' | 'PROBATION' | 'CONTRACT' | 'TRAINEE' | 'CASUAL';
  joinDate: string;
  confirmDate?: string | null;
  payType?: 'MONTHLY' | 'DAILY';
  basicSalary?: string;
  epfNo?: string | null;
  epfEligible?: boolean;
  otEligible?: boolean;
  bankName?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
  defaultShiftPatternId?: string | null;
  rosterGroupId?: string | null;
  allowRemote?: boolean | null;
  requireLocation?: boolean | null;
  requireFace?: boolean | null;
  remoteAddress?: string | null;
  remoteLat?: number | null;
  remoteLng?: number | null;
  birthdayOptOut?: boolean;
}

const listSelect = {
  id: true, empNo: true, title: true, firstName: true, lastName: true, callingName: true, designation: true, grade: true, status: true,
  employmentType: true, joinDate: true, endDate: true, phone: true, email: true, nic: true, photoPath: true, isSample: true,
  branch: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, role: true, active: true, lastLoginAt: true, mustChangePassword: true } },
} satisfies Prisma.EmployeeSelect;

export async function listEmployees(
  ctx: Ctx,
  q: { q?: string; branchId?: string; departmentId?: string; status?: string; employmentType?: string; managerId?: string; noLogin?: boolean; page: number; pageSize: number },
) {
  assertCan(ctx, 'employee.view');
  const scope = await employeeScope(ctx);
  const and: Prisma.EmployeeWhereInput[] = [scope];
  if (q.q) {
    const s = q.q.trim();
    and.push({
      OR: [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { callingName: { contains: s, mode: 'insensitive' } },
        { empNo: { contains: s, mode: 'insensitive' } },
        { nic: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { email: { contains: s, mode: 'insensitive' } },
        { designation: { contains: s, mode: 'insensitive' } },
      ],
    });
  }
  if (q.branchId) and.push({ branchId: q.branchId });
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.managerId) and.push({ managerId: q.managerId });
  if (q.employmentType) and.push({ employmentType: q.employmentType as never });
  if (q.noLogin) and.push({ user: null, status: 'ACTIVE' });
  if (q.status === 'ALL') {
    /* no filter */
  } else if (q.status) and.push({ status: q.status as never });
  else and.push({ status: 'ACTIVE' });

  const where = { AND: and };
  const [rows, total] = await Promise.all([
    db.employee.findMany({ where, select: listSelect, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.employee.count({ where }),
  ]);
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export async function getEmployee(ctx: Ctx, id: string) {
  assertCan(ctx, 'employee.view');
  await assertEmployeeInScope(ctx, id);
  const e = await db.employee.findFirstOrThrow({
    where: { id, tenantId: ctx.tenantId },
    include: {
      branch: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      manager: { select: { id: true, firstName: true, lastName: true, designation: true } },
      reports: { where: { status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true, designation: true } },
      defaultShiftPattern: { select: { id: true, name: true } },
      rosterGroup: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, phone: true, role: true, active: true, lastLoginAt: true, mustChangePassword: true } },
      events: { orderBy: [{ effective: 'desc' }, { createdAt: 'desc' }], take: 100 },
      assets: { select: { id: true, tag: true, name: true, category: true, assignedAt: true } },
    },
  });
  const showPay = can(ctx, 'employee.pay.view');
  const year = Number(colomboDate(new Date()).slice(0, 4));
  const [balances, components, documents] = await Promise.all([
    db.leaveBalance.findMany({ where: { tenantId: ctx.tenantId, employeeId: id, year }, include: { leaveType: { select: { code: true, name: true, color: true } } } }),
    showPay
      ? db.employeeComponent.findMany({ where: { tenantId: ctx.tenantId, employeeId: id, effectiveTo: null }, include: { component: true }, orderBy: { component: { sortOrder: 'asc' } } })
      : Promise.resolve([]),
    db.employeeDocument.findMany({ where: { tenantId: ctx.tenantId, employeeId: id }, include: { file: { select: { originalName: true, mimeType: true, size: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const out: Record<string, unknown> = { ...e, basicSalary: dec(e.basicSalary) };
  if (!showPay) {
    for (const f of PAY_FIELDS) delete out[f];
    // salary history lives in event details: hide it from people who cannot see pay
    out.events = e.events.map((ev) => (ev.kind === 'SALARY_CHANGED' || ev.kind === 'PROMOTED' ? { ...ev, detail: null } : ev));
  }
  else if (e.accountNo) out.accountNoMasked = `••••${e.accountNo.slice(-4)}`;
  return {
    ...out,
    canSeePay: showPay,
    leaveBalances: balances.map((b) => ({
      leaveType: b.leaveType,
      entitled: Number(b.entitled), carried: Number(b.carried), adjusted: Number(b.adjusted), taken: Number(b.taken),
      available: Number(b.entitled) + Number(b.carried) + Number(b.adjusted) - Number(b.taken),
    })),
    components: components.map((c) => ({ id: c.id, componentId: c.componentId, code: c.component.code, name: c.component.name, kind: c.component.kind, amount: dec(c.amount), effectiveFrom: fromDbDate(c.effectiveFrom) })),
    documents,
  };
}

async function checkRefs(ctx: Ctx, i: Partial<EmployeeInput>, selfId?: string) {
  const t = ctx.tenantId;
  if (i.branchId && !(await db.branch.findFirst({ where: { id: i.branchId, tenantId: t } }))) throw badRequest('Unknown branch.');
  if (i.departmentId && !(await db.department.findFirst({ where: { id: i.departmentId, tenantId: t } }))) throw badRequest('Unknown department.');
  if (i.defaultShiftPatternId && !(await db.shiftPattern.findFirst({ where: { id: i.defaultShiftPatternId, tenantId: t } }))) throw badRequest('Unknown shift pattern.');
  if (i.rosterGroupId && !(await db.rosterGroup.findFirst({ where: { id: i.rosterGroupId, tenantId: t } }))) throw badRequest('Unknown roster group.');
  if (i.managerId) {
    if (i.managerId === selfId) throw badRequest('An employee cannot report to themselves.');
    const m = await db.employee.findFirst({ where: { id: i.managerId, tenantId: t } });
    if (!m) throw badRequest('Unknown manager.');
    // no reporting loops
    if (selfId) {
      let cur: string | null = m.managerId;
      for (let n = 0; cur && n < 50; n++) {
        if (cur === selfId) throw badRequest('This would make a reporting loop.');
        const next: { managerId: string | null } | null = await db.employee.findUnique({ where: { id: cur }, select: { managerId: true } });
        cur = next?.managerId ?? null;
      }
    }
  }
  if (ctx.role === 'HR_OFFICER' && ctx.branchScope.length && i.branchId && !ctx.branchScope.includes(i.branchId)) {
    throw badRequest('You can only place employees in your own branches.');
  }
}

function toData(i: Partial<EmployeeInput>): Prisma.EmployeeUncheckedUpdateInput {
  const d: Record<string, unknown> = { ...i };
  for (const k of ['dob', 'joinDate', 'confirmDate'] as const) {
    if (i[k] !== undefined) d[k] = i[k] ? dbDate(i[k] as string) : null;
  }
  if (i.email !== undefined) d.email = i.email ? i.email.toLowerCase() : null;
  return d as Prisma.EmployeeUncheckedUpdateInput;
}

export async function nextEmpNo(ctx: Ctx): Promise<string> {
  const rows = await db.employee.findMany({ where: { tenantId: ctx.tenantId }, select: { empNo: true }, orderBy: { createdAt: 'desc' }, take: 200 });
  let max = 0;
  let prefix = 'E';
  let width = 4;
  for (const r of rows) {
    const m = /^([A-Za-z-]*)(\d+)$/.exec(r.empNo);
    if (m && Number(m[2]) > max) {
      max = Number(m[2]);
      prefix = m[1];
      width = m[2].length;
    }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

async function assertSeat(ctx: Ctx) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, include: { plan: true } });
  const n = await db.employee.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } });
  if (n >= t.plan.maxEmployees) throw planLimit(`Your ${t.plan.name} plan allows ${t.plan.maxEmployees} active employees. Upgrade the plan to add more.`);
}

export async function createEmployee(ctx: Ctx, i: EmployeeInput, opts: { createLogin?: boolean } = {}) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.edit');
  const payKeys = PAY_FIELDS.filter((k) => i[k] !== undefined && !(k === 'basicSalary' && i.basicSalary === '0.00'));
  if (payKeys.length) assertCan(ctx, 'employee.pay.edit');
  await assertSeat(ctx);
  await checkRefs(ctx, i);
  const empNo = i.empNo?.trim() || (await nextEmpNo(ctx));
  if (await db.employee.findFirst({ where: { tenantId: ctx.tenantId, empNo } })) throw conflict(`Employee number ${empNo} is already used.`);

  const e = await db.$transaction(async (tx) => {
    const e = await tx.employee.create({ data: { ...(toData(i) as Prisma.EmployeeUncheckedCreateInput), empNo, tenantId: ctx.tenantId } });
    await tx.employeeEvent.create({ data: { tenantId: ctx.tenantId, employeeId: e.id, kind: 'JOINED', effective: e.joinDate, createdById: ctx.userId, detail: { designation: e.designation, branchId: e.branchId } } });
    await writeAudit(tx, ctx, 'employee.create', 'Employee', e.id, null, { empNo, name: `${e.firstName} ${e.lastName}` });
    return e;
  });
  let login: { tempPassword: string } | null = null;
  if (opts.createLogin && (e.email || e.phone)) login = await createAccount(ctx, e.id, {});
  return { ...e, basicSalary: dec(e.basicSalary), login };
}

export async function updateEmployee(ctx: Ctx, id: string, i: Partial<EmployeeInput>) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.edit');
  await assertEmployeeInScope(ctx, id);
  const payKeys = PAY_FIELDS.filter((k) => i[k] !== undefined);
  if (payKeys.length) assertCan(ctx, 'employee.pay.edit');
  await checkRefs(ctx, i, id);
  const before = await db.employee.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } });
  if (i.empNo && i.empNo !== before.empNo && (await db.employee.findFirst({ where: { tenantId: ctx.tenantId, empNo: i.empNo } }))) {
    throw conflict(`Employee number ${i.empNo} is already used.`);
  }
  return db.$transaction(async (tx) => {
    const e = await tx.employee.update({ where: { id }, data: toData(i) });
    const d = diff(before as unknown as Record<string, unknown>, e as unknown as Record<string, unknown>);
    if (i.basicSalary !== undefined && before.basicSalary.toFixed(2) !== e.basicSalary.toFixed(2)) {
      await tx.employeeEvent.create({ data: { tenantId: ctx.tenantId, employeeId: id, kind: 'SALARY_CHANGED', effective: dbDate(colomboDate(new Date())), createdById: ctx.userId, detail: { from: before.basicSalary.toFixed(2), to: e.basicSalary.toFixed(2) } } });
    }
    if (i.designation !== undefined && before.designation !== e.designation) {
      await tx.employeeEvent.create({ data: { tenantId: ctx.tenantId, employeeId: id, kind: 'DESIGNATION_CHANGED', effective: dbDate(colomboDate(new Date())), createdById: ctx.userId, detail: { from: before.designation, to: e.designation } } });
    }
    await writeAudit(tx, ctx, 'employee.update', 'Employee', id, d.before, d.after);
    const out: Record<string, unknown> = { ...e, basicSalary: dec(e.basicSalary) };
    if (!can(ctx, 'employee.pay.view')) for (const f of PAY_FIELDS) delete out[f];
    return out;
  });
}

export interface LifecycleInput {
  kind: EmployeeEventKind;
  effective: string;
  note?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  designation?: string | null;
  grade?: string | null;
  basicSalary?: string;
  employmentType?: EmployeeInput['employmentType'];
  reason?: string | null;
}

/** Confirm, promote, transfer, warn, resign, terminate, retire, rehire — each writes an event. */
export async function lifecycle(ctx: Ctx, id: string, i: LifecycleInput) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.edit');
  await assertEmployeeInScope(ctx, id);
  const e = await db.employee.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } });
  const update: Prisma.EmployeeUncheckedUpdateInput = {};
  const detail: Record<string, unknown> = {};
  switch (i.kind) {
    case 'CONFIRMED':
      update.employmentType = 'PERMANENT';
      update.confirmDate = dbDate(i.effective);
      break;
    case 'PROMOTED':
      if (i.designation) update.designation = i.designation;
      if (i.grade) update.grade = i.grade;
      if (i.basicSalary) {
        assertCan(ctx, 'employee.pay.edit');
        update.basicSalary = i.basicSalary;
        detail.salary = { from: e.basicSalary.toFixed(2), to: i.basicSalary };
      }
      detail.designation = { from: e.designation, to: i.designation ?? e.designation };
      break;
    case 'TRANSFERRED':
      await checkRefs(ctx, { branchId: i.branchId, departmentId: i.departmentId, managerId: i.managerId }, id);
      if (i.branchId !== undefined) update.branchId = i.branchId;
      if (i.departmentId !== undefined) update.departmentId = i.departmentId;
      if (i.managerId !== undefined) update.managerId = i.managerId;
      detail.from = { branchId: e.branchId, departmentId: e.departmentId, managerId: e.managerId };
      detail.to = { branchId: i.branchId, departmentId: i.departmentId, managerId: i.managerId };
      break;
    case 'RESIGNED':
    case 'TERMINATED':
    case 'RETIRED':
      if (e.status !== 'ACTIVE') throw badRequest('This employee is not active.');
      update.status = i.kind;
      update.endDate = dbDate(i.effective);
      update.endReason = i.reason ?? null;
      break;
    case 'REHIRED':
      if (e.status === 'ACTIVE') throw badRequest('This employee is already active.');
      await assertSeat(ctx);
      update.status = 'ACTIVE';
      update.endDate = null;
      update.endReason = null;
      update.joinDate = dbDate(i.effective);
      update.employmentType = i.employmentType ?? 'PROBATION';
      break;
    case 'WARNING':
    case 'NOTE':
      break;
    default:
      throw badRequest('Use the edit form for this change.');
  }
  await db.$transaction(async (tx) => {
    if (Object.keys(update).length) await tx.employee.update({ where: { id }, data: update });
    await tx.employeeEvent.create({ data: { tenantId: ctx.tenantId, employeeId: id, kind: i.kind, effective: dbDate(i.effective), note: i.note ?? i.reason ?? null, createdById: ctx.userId, detail: detail as Prisma.InputJsonValue } });
    await writeAudit(tx, ctx, `employee.${i.kind.toLowerCase()}`, 'Employee', id, null, { ...i });
  });
  // a person who has left loses app access on the end date (the daily job also does this)
  if (['RESIGNED', 'TERMINATED', 'RETIRED'].includes(i.kind) && i.effective <= colomboDate(new Date())) {
    const u = await db.user.findUnique({ where: { employeeId: id } });
    if (u) {
      await db.user.update({ where: { id: u.id }, data: { active: false } });
      await revokeAllForUser(u.id);
    }
  }
  return { ok: true };
}

export async function deleteEmployee(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.delete');
  await assertEmployeeInScope(ctx, id);
  const e = await db.employee.findFirstOrThrow({
    where: { id, tenantId: ctx.tenantId },
    include: { _count: { select: { sessions: true, payslips: true, leaveRequests: true } } },
  });
  if (e._count.sessions + e._count.payslips + e._count.leaveRequests > 0) {
    throw conflict('This employee has attendance, leave or payroll history. Use Resign / Terminate instead, so the records stay.');
  }
  await db.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { employeeId: id } });
    await tx.employee.delete({ where: { id } });
    await writeAudit(tx, ctx, 'employee.delete', 'Employee', id, { empNo: e.empNo, name: `${e.firstName} ${e.lastName}` }, null);
  });
}

// ─── Salary components per employee ────────────────────────────

export async function setComponents(ctx: Ctx, id: string, effectiveFrom: string, items: { componentId: string; amount: string }[]) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.pay.edit');
  await assertEmployeeInScope(ctx, id);
  const comps = await db.salaryComponent.findMany({ where: { tenantId: ctx.tenantId, id: { in: items.map((i) => i.componentId) } } });
  if (comps.length !== new Set(items.map((i) => i.componentId)).size) throw badRequest('Unknown pay component.');
  const from = dbDate(effectiveFrom);
  const dayBefore = new Date(from.getTime() - 86_400_000);
  await db.$transaction(async (tx) => {
    const current = await tx.employeeComponent.findMany({ where: { tenantId: ctx.tenantId, employeeId: id, effectiveTo: null } });
    for (const c of current) {
      if (c.effectiveFrom >= from) await tx.employeeComponent.delete({ where: { id: c.id } });
      else await tx.employeeComponent.update({ where: { id: c.id }, data: { effectiveTo: dayBefore } });
    }
    for (const i of items) {
      if (Number(i.amount) === 0) continue;
      await tx.employeeComponent.create({ data: { tenantId: ctx.tenantId, employeeId: id, componentId: i.componentId, amount: i.amount, effectiveFrom: from } });
    }
    await writeAudit(tx, ctx, 'employee.components', 'Employee', id, current.map((c) => ({ componentId: c.componentId, amount: c.amount.toFixed(2) })), items);
  });
  return { ok: true };
}

// ─── App logins for employees ──────────────────────────────────

export async function createAccount(ctx: Ctx, employeeId: string, i: { email?: string | null; phone?: string | null; role?: Role; sendInvite?: boolean }) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.account');
  await assertEmployeeInScope(ctx, employeeId);
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: ctx.tenantId }, include: { user: true, _count: { select: { reports: true } } } });
  if (e.user) throw conflict('This employee already has a login. Reset the password instead.');
  if (e.status !== 'ACTIVE') throw badRequest('Only active employees can get a login.');
  const email = (i.email ?? e.email)?.toLowerCase() ?? null;
  const phone = i.phone ?? e.phone ?? null;
  if (!email && !phone) throw badRequest('Add an email or mobile number to the employee first.');
  let role: Role = i.role ?? (e._count.reports > 0 ? 'MANAGER' : 'EMPLOYEE');
  if (role !== 'EMPLOYEE' && role !== 'MANAGER') assertCan(ctx, 'users.manage');
  const clash = await db.user.findFirst({ where: { tenantId: ctx.tenantId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
  if (clash) throw conflict('Another login already uses this email or mobile number.');
  const pw = tempPassword();
  const u = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { tenantId: ctx.tenantId, employeeId, name: `${e.callingName || e.firstName} ${e.lastName}`, email, phone, role, passwordHash: await hashPassword(pw), mustChangePassword: true },
    });
    await writeAudit(tx, ctx, 'employee.account.create', 'User', u.id, null, { employeeId, email, phone, role });
    return u;
  });
  if (i.sendInvite !== false && email) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, slug: true } });
    await sendEmail(
      email,
      `Your SmartHR app login — ${t.name}`,
      `Hello ${e.callingName || e.firstName},\n\n${t.name} uses SmartHR for attendance, leave and payslips.\nInstall the SmartHR app and log in with:\n\nCompany code: ${t.slug}\nLogin: ${email}\nTemporary password: ${pw}\n\nYou will choose your own password after the first login.`,
    );
  }
  return { userId: u.id, login: email ?? phone, role, tempPassword: pw };
}

/** Create logins for many employees at once (all active employees without one, by default). */
export async function createAccountsBulk(ctx: Ctx, employeeIds: string[] | undefined, sendInvite: boolean) {
  assertWritable(ctx);
  assertCan(ctx, 'employee.account');
  const scope = await employeeScope(ctx);
  const targets = await db.employee.findMany({
    where: { AND: [scope, { status: 'ACTIVE', user: null }, ...(employeeIds?.length ? [{ id: { in: employeeIds } }] : [])] },
    select: { id: true, empNo: true, firstName: true, lastName: true, email: true, phone: true },
    take: 1000,
  });
  const created: { employeeId: string; empNo: string; name: string; login: string; tempPassword: string }[] = [];
  const skipped: { employeeId: string; empNo: string; name: string; reason: string }[] = [];
  for (const t of targets) {
    const name = `${t.firstName} ${t.lastName}`;
    if (!t.email && !t.phone) {
      skipped.push({ employeeId: t.id, empNo: t.empNo, name, reason: 'No email or mobile number' });
      continue;
    }
    try {
      const r = await createAccount(ctx, t.id, { sendInvite });
      created.push({ employeeId: t.id, empNo: t.empNo, name, login: r.login!, tempPassword: r.tempPassword });
    } catch (err) {
      skipped.push({ employeeId: t.id, empNo: t.empNo, name, reason: (err as Error).message });
    }
  }
  return { created, skipped };
}

// ─── Documents and photo ───────────────────────────────────────

export async function addDocument(ctx: Ctx, employeeId: string, file: Express.Multer.File | undefined, i: { kind: string; title: string; expiresOn?: string | null }) {
  assertWritable(ctx);
  assertCan(ctx, 'documents.manage');
  requireFeature(ctx, 'documents');
  await assertEmployeeInScope(ctx, employeeId);
  const f = await saveUpload(file, 'DOCUMENT', ctx.tenantId, ctx.userId);
  const d = await db.employeeDocument.create({
    data: { tenantId: ctx.tenantId, employeeId, kind: i.kind, title: i.title, fileId: f.id, expiresOn: i.expiresOn ? dbDate(i.expiresOn) : null, uploadedById: ctx.userId },
  });
  await writeAudit(db, ctx, 'employee.document.add', 'EmployeeDocument', d.id, null, { employeeId, kind: i.kind, title: i.title });
  return d;
}

export async function getDocumentFile(ctx: Ctx, docId: string) {
  const d = await db.employeeDocument.findFirst({ where: { id: docId, tenantId: ctx.tenantId }, include: { file: true } });
  if (!d) throw notFound('Document');
  if (ctx.employeeId !== d.employeeId) {
    assertCan(ctx, 'employee.view');
    await assertEmployeeInScope(ctx, d.employeeId);
  }
  return d.file;
}

export async function deleteDocument(ctx: Ctx, docId: string) {
  assertWritable(ctx);
  assertCan(ctx, 'documents.manage');
  const d = await db.employeeDocument.findFirst({ where: { id: docId, tenantId: ctx.tenantId }, include: { file: true } });
  if (!d) throw notFound('Document');
  await assertEmployeeInScope(ctx, d.employeeId);
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.delete({ where: { id: docId } });
    await tx.storedFile.delete({ where: { id: d.fileId } });
    await writeAudit(tx, ctx, 'employee.document.delete', 'EmployeeDocument', docId, { title: d.title }, null);
  });
  await removeFile(d.file.path);
}

export async function setPhoto(ctx: Ctx, employeeId: string, file: Express.Multer.File | undefined) {
  assertWritable(ctx);
  if (ctx.employeeId !== employeeId) {
    assertCan(ctx, 'employee.edit');
    await assertEmployeeInScope(ctx, employeeId);
  }
  const f = await saveUpload(file, 'PHOTO', ctx.tenantId, ctx.userId);
  const e = await db.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: ctx.tenantId } });
  await db.employee.update({ where: { id: employeeId }, data: { photoPath: f.path } });
  if (e.photoPath) await removeFile(e.photoPath);
  return { ok: true };
}

export async function photoFile(ctx: Ctx, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, tenantId: ctx.tenantId }, select: { photoPath: true } });
  if (!e?.photoPath) throw notFound('Photo');
  const f = await db.storedFile.findUnique({ where: { path: e.photoPath } });
  return { path: e.photoPath, mimeType: f?.mimeType ?? 'image/jpeg' };
}

/** Employees with a birthday today (day and month only; never the year). */
export async function birthdays(ctx: Ctx, from: string, days = 7) {
  const list = await db.employee.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE', birthdayOptOut: false, dob: { not: null } },
    select: { id: true, firstName: true, lastName: true, callingName: true, dob: true, designation: true, department: { select: { name: true } } },
  });
  const out: { id: string; name: string; designation: string | null; department: string | null; day: string; inDays: number }[] = [];
  const start = new Date(from + 'T00:00:00Z');
  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * 86_400_000);
    const md = date.toISOString().slice(5, 10);
    for (const e of list) {
      if (e.dob && e.dob.toISOString().slice(5, 10) === md) {
        out.push({ id: e.id, name: `${e.callingName || e.firstName} ${e.lastName}`, designation: e.designation, department: e.department?.name ?? null, day: md, inDays: d });
      }
    }
  }
  return out;
}
