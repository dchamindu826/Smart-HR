/**
 * Leave entitlement — pure.
 *
 * Shop and Office Employees Act (verify against the current Act before a live payroll):
 *   Annual leave: none in the calendar year of joining. In the next calendar
 *     year it depends on the quarter of joining: Jan–Mar 14, Apr–Jun 10,
 *     Jul–Sep 7, Oct–Dec 4. From the year after that, 14 days.
 *   Casual leave: 7 days a year. In the year of joining, 1 day for every
 *     2 completed months of service (max 7).
 * Everything here is a constant in STATUTORY so it can be checked in one place.
 */

import { completedMonths, eachDate } from '../lib/time.js';

export const STATUTORY = {
  annualFull: 14,
  annualSecondYearByQuarter: [14, 10, 7, 4] as const, // joined in Q1, Q2, Q3, Q4
  casualFull: 7,
  casualFirstYearMonthsPerDay: 2,
  maternityDays: 84, // working days, first and second child (verify)
};

export type Rule = 'STATUTORY_ANNUAL' | 'STATUTORY_CASUAL' | 'FIXED' | 'MATERNITY' | 'NO_PAY';

export interface EntitlementInput {
  rule: Rule;
  daysPerYear: number; // for FIXED / MATERNITY
  joinDate: string; // YYYY-MM-DD
  year: number;
  asOf: string; // for the joining-year casual calculation
  endDate?: string | null;
}

/** Days entitled for `year`. Returns 0 for years before joining or after leaving. */
export function entitlement(i: EntitlementInput): number {
  const joinYear = Number(i.joinDate.slice(0, 4));
  if (i.year < joinYear) return 0;
  if (i.endDate && Number(i.endDate.slice(0, 4)) < i.year) return 0;

  switch (i.rule) {
    case 'STATUTORY_ANNUAL': {
      if (i.year === joinYear) return 0;
      if (i.year === joinYear + 1) {
        const q = Math.floor((Number(i.joinDate.slice(5, 7)) - 1) / 3);
        return STATUTORY.annualSecondYearByQuarter[q];
      }
      return STATUTORY.annualFull;
    }
    case 'STATUTORY_CASUAL': {
      if (i.year > joinYear) return STATUTORY.casualFull;
      const yearEnd = `${i.year}-12-31`;
      const upTo = i.asOf < yearEnd ? i.asOf : yearEnd;
      const months = completedMonths(i.joinDate, upTo);
      return Math.min(STATUTORY.casualFull, Math.floor(months / STATUTORY.casualFirstYearMonthsPerDay));
    }
    case 'FIXED':
      return i.daysPerYear;
    case 'MATERNITY':
      return i.daysPerYear || STATUTORY.maternityDays;
    case 'NO_PAY':
      return 0;
  }
}

/**
 * Leave days a request uses. Non-working days (rest days, paid holidays) in
 * the range are not counted. A half day is only allowed for a single date.
 */
export function countLeaveDays(
  from: string,
  to: string,
  halfDay: 'AM' | 'PM' | null,
  isWorkingDay: (date: string) => boolean,
): number {
  if (to < from) throw new Error('The end date is before the start date.');
  if (halfDay) {
    if (from !== to) throw new Error('A half day must be a single date.');
    return isWorkingDay(from) ? 0.5 : 0;
  }
  return eachDate(from, to).filter(isWorkingDay).length;
}

export interface BalanceRow {
  entitled: number;
  carried: number;
  adjusted: number;
  taken: number;
}

export function available(b: BalanceRow, pending = 0): number {
  return round1(b.entitled + b.carried + b.adjusted - b.taken - pending);
}

/** Carry forward into next year, capped. */
export function carryForward(b: BalanceRow, cap: number): number {
  return round1(Math.max(0, Math.min(cap, available(b))));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
