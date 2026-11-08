/**
 * Notifications: an in-app row for each user, plus a push to their phones
 * (Firebase Cloud Messaging HTTP v1, if configured) and optional email.
 * Push bodies never carry salary figures.
 */

import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';

export interface NotifyInput {
  tenantId: string;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  push?: boolean;
}

export async function notify(n: NotifyInput): Promise<void> {
  const ids = [...new Set(n.userIds)].filter(Boolean);
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ tenantId: n.tenantId, userId, type: n.type, title: n.title, body: n.body, link: n.link })),
  });
  if (n.push !== false) {
    sendPush(ids, n.title, n.body ?? '', { type: n.type, link: n.link ?? '' }).catch((e) => console.warn('push failed', e?.message));
  }
}

/** Users with a given set of roles in a tenant (e.g. who to tell about a pending roster). */
export async function usersWithRoles(tenantId: string, roles: string[]): Promise<string[]> {
  const rows = await db.user.findMany({ where: { tenantId, active: true, role: { in: roles as never[] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The approver for an employee: their manager's user, else HR. */
export async function approversFor(tenantId: string, employeeId: string): Promise<string[]> {
  const e = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { manager: { select: { user: { select: { id: true, active: true } } } } },
  });
  const m = e?.manager?.user;
  if (m?.active) return [m.id];
  return usersWithRoles(tenantId, ['HR_MANAGER', 'OWNER']);
}

export async function userIdForEmployee(employeeId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { employeeId }, select: { id: true, active: true } });
  return u?.active ? u.id : null;
}

// ─── Push (FCM HTTP v1) ────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}
let sa: ServiceAccount | null | undefined;
let cachedToken: { token: string; exp: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  if (sa !== undefined) return sa;
  if (!config.FCM_SERVICE_ACCOUNT_FILE) return (sa = null);
  try {
    sa = JSON.parse(readFileSync(config.FCM_SERVICE_ACCOUNT_FILE, 'utf8')) as ServiceAccount;
  } catch (e) {
    console.warn('Could not read FCM service account:', (e as Error).message);
    sa = null;
  }
  return sa;
}

async function googleToken(acc: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const key = await importPKCS8(acc.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(acc.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export async function sendPush(userIds: string[], title: string, body: string, data: Record<string, string>): Promise<void> {
  const acc = serviceAccount();
  if (!acc) return;
  const tokens = await db.pushToken.findMany({ where: { userId: { in: userIds } } });
  if (!tokens.length) return;
  const access = await googleToken(acc);
  for (const t of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: t.token, notification: { title, body }, data } }),
    });
    if (r.status === 404 || r.status === 400) {
      // token no longer valid
      await db.pushToken.delete({ where: { id: t.id } }).catch(() => undefined);
    }
  }
}

// ─── Email ─────────────────────────────────────────────────────

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    console.log(`\n── email (SMTP not configured) ──\nTo: ${to}\nSubject: ${subject}\n\n${text}\n──\n`);
    return;
  }
  await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
}
