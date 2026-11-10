/**
 * Sample data for demo accounts only. Every sample employee has isSample=true,
 * every sample asset tag starts with DEMO-, so "Remove sample data" can take it
 * all out again. Real companies never get this.
 */

import type { Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { hashPassword } from '../../core/auth.js';
import { addDays, colomboDate, colomboInstant, dbDate, fromDbDate, isoWeekday, monthRange, weekStart } from '../../lib/time.js';
import { readSettings, rosterRules } from '../../core/settings.js';
import type { Ctx } from '../../core/context.js';
import * as payroll from '../payroll/service.js';
import { closeTenantDay } from '../attendance/dayclose.js';
import { ensureBalances } from '../leave/service.js';
import { planDay } from '../../rules/roster.js';

export const DEMO_PASSWORD = 'Demo@1234';

const PEOPLE: [string, string, 'MALE' | 'FEMALE', string, string, number][] = [
  // first, last, gender, dept, designation, basic
  ['Nimal', 'Jayasuriya', 'MALE', 'OPS', 'Operations Manager', 185000],
  ['Dilani', 'Fernando', 'FEMALE', 'HR', 'HR Executive', 120000],
  ['Kamal', 'Perera', 'MALE', 'OPS', 'Store Keeper', 68000],
  ['Sanduni', 'Wickramasinghe', 'FEMALE', 'FIN', 'Accountant', 145000],
  ['Ruwan', 'Silva', 'MALE', 'OPS', 'Driver', 55000],
  ['Tharushi', 'Gunawardena', 'FEMALE', 'SAL', 'Sales Executive', 72000],
  ['Mohamed', 'Rizwan', 'MALE', 'SAL', 'Sales Manager', 160000],
  ['Kavindi', 'Rathnayake', 'FEMALE', 'FIN', 'Accounts Assistant', 62000],
  ['Suresh', 'Kumar', 'MALE', 'IT', 'IT Support', 90000],
  ['Ishara', 'Bandara', 'FEMALE', 'OPS', 'Shift Supervisor', 82000],
  ['Pradeep', 'Herath', 'MALE', 'OPS', 'Warehouse Assistant', 50000],
  ['Nadeesha', 'Dissanayake', 'FEMALE', 'SAL', 'Sales Executive', 70000],
  ['Chamara', 'Weerasinghe', 'MALE', 'OPS', 'Security Officer', 52000],
  ['Anjali', 'Senanayake', 'FEMALE', 'HR', 'Receptionist', 48000],
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export async function createDemoData(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const rand = rng(42);
  const today = colomboDate(new Date());

  // org
  const ho = await db.branch.update({ where: { tenantId_code: { tenantId, code: 'HO' } }, data: { name: 'Head office — Colombo 03', address: '45 Galle Road, Colombo 03', lat: 6.9022, lng: 79.8530, radiusM: 200 } });
  const kandy = await db.branch.create({ data: { tenantId, code: 'KDY', name: 'Kandy branch', address: '12 Peradeniya Road, Kandy', lat: 7.2906, lng: 80.6337, radiusM: 200 } });
  const depts: Record<string, string> = {};
  for (const [code, name] of [['OPS', 'Operations'], ['FIN', 'Finance'], ['SAL', 'Sales'], ['HR', 'Human Resources'], ['IT', 'IT']] as const) {
    depts[code] = (await db.department.create({ data: { tenantId, code, name, branchId: code === 'SAL' ? kandy.id : ho.id } })).id;
  }
  const gen = await db.shiftPattern.findFirstOrThrow({ where: { tenantId, code: 'GEN' } });
  const night = await db.shiftPattern.create({ data: { tenantId, code: 'NIGHT', name: 'Night 22:00–06:00', segments: [{ start: 1320, end: 1800 }], totalMinutes: 480, color: '#5B3FD4' } });
  await db.shiftPattern.create({ data: { tenantId, code: 'SPLIT', name: 'Split 07:00–11:00 + 16:00–21:00', segments: [{ start: 420, end: 660 }, { start: 960, end: 1260 }], totalMinutes: 540, color: '#C810B0' } });
  const long = await db.shiftPattern.create({ data: { tenantId, code: 'LONG', name: 'Long day 08:00–18:00 (1 h OT)', segments: [{ start: 480, end: 1080 }], totalMinutes: 600, color: '#A96C08' } });

  // people
  const bra = await db.salaryComponent.findFirstOrThrow({ where: { tenantId, code: 'BRA' } });
  const travel = await db.salaryComponent.findFirstOrThrow({ where: { tenantId, code: 'TRAVEL' } });
  const ids: string[] = [];
  for (let i = 0; i < PEOPLE.length; i++) {
    const [first, last, gender, dept, designation, basic] = PEOPLE[i];
    const join = addDays(today, -Math.round(200 + rand() * 2600));
    const dob = `${1975 + Math.floor(rand() * 25)}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
    const e = await db.employee.create({
      data: {
        tenantId, empNo: `D${String(i + 1).padStart(3, '0')}`, firstName: first, lastName: last, gender, isSample: true,
        nic: `${dob.slice(0, 4)}${String(100 + Math.floor(rand() * 600)).padStart(3, '0')}${String(Math.floor(rand() * 99999)).padStart(5, '0')}`,
        dob: dbDate(i === 2 ? `1992-${today.slice(5)}` : dob),
        phone: `+9477${String(1000000 + Math.floor(rand() * 8999999))}`,
        email: `${first.toLowerCase()}.${t.slug}@demo.lumiai.lk`,
        address: dept === 'SAL' ? 'Kandy' : 'Colombo',
        branchId: dept === 'SAL' ? kandy.id : ho.id,
        departmentId: depts[dept], designation, employmentType: i % 6 === 5 ? 'PROBATION' : 'PERMANENT',
        joinDate: dbDate(join), basicSalary: `${basic}.00`, epfNo: String(1000 + i),
        bankName: 'Bank of Ceylon', bankCode: '7010', bankBranchCode: String(1 + (i % 9)).padStart(3, '0'), accountNo: String(80000000 + i * 7919), accountName: `${first[0]} ${last}`,
        defaultShiftPatternId: i === 12 ? night.id : gen.id,
        remoteLat: 6.9 + rand() * 0.05, remoteLng: 79.86 + rand() * 0.05, remoteAddress: 'Home',
      },
    });
    ids.push(e.id);
    await db.employeeEvent.create({ data: { tenantId, employeeId: e.id, kind: 'JOINED', effective: dbDate(join), note: 'Sample data' } });
    await db.employeeComponent.create({ data: { tenantId, employeeId: e.id, componentId: bra.id, amount: '3500.00', effectiveFrom: dbDate(join) } });
    if (['Driver', 'Sales Executive', 'Sales Manager'].includes(designation)) {
      await db.employeeComponent.create({ data: { tenantId, employeeId: e.id, componentId: travel.id, amount: '7500.00', effectiveFrom: dbDate(join) } });
    }
  }
  // reporting lines: Nimal manages operations; Rizwan manages sales; Dilani (HR) reports to Nimal
  const [nimal, dilani, , sanduni, , , rizwan] = ids;
  for (const [i, p] of PEOPLE.entries()) {
    const mgr = p[3] === 'OPS' && i !== 0 ? nimal : p[3] === 'SAL' && i !== 6 ? rizwan : p[3] === 'FIN' && i !== 3 ? sanduni : i === 0 || i === 6 ? null : nimal;
    if (mgr) await db.employee.update({ where: { id: ids[i] }, data: { managerId: mgr } });
  }
  await db.department.update({ where: { id: depts.OPS }, data: { headId: nimal } });

  // logins (known demo password)
  const pw = await hashPassword(DEMO_PASSWORD);
  const mk = (employeeId: string, role: 'HR_MANAGER' | 'MANAGER' | 'EMPLOYEE' | 'PAYROLL_OFFICER', email: string, name: string) =>
    db.user.create({ data: { tenantId, employeeId, role, email, name, passwordHash: pw, mustChangePassword: false } });
  const hrUser = await mk(dilani, 'HR_MANAGER', `hr.${t.slug}@demo.lumiai.lk`, 'Dilani Fernando');
  const mgrUser = await mk(nimal, 'MANAGER', `manager.${t.slug}@demo.lumiai.lk`, 'Nimal Jayasuriya');
  await mk(ids[2], 'EMPLOYEE', `kamal.${t.slug}@demo.lumiai.lk`, 'Kamal Perera');
  await mk(sanduni, 'PAYROLL_OFFICER', `payroll.${t.slug}@demo.lumiai.lk`, 'Sanduni Wickramasinghe');
  await mk(rizwan, 'MANAGER', `sales.${t.slug}@demo.lumiai.lk`, 'Mohamed Rizwan');

  // roster: operations team made by Nimal; this week and last week published
  const opsIds = ids.filter((_, i) => PEOPLE[i][3] === 'OPS');
  const group = await db.rosterGroup.create({ data: { tenantId, name: 'Operations team', makerId: mgrUser.id, approverId: hrUser.id } });
  await db.employee.updateMany({ where: { id: { in: opsIds } }, data: { rosterGroupId: group.id } });
  const rules = { normalDayMinutes: 480, mealMinutes: 60, mealStart: 720, mealEnd: 780, weeklyOtCapMinutes: 720, maxDayMinutes: 960, minRestMinutes: 480 };
  for (const ws of [addDays(weekStart(today), -7), weekStart(today)]) {
    const week = await db.rosterWeek.create({ data: { tenantId, groupId: group.id, weekStart: dbDate(ws), status: 'PUBLISHED', preparedById: mgrUser.id, submittedAt: new Date(), decidedById: hrUser.id, decidedAt: new Date(), publishedAt: new Date() } });
    for (const empId of opsIds) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(ws, d);
        const off = d >= 5 || (empId === ids[9] && d === 2);
        const isNight = empId === ids[12];
        const isLong = empId === ids[2] && d === 1;
        let segs: { start: number; end: number; mode: 'OFFICE' }[] = [];
        if (!off) segs = isNight ? [{ start: 1320, end: 1440, mode: 'OFFICE' }] : isLong ? [{ start: 480, end: 1080, mode: 'OFFICE' }] : [{ start: 510, end: 1050, mode: 'OFFICE' }];
        if (isNight && d > 0 && d <= 5) segs = [{ start: 0, end: 360, mode: 'OFFICE' }, ...segs];
        const p = planDay(segs, rules);
        await db.rosterDay.create({
          data: { tenantId, weekId: week.id, employeeId: empId, date: dbDate(date), shiftPatternId: off ? null : isNight ? night.id : isLong ? long.id : gen.id, segments: segs as unknown as Prisma.InputJsonValue, isOff: segs.length === 0, totalMinutes: p.totalMinutes, paidMinutes: p.paidMinutes, plannedOtMinutes: p.plannedOtMinutes },
        });
      }
    }
  }

  // attendance for the last 10 days
  for (let back = 10; back >= 1; back--) {
    const date = addDays(today, -back);
    const wd = isoWeekday(date);
    if (wd >= 6) continue;
    for (let i = 0; i < ids.length; i++) {
      if (i === 12) continue; // night worker: skip for simplicity
      if (rand() < 0.06) continue; // absent
      const startMin = 495 + Math.floor(rand() * 40) + (i === 4 && back % 3 === 0 ? 35 : 0);
      let endMin = 1050 + Math.floor(rand() * 20);
      if (i === 2 && back === 2) endMin = 1170; // stayed late → unrostered OT
      if (i === 10 && back === 3) {
        // split day: office morning, remote evening
        await session(tenantId, ids[i], date, 480, 720, 'OFFICE', ho.id);
        await session(tenantId, ids[i], date, 840, 1080, 'REMOTE', null);
        continue;
      }
      await session(tenantId, ids[i], date, startMin, endMin, 'OFFICE', PEOPLE[i][3] === 'SAL' ? kandy.id : ho.id);
    }
  }
  await ensureBalances(tenantId, Number(today.slice(0, 4)));
  for (let back = 10; back >= 1; back--) await closeTenantDay(tenantId, addDays(today, -back));
  const ot = await db.overtimeClaim.findFirst({ where: { tenantId, employeeId: ids[2], kind: 'UNROSTERED' } });
  if (ot) await db.overtimeClaim.update({ where: { id: ot.id }, data: { status: 'PENDING', reason: 'Stock count for the month-end audit' } });

  // leave
  const annual = await db.leaveType.findFirstOrThrow({ where: { tenantId, code: 'ANNUAL' } });
  const casual = await db.leaveType.findFirstOrThrow({ where: { tenantId, code: 'CASUAL' } });
  await db.leaveRequest.create({ data: { tenantId, employeeId: ids[5], leaveTypeId: annual.id, fromDate: dbDate(addDays(today, 7)), toDate: dbDate(addDays(today, 8)), days: 2, reason: 'Family wedding in Galle', status: 'PENDING' } });
  await db.leaveRequest.create({ data: { tenantId, employeeId: ids[7], leaveTypeId: casual.id, fromDate: dbDate(addDays(today, 3)), toDate: dbDate(addDays(today, 3)), days: 1, reason: 'Personal', status: 'PENDING' } });

  // holidays, announcement, assets
  await db.holidayDate.create({ data: { tenantId, date: dbDate(addDays(today, 20)), name: 'Company anniversary', kind: 'COMPANY', multiplier: '1.50' } });
  await db.announcement.create({ data: { tenantId, authorId: hrUser.id, title: 'Welcome to SmartHR', body: 'From today, mark your attendance in the SmartHR app. Your payslips and leave are there too. Ask HR if you need help.', pinned: true } });
  for (const [tag, name, cat, who] of [['DEMO-LAP-001', 'Dell Latitude 5440', 'LAPTOP', 3], ['DEMO-PHN-001', 'Samsung Galaxy A35', 'PHONE', 6], ['DEMO-SIM-001', 'Dialog SIM 077xxxxxxx', 'SIM', 6], ['DEMO-LAP-002', 'HP ProBook 450', 'LAPTOP', -1]] as const) {
    await db.asset.create({
      data: { tenantId, tag, name, category: cat, status: who >= 0 ? 'ASSIGNED' : 'IN_STOCK', assignedToId: who >= 0 ? ids[who] : null, assignedAt: who >= 0 ? new Date() : null, condition: 'GOOD', branchId: ho.id, history: [{ at: new Date().toISOString(), action: 'ADDED', by: 'Sample data' }] },
    });
  }
  await db.assetRequest.create({ data: { tenantId, employeeId: ids[8], category: 'LAPTOP', item: 'Laptop for remote support', reason: 'Current laptop battery does not hold charge' } });
}

async function session(tenantId: string, employeeId: string, date: string, start: number, end: number, mode: 'OFFICE' | 'REMOTE', branchId: string | null) {
  const startAt = colomboInstant(date, start);
  const endAt = colomboInstant(date, end);
  await db.attendanceSession.create({
    data: { tenantId, employeeId, date: dbDate(date), startAt, endAt, minutes: end - start, mode, source: 'APP', branchId, closedBy: 'USER', inLat: mode === 'OFFICE' ? 6.9022 : 6.91, inLng: mode === 'OFFICE' ? 79.853 : 79.87 },
  });
}

// ─── Sample payslips (demo accounts only) ──────────────────────

/**
 * Fills the last `months` full months of a DEMO company with attendance (some
 * people late, a few absences), a published roster for the operations team,
 * and a released payroll — so payslips, lateness and reports can be tried in
 * the app and the web. Uses the real payroll code. Safe to run twice.
 */
export async function addDemoPayslips(tenantId: string, months = 2) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { plan: true } });
  if (!t.isDemo) throw new Error('Sample payslips are only for demo companies.');
  const owner = await db.user.findFirst({ where: { tenantId, role: 'OWNER', active: true } });
  if (!owner) throw new Error('The demo company has no active owner login.');
  const ctx: Ctx = {
    userId: owner.id, tenantId, role: owner.role, name: owner.name, employeeId: owner.employeeId,
    branchScope: owner.branchScope, deptScope: owner.deptScope, features: new Set(t.plan.features), planCode: t.plan.code,
    tenantStatus: t.status, settings: readSettings(t.settings), ip: null,
  };
  const rand = rng(7);
  const today = colomboDate(new Date());
  const emps = await db.employee.findMany({ where: { tenantId, isSample: true, status: 'ACTIVE' }, select: { id: true, joinDate: true, branchId: true, rosterGroupId: true, defaultShiftPatternId: true }, orderBy: { empNo: 'asc' } });
  const group = await db.rosterGroup.findFirst({ where: { tenantId } });
  const gen = await db.shiftPattern.findFirst({ where: { tenantId, code: 'GEN' } });
  const rRules = rosterRules(ctx.settings);
  const done: string[] = [];

  for (let m = months; m >= 1; m--) {
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    first.setUTCMonth(first.getUTCMonth() - m);
    const period = first.toISOString().slice(0, 7);
    const { start, end } = monthRange(period);
    const existing = await db.payrollRun.findUnique({ where: { tenantId_period: { tenantId, period } } });
    if (existing && existing.status === 'LOCKED') {
      if (!existing.releasedAt) await payroll.release(ctx, existing.id);
      done.push(period);
      continue;
    }

    // published roster for the operations team (08:30–17:30, Mon–Fri)
    if (group && gen) {
      const members = emps.filter((e) => e.rosterGroupId === group.id);
      for (let ws = weekStart(start); ws <= end; ws = addDays(ws, 7)) {
        if (await db.rosterWeek.findFirst({ where: { tenantId, groupId: group.id, weekStart: dbDate(ws) } })) continue;
        const week = await db.rosterWeek.create({ data: { tenantId, groupId: group.id, weekStart: dbDate(ws), status: 'PUBLISHED', preparedById: owner.id, submittedAt: new Date(), decidedById: owner.id, decidedAt: new Date(), publishedAt: new Date() } });
        for (const e of members) {
          for (let d = 0; d < 7; d++) {
            const date = addDays(ws, d);
            const segs = d >= 5 ? [] : [{ start: 510, end: 1050, mode: 'OFFICE' as const }];
            const p = planDay(segs, rRules);
            await db.rosterDay.create({ data: { tenantId, weekId: week.id, employeeId: e.id, date: dbDate(date), shiftPatternId: segs.length ? gen.id : null, segments: segs as unknown as Prisma.InputJsonValue, isOff: !segs.length, totalMinutes: p.totalMinutes, paidMinutes: p.paidMinutes, plannedOtMinutes: p.plannedOtMinutes } });
          }
        }
      }
    }

    // attendance on weekdays; a few people late, a few absences
    for (let date = start; date <= end; date = addDays(date, 1)) {
      if (isoWeekday(date) >= 6 || date >= today) continue;
      for (const [i, e] of emps.entries()) {
        if (date < fromDbDate(e.joinDate)) continue;
        if (await db.attendanceSession.findFirst({ where: { tenantId, employeeId: e.id, date: dbDate(date) } })) continue;
        if (rand() < 0.03) continue; // absent
        const late = i % 4 === 2 && rand() < 0.35 ? 20 + Math.floor(rand() * 40) : 0;
        const startMin = 495 + Math.floor(rand() * 25) + late;
        const endMin = 1050 + Math.floor(rand() * 25);
        await session(tenantId, e.id, date, startMin, endMin, 'OFFICE', e.branchId);
      }
      await closeTenantDay(tenantId, date);
    }

    const run = existing ?? (await payroll.createRun(ctx, period));
    if (run.status === 'APPROVED') await payroll.reopen(ctx, run.id);
    await payroll.calculate(ctx, run.id);
    await payroll.approve(ctx, run.id);
    await payroll.lock(ctx, run.id);
    const after = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    if (!after.releasedAt) await payroll.release(ctx, run.id);
    done.push(period);
  }
  return { periods: done };
}
