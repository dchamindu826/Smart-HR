/**
 * Overtime rules — pure.
 *
 * Planned OT comes from the published roster and is approved with it.
 * Unrostered OT is detected at day close; the employee must give a reason
 * (10+ characters) and the manager must approve. It is never paid otherwise.
 * Approval is refused if it would take the week past the ceiling.
 * A holiday premium is not overtime and does not count toward the ceiling.
 */

import { mulDiv } from '../lib/money.js';

export const MIN_REASON_LENGTH = 10;

export function validReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.trim().length >= MIN_REASON_LENGTH;
}

export interface CapCheck {
  allowed: boolean;
  usedMinutes: number;
  afterMinutes: number;
  capMinutes: number;
  message?: string;
}

/** Can `adding` more OT minutes be approved in a week that already has `used`? */
export function checkWeeklyCap(usedMinutes: number, adding: number, capMinutes: number): CapCheck {
  const after = usedMinutes + adding;
  if (after <= capMinutes) return { allowed: true, usedMinutes, afterMinutes: after, capMinutes };
  const left = Math.max(0, capMinutes - usedMinutes);
  return {
    allowed: false,
    usedMinutes,
    afterMinutes: after,
    capMinutes,
    message: `This would make ${fmt(after)} overtime this week. The legal limit is ${fmt(capMinutes)}; ${fmt(left)} is left.`,
  };
}

function fmt(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** OT pay in cents: basic ÷ divisor = hourly; × rate; × hours. Integer maths. */
export function overtimePay(basicCents: number, minutes: number, divisorHours: number, rateBp: number): number {
  if (minutes <= 0 || basicCents <= 0) return 0;
  return mulDiv(basicCents, rateBp * minutes, divisorHours * 10_000 * 60);
}
