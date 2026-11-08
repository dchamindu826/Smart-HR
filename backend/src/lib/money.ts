/**
 * Money. Rules work in integer cents (a plain number; safe far beyond any
 * payroll). The database stores Decimal(14,2). The wire carries strings
 * "12345.50". Never use floating-point rupees.
 */

export type Cents = number;

/** "12,345.5" | "12345.50" | 12345.5 | Decimal → 1234550 */
export function toCents(v: unknown): Cents {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Invalid amount');
    return Math.round(v * 100);
  }
  const s = String(typeof v === 'object' && v !== null && 'toString' in v ? (v as { toString(): string }).toString() : v)
    .replace(/,/g, '')
    .trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${s}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  // half-up on the third decimal
  const frac2 = (f + '000').slice(0, 3);
  let c = Number(i) * 100 + Number(frac2.slice(0, 2));
  if (Number(frac2[2]) >= 5) c += 1;
  return neg ? -c : c;
}

/** 1234550 → "12345.50" (for the database and the wire) */
export function fromCents(c: Cents): string {
  const neg = c < 0;
  const v = Math.abs(Math.round(c));
  const s = `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** 1234550 → "12,345.50" (for display) */
export function formatLkr(c: Cents): string {
  const [i, f] = fromCents(Math.abs(c)).split('.');
  const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${c < 0 ? '−' : ''}${withCommas}.${f}`;
}

/**
 * cents × (numerator / denominator), half-up. All integer arithmetic, so a
 * percentage is pct(base, 800, 10000) for 8.00 %.
 */
export function mulDiv(c: Cents, numerator: number, denominator: number): Cents {
  if (denominator === 0) throw new Error('Division by zero');
  if (!Number.isInteger(c) || !Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error('mulDiv takes integers only');
  }
  // BigInt so large salaries × large factors never lose precision
  const neg = (c < 0) !== (numerator < 0) !== (denominator < 0);
  const a = BigInt(Math.abs(c)) * BigInt(Math.abs(numerator));
  const d = BigInt(Math.abs(denominator));
  const q = a / d;
  const r = a - q * d;
  const out = r * 2n >= d ? q + 1n : q;
  return Number(neg ? -out : out);
}

/** Percentage given as a string or number like "8" or 12.5 → basis points */
export function pctToBp(p: string | number): number {
  return Math.round(Number(p) * 100);
}

/** c × pct %, with pct in basis points (800 = 8 %). */
export function percent(c: Cents, basisPoints: number): Cents {
  return mulDiv(c, basisPoints, 10_000);
}

export function sum(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

export function max0(c: Cents): Cents {
  return c < 0 ? 0 : c;
}
