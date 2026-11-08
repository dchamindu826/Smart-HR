/**
 * Scheduled jobs. Run as a second process (PM2 "smarthr-worker").
 * Ticks every minute; each job records a JobRun row per key so it never runs
 * twice for the same day/month, and it catches up after downtime.
 *
 *   day-close        00:15 Colombo, for yesterday (and up to 3 missed days)
 *   leave-refresh    01:00 on the 1st of each month (casual leave grows in year one)
 *   leave-year       01:30 on 1 January (new year's balances, carry forward)
 *   birthdays        07:00 every day
 *   leavers          00:30 every day (disable logins after the end date)
 *   gratuity         02:00 on the 1st, for the month that ended
 *   invoices         03:00 on the 1st, for the new month
 *   demo-expiry      04:00 every day
 *   cleanup          04:30 every day (old refresh tokens, notifications > 180 days)
 */

import '../core/env.js';
import { db } from '../core/db.js';
import { addDays, colomboDate, colomboMinute, prevPeriod } from '../lib/time.js';
import { closeTenantDay } from '../modules/attendance/dayclose.js';
import { ensureBalances } from '../modules/leave/service.js';
import { accrueGratuity } from '../modules/payextras/service.js';
import { generateInvoices } from '../modules/platform/service.js';
import { notify } from '../core/notify.js';
import { readSettings } from '../core/settings.js';
import { revokeAllForUser } from '../core/auth.js';

async function once(job: string, key: string, fn: () => Promise<unknown>) {
  const exists = await db.jobRun.findUnique({ where: { job_key: { job, key } } });
  let row = exists;
  if (exists) {
    if (exists.status === 'OK') return;
    // a failed or interrupted run is retried, but not more than every 15 minutes
    if (Date.now() - exists.startedAt.getTime() < 15 * 60_000) return;
    row = await db.jobRun.update({ where: { id: exists.id }, data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null } });
  } else {
    row = await db.jobRun.create({ data: { job, key, status: 'RUNNING' } }).catch(() => null);
  }
  if (!row) return; // another worker took it
  try {
    const detail = await fn();
    await db.jobRun.update({ where: { id: row.id }, data: { status: 'OK', finishedAt: new Date(), detail: detail === undefined ? undefined : JSON.parse(JSON.stringify(detail)) } });
  } catch (e) {
    console.error(`[job ${job} ${key}]`, e);
    await db.jobRun.update({ where: { id: row.id }, data: { status: 'FAILED', finishedAt: new Date(), detail: { error: (e as Error).message } } });
  }
}

const activeTenants = () => db.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE', 'SUSPENDED'] } }, select: { id: true, name: true, settings: true } });

async function dayClose(today: string) {
  for (let back = 3; back >= 1; back--) {
    const date = addDays(today, -back);
    for (const t of await activeTenants()) {
      await once('day-close', `${t.id}:${date}`, () => closeTenantDay(t.id, date));
    }
  }
}

async function leavers(today: string) {
  const users = await db.user.findMany({ where: { active: true, employee: { endDate: { lt: new Date(today + 'T00:00:00Z') } } }, select: { id: true } });
  for (const u of users) {
    await db.user.update({ where: { id: u.id }, data: { active: false } });
    await revokeAllForUser(u.id);
  }
  return { disabled: users.length };
}

async function birthdaysJob(today: string) {
  const md = today.slice(5);
  for (const t of await activeTenants()) {
    if (!readSettings(t.settings).birthdayNotifications) continue;
    await once('birthdays', `${t.id}:${today}`, async () => {
      const emps = await db.employee.findMany({ where: { tenantId: t.id, status: 'ACTIVE', dob: { not: null } }, select: { id: true, firstName: true, lastName: true, callingName: true, dob: true, birthdayOptOut: true, departmentId: true, user: { select: { id: true } } } });
      const todays = emps.filter((e) => e.dob!.toISOString().slice(5, 10) === md);
      if (!todays.length) return { count: 0 };
      const users = await db.user.findMany({ where: { tenantId: t.id, active: true }, select: { id: true } });
      for (const e of todays) {
        const name = `${e.callingName || e.firstName} ${e.lastName}`;
        if (!e.birthdayOptOut) {
          await notify({ tenantId: t.id, userIds: users.map((u) => u.id).filter((id) => id !== e.user?.id), type: 'birthday', title: `🎂 It's ${name}'s birthday today`, body: 'Send your wishes!', link: '/announcements' });
        }
        if (e.user) await notify({ tenantId: t.id, userIds: [e.user.id], type: 'birthday.self', title: `Happy birthday, ${e.callingName || e.firstName}! 🎉`, body: `Best wishes from everyone at ${t.name}.` });
      }
      return { count: todays.length };
    });
  }
}

async function tick() {
  const now = new Date();
  const today = colomboDate(now);
  const min = colomboMinute(now);
  const day = Number(today.slice(8, 10));
  const period = today.slice(0, 7);

  if (min >= 15) await dayClose(today);
  if (min >= 30) await once('leavers', today, () => leavers(today));
  if (min >= 7 * 60) await birthdaysJob(today);
  if (day === 1 && min >= 60) {
    for (const t of await activeTenants()) await once('leave-refresh', `${t.id}:${period}`, () => ensureBalances(t.id, Number(today.slice(0, 4))));
  }
  if (today.slice(5) === '01-01' && min >= 90) {
    for (const t of await activeTenants()) await once('leave-year', `${t.id}:${today.slice(0, 4)}`, () => ensureBalances(t.id, Number(today.slice(0, 4))));
  }
  if (day === 1 && min >= 120) {
    const ended = prevPeriod(period);
    for (const t of await activeTenants()) await once('gratuity', `${t.id}:${ended}`, () => accrueGratuity(t.id, ended));
  }
  if (day === 1 && min >= 180) await once('invoices', period, () => generateInvoices(null, period));
  if (min >= 240) {
    await once('demo-expiry', today, async () => {
      const r = await db.tenant.updateMany({ where: { isDemo: true, demoExpiresAt: { lt: now }, status: { not: 'CANCELLED' } }, data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: 'Demo expired' } });
      return { suspended: r.count };
    });
    await once('trial-expiry', today, async () => {
      const r = await db.tenant.updateMany({ where: { status: 'TRIAL', isDemo: false, trialEndsAt: { lt: now } }, data: { status: 'SUSPENDED', suspendedAt: now, suspendReason: 'Trial ended' } });
      return { suspended: r.count };
    });
  }
  if (min >= 270) {
    await once('cleanup', today, async () => {
      const a = await db.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }] } });
      const b = await db.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 180 * 86_400_000) } } });
      const c = await db.platformSession.deleteMany({ where: { expiresAt: { lt: now } } });
      return { tokens: a.count, notifications: b.count, platformSessions: c.count };
    });
  }
}

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    await tick();
  } catch (e) {
    console.error('[worker]', e);
  } finally {
    running = false;
  }
}

console.log('SmartHR worker started');
loop();
const timer = setInterval(loop, 60_000);
process.on('SIGTERM', async () => {
  clearInterval(timer);
  await db.$disconnect();
  process.exit(0);
});
