/**
 * Bulk import from Excel (.xlsx), CSV, or a Google Sheets link (Drive).
 * Flow: download template → upload → validate (row-by-row errors) → preview → commit.
 */

import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, conflict, notFound, planLimit } from '../../core/errors.js';
import { assertCan, can } from '../../core/permissions.js';
import { assertWritable, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { saveUpload, storeBuffer, absolutePath } from '../../core/files.js';
import { readSheet, workbook } from '../../lib/xlsx.js';
import { normalisePhone } from '../../core/validate.js';
import { isDate } from '../../lib/time.js';
import { toCents, fromCents } from '../../lib/money.js';
import { readFile } from 'node:fs/promises';
import { ensureBalances } from '../leave/service.js';
import { createAccount } from '../employees/service.js';

export type ImportKind = 'EMPLOYEES' | 'LEAVE_BALANCES';

interface ColDef {
  key: string;
  header: string;
  required?: boolean;
  aliases?: string[];
  example?: string;
}

const EMPLOYEE_COLS: ColDef[] = [
  { key: 'empNo', header: 'Emp No', aliases: ['employee no', 'emp no', 'employee number', 'epf no.'], example: 'E0001' },
  { key: 'title', header: 'Title', example: 'Mr' },
  { key: 'firstName', header: 'First name', required: true, aliases: ['first', 'given name'], example: 'Kamal' },
  { key: 'lastName', header: 'Last name', required: true, aliases: ['surname', 'last'], example: 'Perera' },
  { key: 'nameWithInitials', header: 'Name with initials', aliases: ['initials name'], example: 'K. A. Perera' },
  { key: 'callingName', header: 'Calling name', example: 'Kamal' },
  { key: 'nic', header: 'NIC', aliases: ['nic no', 'national id'], example: '199012345678' },
  { key: 'dob', header: 'Date of birth', aliases: ['dob', 'birthday', 'birth date'], example: '1990-05-14' },
  { key: 'gender', header: 'Gender', aliases: ['sex'], example: 'Male' },
  { key: 'phone', header: 'Mobile', aliases: ['phone', 'mobile no', 'contact no', 'telephone'], example: '0771234567' },
  { key: 'email', header: 'Email', aliases: ['e-mail', 'email address'], example: 'kamal@example.lk' },
  { key: 'address', header: 'Address', example: '12, Main Street, Kandy' },
  { key: 'branchCode', header: 'Branch code', aliases: ['branch'], example: 'HO' },
  { key: 'departmentCode', header: 'Department code', aliases: ['department', 'dept'], example: 'FIN' },
  { key: 'designation', header: 'Designation', aliases: ['job title', 'position'], example: 'Accounts Executive' },
  { key: 'employmentType', header: 'Employment type', aliases: ['type', 'employment'], example: 'Permanent' },
  { key: 'joinDate', header: 'Join date', required: true, aliases: ['joined', 'date joined', 'date of joining', 'appointment date'], example: '2024-01-15' },
  { key: 'basicSalary', header: 'Basic salary', aliases: ['basic', 'salary'], example: '65000.00' },
  { key: 'epfNo', header: 'EPF No', aliases: ['epf number', 'member no'], example: '1234' },
  { key: 'bankName', header: 'Bank name', aliases: ['bank'], example: 'Bank of Ceylon' },
  { key: 'bankCode', header: 'Bank code', example: '7010' },
  { key: 'bankBranchCode', header: 'Bank branch code', aliases: ['bank branch'], example: '001' },
  { key: 'accountNo', header: 'Account no', aliases: ['account number', 'a/c no'], example: '0012345678' },
  { key: 'accountName', header: 'Account name', example: 'K A Perera' },
  { key: 'managerEmpNo', header: 'Manager Emp No', aliases: ['reports to', 'manager'], example: 'E0100' },
];

const LEAVE_COLS: ColDef[] = [
  { key: 'empNo', header: 'Emp No', required: true, aliases: ['employee no'], example: 'E0001' },
  { key: 'leaveCode', header: 'Leave code', required: true, aliases: ['leave type', 'code'], example: 'ANNUAL' },
  { key: 'year', header: 'Year', required: true, example: '2026' },
  { key: 'taken', header: 'Taken so far', aliases: ['taken', 'used'], example: '3' },
  { key: 'adjustment', header: 'Adjustment', aliases: ['opening adjustment', 'brought forward'], example: '0' },
];

const colsFor = (k: ImportKind) => (k === 'EMPLOYEES' ? EMPLOYEE_COLS : LEAVE_COLS);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function template(kind: ImportKind) {
  const cols = colsFor(kind);
  const buf = await workbook(
    kind === 'EMPLOYEES' ? 'Employees' : 'Leave balances',
    cols.map((c) => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: Math.max(14, c.header.length + 4) })),
    [Object.fromEntries(cols.map((c) => [c.key, c.example ?? '']))],
  );
  return buf;
}

function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (isDate(s)) return s;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isDate(d) ? d : null;
  }
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isDate(d) ? d : null;
  }
  if (/^\d{5}$/.test(s)) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10);
    return d;
  }
  return null;
}

function mapHeaders(kind: ImportKind, headers: string[]) {
  const cols = colsFor(kind);
  const map = new Map<string, string>(); // file header → key
  const unknown: string[] = [];
  for (const h of headers) {
    const n = norm(h.replace('*', ''));
    const c = cols.find((c) => norm(c.header) === n || c.aliases?.some((a) => norm(a) === n));
    if (c) map.set(h, c.key);
    else unknown.push(h);
  }
  const missing = cols.filter((c) => c.required && ![...map.values()].includes(c.key)).map((c) => c.header);
  return { map, unknown, missing };
}

type Err = { row: number; field: string; message: string };

async function validateEmployees(ctx: Ctx, rows: Record<string, string>[]) {
  const [branches, depts, existing] = await Promise.all([
    db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true, name: true } }),
    db.department.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true, name: true } }),
    db.employee.findMany({ where: { tenantId: ctx.tenantId }, select: { empNo: true, nic: true, id: true } }),
  ]);
  const errors: Err[] = [];
  const out: Record<string, unknown>[] = [];
  const seenNo = new Set(existing.map((e) => e.empNo.toUpperCase()));
  const seenNic = new Set(existing.map((e) => e.nic).filter(Boolean) as string[]);
  const fileNos = new Set(rows.map((r) => (r.empNo ?? '').toUpperCase()).filter(Boolean));
  const byCode = <T extends { code: string; name: string }>(list: T[], v: string) => list.find((x) => x.code.toUpperCase() === v.toUpperCase() || x.name.toLowerCase() === v.toLowerCase());
  rows.forEach((r, i) => {
    const row = i + 2;
    const e = (field: string, message: string) => errors.push({ row, field, message });
    const o: Record<string, unknown> = {};
    o.firstName = r.firstName?.trim();
    o.lastName = r.lastName?.trim();
    if (!o.firstName) e('First name', 'Required.');
    if (!o.lastName) e('Last name', 'Required.');
    const no = r.empNo?.trim().toUpperCase();
    if (no) {
      if (seenNo.has(no)) e('Emp No', `${no} already exists.`);
      seenNo.add(no);
      o.empNo = no;
    }
    const join = parseDate(r.joinDate ?? '');
    if (!join) e('Join date', `"${r.joinDate ?? ''}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`);
    o.joinDate = join;
    if (r.dob) {
      const d = parseDate(r.dob);
      if (!d) e('Date of birth', `"${r.dob}" is not a date.`);
      o.dob = d;
    }
    if (r.nic) {
      const n = r.nic.trim().toUpperCase();
      if (!/^\d{9}[VX]$/.test(n) && !/^\d{12}$/.test(n)) e('NIC', `"${r.nic}" is not a valid NIC.`);
      else if (seenNic.has(n)) e('NIC', `${n} is already used.`);
      seenNic.add(n);
      o.nic = n;
    }
    if (r.phone) {
      const p = normalisePhone(r.phone);
      if (!/^\+94\d{9}$/.test(p)) e('Mobile', `"${r.phone}" is not a Sri Lankan mobile number.`);
      o.phone = p;
    }
    if (r.email) {
      const em = r.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) e('Email', `"${r.email}" is not an email address.`);
      o.email = em;
    }
    if (r.gender) {
      const g = r.gender.trim().toUpperCase()[0];
      o.gender = g === 'M' ? 'MALE' : g === 'F' ? 'FEMALE' : 'OTHER';
    }
    if (r.branchCode) {
      const b = byCode(branches, r.branchCode.trim());
      if (!b) e('Branch code', `No branch "${r.branchCode}". Add it under Business & branches first.`);
      o.branchId = b?.id ?? null;
    }
    if (r.departmentCode) {
      const d = byCode(depts, r.departmentCode.trim());
      if (!d) e('Department code', `No department "${r.departmentCode}".`);
      o.departmentId = d?.id ?? null;
    }
    if (r.employmentType) {
      const t = r.employmentType.trim().toUpperCase();
      const map: Record<string, string> = { PERMANENT: 'PERMANENT', PERM: 'PERMANENT', PROBATION: 'PROBATION', PROBATIONARY: 'PROBATION', CONTRACT: 'CONTRACT', TRAINEE: 'TRAINEE', INTERN: 'TRAINEE', CASUAL: 'CASUAL' };
      if (!map[t]) e('Employment type', `"${r.employmentType}" — use Permanent, Probation, Contract, Trainee or Casual.`);
      o.employmentType = map[t] ?? 'PROBATION';
    }
    if (r.basicSalary) {
      try {
        const c = toCents(r.basicSalary);
        if (c < 0) throw new Error();
        o.basicSalary = fromCents(c);
      } catch {
        e('Basic salary', `"${r.basicSalary}" is not an amount.`);
      }
    }
    if (r.managerEmpNo) {
      const m = r.managerEmpNo.trim().toUpperCase();
      if (!existing.some((x) => x.empNo.toUpperCase() === m) && !fileNos.has(m)) e('Manager Emp No', `No employee ${m}.`);
      o.managerEmpNo = m;
    }
    for (const k of ['title', 'nameWithInitials', 'callingName', 'address', 'designation', 'epfNo', 'bankName', 'bankCode', 'bankBranchCode', 'accountNo', 'accountName']) {
      if (r[k]) o[k] = r[k].trim();
    }
    out.push(o);
  });
  return { errors, rows: out };
}

async function validateLeave(ctx: Ctx, rows: Record<string, string>[]) {
  const [emps, types] = await Promise.all([
    db.employee.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, empNo: true } }),
    db.leaveType.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true } }),
  ]);
  const errors: Err[] = [];
  const out: Record<string, unknown>[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const emp = emps.find((e) => e.empNo.toUpperCase() === (r.empNo ?? '').trim().toUpperCase());
    const t = types.find((x) => x.code === (r.leaveCode ?? '').trim().toUpperCase());
    const year = Number(r.year);
    if (!emp) errors.push({ row, field: 'Emp No', message: `No employee "${r.empNo}".` });
    if (!t) errors.push({ row, field: 'Leave code', message: `No leave type "${r.leaveCode}".` });
    if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.push({ row, field: 'Year', message: 'Enter a year like 2026.' });
    const taken = r.taken ? Number(r.taken) : 0;
    const adj = r.adjustment ? Number(r.adjustment) : 0;
    if (!Number.isFinite(taken) || taken < 0) errors.push({ row, field: 'Taken so far', message: 'Enter a number of days.' });
    if (!Number.isFinite(adj)) errors.push({ row, field: 'Adjustment', message: 'Enter a number of days.' });
    out.push({ employeeId: emp?.id, empNo: r.empNo, leaveTypeId: t?.id, leaveCode: r.leaveCode, year, taken, adjustment: adj });
  });
  return { errors, rows: out };
}

async function processFile(ctx: Ctx, kind: ImportKind, buf: Buffer, filename: string, fileId: string) {
  const sheet = await readSheet(buf, filename);
  if (!sheet.rows.length) throw badRequest('The file has no rows under the header.');
  if (sheet.rows.length > 2000) throw badRequest('Import up to 2,000 rows at a time.');
  const { map, unknown, missing } = mapHeaders(kind, sheet.headers);
  if (missing.length) throw badRequest(`These columns are missing: ${missing.join(', ')}. Download the template to see the columns.`);
  const rows = sheet.rows.map((r) => Object.fromEntries([...map].map(([h, k]) => [k, r[h] ?? ''])));
  const v = kind === 'EMPLOYEES' ? await validateEmployees(ctx, rows) : await validateLeave(ctx, rows);
  const job = await db.importJob.create({
    data: {
      tenantId: ctx.tenantId, kind, fileId, status: v.errors.length ? 'FAILED' : 'VALIDATED', totalRows: rows.length,
      okRows: rows.length - new Set(v.errors.map((e) => e.row)).size, errors: v.errors as unknown as Prisma.InputJsonValue,
      preview: v.rows as unknown as Prisma.InputJsonValue, createdById: ctx.userId,
    },
  });
  return { id: job.id, status: job.status, totalRows: job.totalRows, okRows: job.okRows, errors: v.errors.slice(0, 500), ignoredColumns: unknown, preview: v.rows.slice(0, 20) };
}

export async function uploadAndValidate(ctx: Ctx, kind: ImportKind, file: Express.Multer.File | undefined) {
  assertWritable(ctx);
  assertCan(ctx, 'import.run');
  requireFeature(ctx, 'import');
  const f = await saveUpload(file, 'IMPORT', ctx.tenantId, ctx.userId);
  return processFile(ctx, kind, await readFile(absolutePath(f.path)), f.originalName, f.id);
}

/** Google Sheets / Drive: a sheet shared as "Anyone with the link can view". */
export async function fromGoogleSheet(ctx: Ctx, kind: ImportKind, url: string) {
  assertWritable(ctx);
  assertCan(ctx, 'import.run');
  requireFeature(ctx, 'import');
  const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(url);
  if (!m) throw badRequest('Paste a Google Sheets link (docs.google.com/spreadsheets/…).');
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1];
  const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const r = await fetch(csvUrl, { redirect: 'follow' });
  if (!r.ok) throw badRequest('Could not open the sheet. In Google Sheets, click Share → General access → "Anyone with the link" (Viewer), then try again.');
  const text = await r.text();
  if (text.trimStart().startsWith('<')) throw badRequest('The sheet is not shared publicly. Set General access to "Anyone with the link" (Viewer).');
  const buf = Buffer.from(text, 'utf8');
  const f = await storeBuffer(buf, 'google-sheet.csv', 'text/csv', 'IMPORT', ctx.tenantId, ctx.userId);
  return processFile(ctx, kind, buf, 'google-sheet.csv', f.id);
}

export async function getJob(ctx: Ctx, id: string) {
  assertCan(ctx, 'import.run');
  const j = await db.importJob.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { file: { select: { originalName: true } } } });
  if (!j) throw notFound('Import');
  return { ...j, preview: (j.preview as unknown[]).slice(0, 50) };
}

export async function listJobs(ctx: Ctx) {
  assertCan(ctx, 'import.run');
  return db.importJob.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, kind: true, status: true, totalRows: true, okRows: true, createdAt: true, committedAt: true, file: { select: { originalName: true } } }, orderBy: { createdAt: 'desc' }, take: 30 });
}

export async function commit(ctx: Ctx, id: string, opts: { createLogins?: boolean }) {
  assertWritable(ctx);
  assertCan(ctx, 'import.run');
  const j = await db.importJob.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!j) throw notFound('Import');
  if (j.status === 'COMMITTED') throw conflict('This import is already done.');
  if (j.status === 'FAILED') throw badRequest('Fix the errors in the file and upload it again.');
  const rows = j.preview as Record<string, unknown>[];

  if (j.kind === 'EMPLOYEES') {
    // same rights as adding employees by hand
    assertCan(ctx, 'employee.edit');
    const payOk = can(ctx, 'employee.pay.edit');
    const payKeys = ['basicSalary', 'epfNo', 'bankName', 'bankCode', 'bankBranchCode', 'accountNo', 'accountName'];
    for (const r of rows) {
      if (!payOk) for (const k of payKeys) delete r[k];
      if (ctx.role === 'HR_OFFICER' && ctx.branchScope.length) {
        if (!r.branchId) r.branchId = ctx.branchScope[0];
        else if (!ctx.branchScope.includes(String(r.branchId))) throw badRequest('This file has employees in branches outside yours. Remove those rows and upload again.');
      }
    }
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, include: { plan: true } });
    const active = await db.employee.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } });
    if (active + rows.length > t.plan.maxEmployees) throw planLimit(`This would make ${active + rows.length} employees. Your ${t.plan.name} plan allows ${t.plan.maxEmployees}.`);
    const created: string[] = [];
    await db.$transaction(
      async (tx) => {
        let seq = (await tx.employee.count({ where: { tenantId: ctx.tenantId } })) + 1;
        const nos = new Map<string, string>();
        for (const r of rows) {
          let empNo = r.empNo as string | undefined;
          while (!empNo || (await tx.employee.findFirst({ where: { tenantId: ctx.tenantId, empNo }, select: { id: true } }))) {
            empNo = `E${String(seq++).padStart(4, '0')}`;
            if (r.empNo) break;
          }
          const { managerEmpNo, empNo: _no, ...data } = r as Record<string, unknown>;
          void _no;
          const e = await tx.employee.create({
            data: {
              ...(data as object),
              tenantId: ctx.tenantId,
              empNo,
              firstName: String(r.firstName),
              lastName: String(r.lastName),
              joinDate: new Date(String(r.joinDate) + 'T00:00:00Z'),
              dob: r.dob ? new Date(String(r.dob) + 'T00:00:00Z') : null,
              basicSalary: (r.basicSalary as string) ?? '0',
            } as Prisma.EmployeeUncheckedCreateInput,
          });
          await tx.employeeEvent.create({ data: { tenantId: ctx.tenantId, employeeId: e.id, kind: 'JOINED', effective: e.joinDate, createdById: ctx.userId, note: 'Imported' } });
          nos.set(empNo, e.id);
          if (managerEmpNo) nos.set(`mgr:${e.id}`, String(managerEmpNo));
          created.push(e.id);
        }
        // managers after everyone exists
        for (const [k, v] of nos) {
          if (!k.startsWith('mgr:')) continue;
          const empId = k.slice(4);
          const mgr = nos.get(v) ?? (await tx.employee.findFirst({ where: { tenantId: ctx.tenantId, empNo: v }, select: { id: true } }))?.id;
          if (mgr && mgr !== empId) await tx.employee.update({ where: { id: empId }, data: { managerId: mgr } });
        }
        await tx.importJob.update({ where: { id }, data: { status: 'COMMITTED', committedAt: new Date() } });
        await writeAudit(tx, ctx, 'import.employees', 'ImportJob', id, null, { created: created.length });
      },
      { timeout: 120_000 },
    );
    const year = new Date().getFullYear();
    await ensureBalances(ctx.tenantId, year, created);
    let logins = 0;
    if (opts.createLogins) {
      for (const eid of created) {
        try {
          await createAccount(ctx, eid, { sendInvite: true });
          logins++;
        } catch {
          /* skipped: no email/phone or duplicate */
        }
      }
    }
    return { created: created.length, logins };
  }

  // LEAVE_BALANCES
  let updated = 0;
  for (const r of rows) {
    const year = Number(r.year);
    await ensureBalances(ctx.tenantId, year, [String(r.employeeId)]);
    await db.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: String(r.employeeId), leaveTypeId: String(r.leaveTypeId), year } },
      create: { tenantId: ctx.tenantId, employeeId: String(r.employeeId), leaveTypeId: String(r.leaveTypeId), year, taken: Number(r.taken), adjusted: Number(r.adjustment) },
      update: { taken: Number(r.taken), adjusted: Number(r.adjustment) },
    });
    updated++;
  }
  await db.importJob.update({ where: { id }, data: { status: 'COMMITTED', committedAt: new Date() } });
  await writeAudit(db, ctx, 'import.leave', 'ImportJob', id, null, { updated });
  return { updated };
}
