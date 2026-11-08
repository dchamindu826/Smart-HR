import { z } from 'zod';
import { isDate } from '../lib/time.js';
import { toCents } from '../lib/money.js';

export { z };

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const id = z.string().min(1).max(40);
export const dateStr = z.string().refine(isDate, 'Use the format YYYY-MM-DD.');
export const periodStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM.');
export const minute = z.number().int().min(0).max(1440);
export const hhmmStr = z.string().regex(/^([01]?\d|2[0-4]):[0-5]\d$/, 'Use the format HH:MM.');

/** Money on the wire is a string like "12345.50". Numbers are accepted and converted. */
export const money = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      const c = toCents(v);
      return (c / 100).toFixed(2);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 12500.00.' });
      return z.NEVER;
    }
  });

export const optionalText = (max = 500) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()));

export const email = z.string().trim().toLowerCase().email('Enter a valid email address.');
export const phone = z
  .string()
  .trim()
  .transform((v) => normalisePhone(v))
  .refine((v) => /^\+94\d{9}$/.test(v), 'Enter a Sri Lankan mobile number like 0771234567.');

export function normalisePhone(v: string): string {
  const d = v.replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(d)) return '+94' + d.slice(1);
  if (/^94\d{9}$/.test(d)) return '+' + d;
  if (/^\+94\d{9}$/.test(d)) return d;
  if (/^\d{9}$/.test(d)) return '+94' + d;
  return d;
}

export const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one number.');

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
});

export function paging(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/** Sri Lankan NIC: old 9 digits + V/X, or new 12 digits. */
export const nic = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => /^\d{9}[VX]$/.test(v) || /^\d{12}$/.test(v), 'Enter a valid NIC (123456789V or 200012345678).');
