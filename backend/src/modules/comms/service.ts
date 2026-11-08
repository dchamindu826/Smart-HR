/** Internal communication: announcements (with read receipts) and direct / group messages. */

import type { Audience, Prisma } from '@prisma/client';
import { db } from '../../core/db.js';
import { badRequest, forbidden, notFound } from '../../core/errors.js';
import { assertCan } from '../../core/permissions.js';
import { assertWritable, requireFeature, type Ctx } from '../../core/context.js';
import { writeAudit } from '../../core/audit.js';
import { notify, sendPush } from '../../core/notify.js';

// ─── Announcements ─────────────────────────────────────────────

async function myOrg(ctx: Ctx) {
  if (!ctx.employeeId) return { branchId: null, departmentId: null };
  const e = await db.employee.findUnique({ where: { id: ctx.employeeId }, select: { branchId: true, departmentId: true } });
  return { branchId: e?.branchId ?? null, departmentId: e?.departmentId ?? null };
}

export async function feed(ctx: Ctx, limit = 50) {
  requireFeature(ctx, 'announcements');
  const { branchId, departmentId } = await myOrg(ctx);
  const now = new Date();
  const canPost = !ctx.support && (ctx.role === 'OWNER' || ctx.role === 'HR_MANAGER' || ctx.role === 'HR_OFFICER');
  const rows = await db.announcement.findMany({
    where: {
      tenantId: ctx.tenantId,
      publishedAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        canPost ? {} : { OR: [{ audience: 'ALL' }, ...(branchId ? [{ audience: 'BRANCHES' as Audience, branchIds: { has: branchId } }] : []), ...(departmentId ? [{ audience: 'DEPARTMENTS' as Audience, departmentIds: { has: departmentId } }] : [])] },
      ],
    },
    include: { author: { select: { name: true } }, reads: { where: { userId: ctx.userId } }, _count: { select: { reads: true } } },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    take: limit,
  });
  return rows.map((a) => ({
    id: a.id, title: a.title, body: a.body, audience: a.audience, branchIds: a.branchIds, departmentIds: a.departmentIds,
    pinned: a.pinned, requireAck: a.requireAck, publishedAt: a.publishedAt, expiresAt: a.expiresAt, author: a.author.name,
    read: a.reads.length > 0, acknowledged: a.reads[0]?.acknowledged ?? false, readCount: canPost ? a._count.reads : undefined,
  }));
}

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: Audience;
  branchIds?: string[];
  departmentIds?: string[];
  pinned?: boolean;
  requireAck?: boolean;
  expiresAt?: string | null;
  push?: boolean;
}

async function audienceUserIds(tenantId: string, i: Pick<AnnouncementInput, 'audience' | 'branchIds' | 'departmentIds'>) {
  const where: Prisma.UserWhereInput = { tenantId, active: true };
  if (i.audience === 'BRANCHES') where.employee = { branchId: { in: i.branchIds ?? [] } };
  if (i.audience === 'DEPARTMENTS') where.employee = { departmentId: { in: i.departmentIds ?? [] } };
  return (await db.user.findMany({ where, select: { id: true } })).map((u) => u.id);
}

export async function post(ctx: Ctx, i: AnnouncementInput) {
  assertWritable(ctx);
  assertCan(ctx, 'announce.post');
  requireFeature(ctx, 'announcements');
  if (i.audience === 'BRANCHES' && !i.branchIds?.length) throw badRequest('Choose at least one branch.');
  if (i.audience === 'DEPARTMENTS' && !i.departmentIds?.length) throw badRequest('Choose at least one department.');
  if (ctx.role === 'HR_OFFICER' && ctx.branchScope.length && (i.audience !== 'BRANCHES' || i.branchIds!.some((b) => !ctx.branchScope.includes(b)))) {
    throw forbidden('You can post only to your own branches.');
  }
  const a = await db.announcement.create({
    data: {
      tenantId: ctx.tenantId, authorId: ctx.userId, title: i.title, body: i.body, audience: i.audience,
      branchIds: i.branchIds ?? [], departmentIds: i.departmentIds ?? [], pinned: !!i.pinned, requireAck: !!i.requireAck,
      expiresAt: i.expiresAt ? new Date(i.expiresAt) : null,
    },
  });
  await writeAudit(db, ctx, 'announcement.post', 'Announcement', a.id, null, { title: i.title, audience: i.audience });
  const ids = (await audienceUserIds(ctx.tenantId, i)).filter((x) => x !== ctx.userId);
  await notify({ tenantId: ctx.tenantId, userIds: ids, type: 'announcement', title: i.title, body: i.body.slice(0, 140), link: `/announcements`, push: i.push !== false });
  return a;
}

export async function remove(ctx: Ctx, id: string) {
  assertWritable(ctx);
  assertCan(ctx, 'announce.post');
  const a = await db.announcement.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Announcement');
  await db.announcement.delete({ where: { id } });
  await writeAudit(db, ctx, 'announcement.delete', 'Announcement', id, { title: a.title }, null);
}

export async function markRead(ctx: Ctx, id: string, acknowledge: boolean) {
  const a = await db.announcement.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Announcement');
  if (ctx.support) return { ok: true };
  await db.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId: ctx.userId } },
    create: { announcementId: id, userId: ctx.userId, acknowledged: acknowledge },
    update: acknowledge ? { acknowledged: true } : {},
  });
  return { ok: true };
}

export async function readers(ctx: Ctx, id: string) {
  assertCan(ctx, 'announce.post');
  const a = await db.announcement.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!a) throw notFound('Announcement');
  const [reads, audience] = await Promise.all([
    db.announcementRead.findMany({ where: { announcementId: id }, include: { user: { select: { id: true, name: true } } }, orderBy: { readAt: 'asc' } }),
    audienceUserIds(ctx.tenantId, a),
  ]);
  const readIds = new Set(reads.map((r) => r.userId));
  const notRead = await db.user.findMany({ where: { id: { in: audience.filter((u) => !readIds.has(u)) } }, select: { id: true, name: true } });
  return { audience: audience.length, read: reads.map((r) => ({ user: r.user, readAt: r.readAt, acknowledged: r.acknowledged })), notRead };
}

// ─── Messages ──────────────────────────────────────────────────

export async function people(ctx: Ctx, q?: string) {
  requireFeature(ctx, 'messaging');
  return db.user.findMany({
    where: { tenantId: ctx.tenantId, active: true, id: { not: ctx.userId }, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
    select: { id: true, name: true, role: true, employee: { select: { designation: true, department: { select: { name: true } } } } },
    orderBy: { name: 'asc' },
    take: 50,
  });
}

export async function conversations(ctx: Ctx) {
  requireFeature(ctx, 'messaging');
  const rows = await db.conversation.findMany({
    where: { tenantId: ctx.tenantId, members: { some: { userId: ctx.userId } } },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { name: true } } } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  const out = [];
  for (const c of rows) {
    const me = c.members.find((m) => m.userId === ctx.userId);
    const unread = await db.message.count({ where: { conversationId: c.id, senderId: { not: ctx.userId }, deletedAt: null, ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}) } });
    const others = c.members.filter((m) => m.userId !== ctx.userId).map((m) => m.user);
    out.push({
      id: c.id,
      kind: c.kind,
      title: c.kind === 'GROUP' ? c.title : others[0]?.name ?? 'Conversation',
      members: c.members.map((m) => m.user),
      last: c.messages[0] ? { body: c.messages[0].deletedAt ? 'Message removed' : c.messages[0].body.slice(0, 120), sender: c.messages[0].sender.name, at: c.messages[0].createdAt } : null,
      unread,
      lastMessageAt: c.lastMessageAt,
    });
  }
  return out;
}

export async function startConversation(ctx: Ctx, i: { userIds: string[]; title?: string | null }) {
  assertWritable(ctx);
  requireFeature(ctx, 'messaging');
  const ids = [...new Set(i.userIds.filter((u) => u !== ctx.userId))];
  if (!ids.length) throw badRequest('Choose at least one person.');
  const n = await db.user.count({ where: { tenantId: ctx.tenantId, id: { in: ids }, active: true } });
  if (n !== ids.length) throw badRequest('Unknown person in the list.');
  if (ids.length === 1) {
    const existing = await db.conversation.findFirst({
      where: { tenantId: ctx.tenantId, kind: 'DIRECT', AND: [{ members: { some: { userId: ctx.userId } } }, { members: { some: { userId: ids[0] } } }] },
    });
    if (existing) return existing;
  } else if (!i.title) throw badRequest('Give the group a name.');
  return db.conversation.create({
    data: {
      tenantId: ctx.tenantId,
      kind: ids.length === 1 ? 'DIRECT' : 'GROUP',
      title: ids.length === 1 ? null : i.title,
      createdById: ctx.userId,
      members: { create: [{ userId: ctx.userId, isAdmin: true }, ...ids.map((userId) => ({ userId }))] },
    },
  });
}

async function memberOf(ctx: Ctx, conversationId: string) {
  const c = await db.conversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId, members: { some: { userId: ctx.userId } } }, include: { members: true } });
  if (!c) throw notFound('Conversation');
  return c;
}

export async function messages(ctx: Ctx, conversationId: string, since?: string, before?: string) {
  const c = await memberOf(ctx, conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, ...(since ? { createdAt: { gt: new Date(since) } } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    include: { sender: { select: { id: true, name: true } } },
    orderBy: { createdAt: since ? 'asc' : 'desc' },
    take: 100,
  });
  if (!ctx.support) await db.conversationMember.updateMany({ where: { conversationId, userId: ctx.userId }, data: { lastReadAt: new Date() } });
  const list = since ? rows : rows.reverse();
  return { conversation: { id: c.id, kind: c.kind, title: c.title }, messages: list.map((m) => ({ id: m.id, body: m.deletedAt ? null : m.body, deleted: !!m.deletedAt, sender: m.sender, mine: m.senderId === ctx.userId, createdAt: m.createdAt })) };
}

export async function send(ctx: Ctx, conversationId: string, body: string) {
  assertWritable(ctx);
  const c = await memberOf(ctx, conversationId);
  const text = body.trim();
  if (!text) throw badRequest('Write a message.');
  const m = await db.message.create({ data: { conversationId, senderId: ctx.userId, body: text } });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
  await db.conversationMember.updateMany({ where: { conversationId, userId: ctx.userId }, data: { lastReadAt: m.createdAt } });
  const others = c.members.map((x) => x.userId).filter((u) => u !== ctx.userId);
  sendPush(others, c.kind === 'GROUP' ? `${ctx.name} in ${c.title}` : ctx.name, text.slice(0, 120), { type: 'message', link: `/messages?c=${conversationId}` }).catch(() => undefined);
  return { id: m.id, createdAt: m.createdAt };
}

export async function deleteMessage(ctx: Ctx, id: string) {
  const m = await db.message.findFirst({ where: { id, senderId: ctx.userId, conversation: { tenantId: ctx.tenantId } } });
  if (!m) throw notFound('Message');
  await db.message.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function unreadCount(ctx: Ctx) {
  const mems = await db.conversationMember.findMany({ where: { userId: ctx.userId }, select: { conversationId: true, lastReadAt: true } });
  let n = 0;
  for (const m of mems) n += await db.message.count({ where: { conversationId: m.conversationId, senderId: { not: ctx.userId }, deletedAt: null, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) } });
  return n;
}
