/**
 * Company settings (stored in Tenant.settings as JSON) and platform-wide
 * statutory values (SystemSetting rows). Defaults live here, in one place.
 */

import { z } from 'zod';
import { db } from './db.js';
import { toCents, pctToBp } from '../lib/money.js';
import type { AttendanceRules, LocationPolicy } from '../rules/attendance.js';
import type { RosterRules } from '../rules/roster.js';
import type { PayRates, TaxBandC } from '../rules/payroll.js';

export const tenantSettingsSchema = z.object({
  // working time
  normalDayMinutes: z.number().int().min(60).max(720).default(480),
  mealMinutes: z.number().int().min(0).max(120).default(60),
  mealStart: z.number().int().min(0).max(1440).default(720),
  mealEnd: z.number().int().min(0).max(1440).default(780),
  graceMinutes: z.number().int().min(0).max(120).default(15),
  otMinMinutes: z.number().int().min(0).max(240).default(30),
  otRoundMinutes: z.number().int().min(1).max(60).default(15),
  // normal paid minutes Mon…Sun for people not on a roster
  workWeek: z.array(z.number().int().min(0).max(720)).length(7).default([480, 480, 480, 480, 480, 0, 0]),
  weeklyOtCapMinutes: z.number().int().min(0).max(720).default(720), // statutory ceiling; cannot be raised
  maxDayMinutes: z.number().int().min(60).max(1440).default(960),
  minRestMinutes: z.number().int().min(0).max(1440).default(480),

  // attendance capture (Head of HR can switch these on/off)
  requireLocation: z.boolean().default(true),
  requireFace: z.boolean().default(false),
  allowRemote: z.boolean().default(true),
  officeMustBeInFence: z.boolean().default(true),
  remoteFlagMeters: z.number().int().min(100).max(50_000).default(2000),
  maxAccuracyM: z.number().int().min(10).max(1000).default(150),
  allowWebPunch: z.boolean().default(false),

  // pay
  otRatePct: z.number().min(100).max(300).default(150),
  otDivisorHours: z.number().int().min(150).max(300).default(240), // verify (open question 1)
  noPayDivisorDays: z.number().int().min(20).max(31).default(30),
  payDay: z.number().int().min(1).max(31).default(25),
  absentIsNoPay: z.boolean().default(true), // an unexplained absence is a no-pay day
  autoReleasePayslips: z.boolean().default(false),

  // leave
  leaveYearStartMonth: z.number().int().min(1).max(12).default(1),

  // notifications
  birthdayNotifications: z.boolean().default(true),
  notifyManagerOnLate: z.boolean().default(true),

  // roster
  rosterRequiresApproval: z.boolean().default(true),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export function readSettings(raw: unknown): TenantSettings {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const r = tenantSettingsSchema.safeParse(obj);
  if (r.success) return enforceStatutory(r.data);
  // keep valid keys, fall back to defaults for the rest
  const defaults = tenantSettingsSchema.parse({});
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const field = (tenantSettingsSchema.shape as Record<string, z.ZodTypeAny>)[k];
    if (field && field.safeParse(v).success) out[k] = v;
  }
  return enforceStatutory(out as TenantSettings);
}

/** Statutory limits that no company setting can loosen. */
function enforceStatutory(s: TenantSettings): TenantSettings {
  return { ...s, weeklyOtCapMinutes: Math.min(s.weeklyOtCapMinutes, 720) };
}

export function attendanceRules(s: TenantSettings): AttendanceRules {
  return {
    normalDayMinutes: s.normalDayMinutes,
    mealMinutes: s.mealMinutes,
    mealStart: s.mealStart,
    mealEnd: s.mealEnd,
    graceMinutes: s.graceMinutes,
    otMinMinutes: s.otMinMinutes,
    otRoundMinutes: s.otRoundMinutes,
    workWeek: [0, ...s.workWeek],
  };
}

export function rosterRules(s: TenantSettings): RosterRules {
  return {
    normalDayMinutes: s.normalDayMinutes,
    mealMinutes: s.mealMinutes,
    mealStart: s.mealStart,
    mealEnd: s.mealEnd,
    weeklyOtCapMinutes: s.weeklyOtCapMinutes,
    maxDayMinutes: s.maxDayMinutes,
    minRestMinutes: s.minRestMinutes,
  };
}

export function locationPolicy(
  s: TenantSettings,
  emp: { allowRemote: boolean | null; requireLocation: boolean | null },
): LocationPolicy {
  return {
    requireLocation: emp.requireLocation ?? s.requireLocation,
    allowRemote: emp.allowRemote ?? s.allowRemote,
    officeMustBeInFence: s.officeMustBeInFence,
    remoteFlagMeters: s.remoteFlagMeters,
    maxAccuracyM: s.maxAccuracyM,
  };
}

// ─── Platform statutory values ─────────────────────────────────

export const SYSTEM_DEFAULTS = {
  'epf.employeePct': { value: 8, note: 'EPF employee contribution %' },
  'epf.employerPct': { value: 12, note: 'EPF employer contribution %' },
  'etf.employerPct': { value: 3, note: 'ETF employer contribution %' },
  'stampDuty.threshold': { value: '25000.00', note: 'Stamp duty applies when monthly pay is at or above this (verify)' },
  'stampDuty.amount': { value: '25.00', note: 'Stamp duty per payslip (verify)' },
  'gratuity.minEmployees': { value: 15, note: 'Gratuity Act applies to employers with this many workers or more' },
} as const;

type SysKey = keyof typeof SYSTEM_DEFAULTS;

export async function systemValue<K extends SysKey>(key: K): Promise<(typeof SYSTEM_DEFAULTS)[K]['value']> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return (row?.value ?? SYSTEM_DEFAULTS[key].value) as (typeof SYSTEM_DEFAULTS)[K]['value'];
}

export async function apitBands(onDate: string): Promise<TaxBandC[]> {
  const latest = await db.taxBand.findFirst({
    where: { table: 'APIT_MONTHLY', effectiveFrom: { lte: new Date(onDate + 'T00:00:00Z') } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!latest) return [];
  const rows = await db.taxBand.findMany({
    where: { table: 'APIT_MONTHLY', effectiveFrom: latest.effectiveFrom },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((b) => ({ from: toCents(b.fromAmount), to: b.toAmount === null ? null : toCents(b.toAmount), rateBp: pctToBp(b.ratePct.toString()) }));
}

export async function payRates(s: TenantSettings, onDate: string): Promise<PayRates> {
  const [ee, er, etf, th, amt, bands] = await Promise.all([
    systemValue('epf.employeePct'),
    systemValue('epf.employerPct'),
    systemValue('etf.employerPct'),
    systemValue('stampDuty.threshold'),
    systemValue('stampDuty.amount'),
    apitBands(onDate),
  ]);
  return {
    epfEmployeeBp: pctToBp(ee),
    epfEmployerBp: pctToBp(er),
    etfBp: pctToBp(etf),
    otRateBp: pctToBp(s.otRatePct),
    otDivisorHours: s.otDivisorHours,
    noPayDivisorDays: s.noPayDivisorDays,
    stampDutyThreshold: toCents(th),
    stampDuty: toCents(amt),
    apitBands: bands,
  };
}
