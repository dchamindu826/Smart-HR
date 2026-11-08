import { PrismaClient, Prisma } from '@prisma/client';

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const db: PrismaClient =
  g.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') g.__prisma = db;

export type Tx = Prisma.TransactionClient;
export { Prisma };

/** Decimal (or null) → string for the wire. */
export function dec(v: Prisma.Decimal | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toFixed(2);
}

export function decNum(v: Prisma.Decimal | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v.toString());
}
