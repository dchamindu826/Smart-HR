/**
 * Audit trail. Append-only: rows are never updated or deleted.
 * Write inside the same transaction as the change.
 */

import type { Prisma } from '@prisma/client';
import { db, type Tx } from './db.js';
import type { Ctx } from './context.js';

const SECRET_KEYS = new Set(['passwordHash', 'password', 'totpSecret', 'apiKeyHash', 'tokenHash', 'accountNo']);

function clean(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => {
      if (SECRET_KEYS.has(k)) return val ? '•••' : val;
      if (typeof val === 'bigint') return val.toString();
      return val;
    }),
  );
}

export async function writeAudit(
  tx: Tx | typeof db,
  ctx: Pick<Ctx, 'tenantId' | 'userId' | 'name' | 'ip' | 'support'>,
  action: string,
  entity: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.support ? `platform:${ctx.support.adminId}` : ctx.userId,
      actorName: ctx.support ? `Lumi AI support (${ctx.name})` : ctx.name,
      action,
      entity,
      entityId,
      before: clean(before),
      after: clean(after),
      ip: ctx.ip,
    },
  });
}

/** Only the fields that changed, for a compact before/after. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const x = before[k];
    const y = after[k];
    const sx = x instanceof Date ? x.toISOString() : JSON.stringify(x ?? null);
    const sy = y instanceof Date ? (y as Date).toISOString() : JSON.stringify(y ?? null);
    if (sx !== sy) {
      b[k] = x;
      a[k] = y as T[keyof T];
    }
  }
  return { before: b, after: a };
}
