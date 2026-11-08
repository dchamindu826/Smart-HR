/**
 * Roster rules — pure.
 *
 * The roster maker sets each day's blocks. A normal day is 9 hours including
 * a 1-hour unpaid meal = 8 paid hours. Paid minutes above the normal day are
 * planned overtime (a 10-hour day = 1 hour planned OT).
 *
 * Statutory limits are errors, not warnings, and no role can override them:
 *   - at least one weekly rest day
 *   - planned OT + already-approved unrostered OT ≤ the weekly ceiling (12 h)
 */

import { addDays, isoWeekday } from '../lib/time.js';
import { mealDeduction, mergeTouching, type Block, type Mode } from './attendance.js';

export interface RosterSegment extends Block {
  mode: Mode;
}

export interface RosterRules {
  normalDayMinutes: number; // 480
  mealMinutes: number; // 60
  mealStart: number; // 720
  mealEnd: number; // 780
  weeklyOtCapMinutes: number; // 720
  maxDayMinutes: number; // 960 = 16 h on the premises in one day
  minRestMinutes: number; // 480 between the end of one day and the next start (warning)
}

export interface DayPlan {
  totalMinutes: number;
  mealMinutes: number;
  paidMinutes: number;
  plannedOtMinutes: number;
}

/** Totals for one day's segments. */
export function planDay(segments: Block[], rules: RosterRules): DayPlan {
  const merged = mergeTouching(segments);
  const total = merged.reduce((a, b) => a + (b.end - b.start), 0);
  if (total === 0) return { totalMinutes: 0, mealMinutes: 0, paidMinutes: 0, plannedOtMinutes: 0 };
  const meal = mealDeduction(merged, rules);
  const paid = Math.max(0, total - meal);
  return { totalMinutes: total, mealMinutes: meal, paidMinutes: paid, plannedOtMinutes: Math.max(0, paid - rules.normalDayMinutes) };
}

/**
 * The maker types a shift as start/end; an end at or before the start means it
 * runs past midnight. This returns the pieces per date, each within 0–1440.
 */
export function splitShift(date: string, start: number, end: number, mode: Mode): { date: string; segment: RosterSegment }[] {
  if (start < 0 || start >= 1440) throw new Error('Start time must be between 00:00 and 23:59.');
  if (end < 0 || end > 1440) throw new Error('End time must be between 00:00 and 24:00.');
  if (end > start) return [{ date, segment: { start, end, mode } }];
  const out = [{ date, segment: { start, end: 1440, mode } }];
  if (end > 0) out.push({ date: addDays(date, 1), segment: { start: 0, end, mode } });
  return out;
}

export interface WeekDayInput {
  employeeId: string;
  employeeName?: string;
  date: string;
  isOff: boolean;
  segments: RosterSegment[];
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  employeeId: string;
  date?: string;
  message: string;
}

export interface WeekCheck {
  issues: Issue[];
  days: Record<string, Record<string, DayPlan>>; // employeeId → date → plan
  weeklyOt: Record<string, number>; // employeeId → planned OT minutes in the week
}

/**
 * Validate one Monday–Sunday week for many employees.
 * `approvedUnrosteredOt` is overtime already approved this week outside the roster.
 * `holidays` maps date → name for premium dates.
 */
export function validateWeek(
  weekStart: string,
  days: WeekDayInput[],
  rules: RosterRules,
  approvedUnrosteredOt: Record<string, number> = {},
  holidays: Record<string, string> = {},
): WeekCheck {
  const issues: Issue[] = [];
  const out: WeekCheck = { issues, days: {}, weeklyOt: {} };
  if (isoWeekday(weekStart) !== 1) {
    issues.push({ level: 'error', code: 'WEEK_START', employeeId: '', message: 'A roster week starts on Monday.' });
    return out;
  }
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byEmp = new Map<string, WeekDayInput[]>();
  for (const d of days) {
    if (!weekDates.includes(d.date)) {
      issues.push({ level: 'error', code: 'OUTSIDE_WEEK', employeeId: d.employeeId, date: d.date, message: `${d.date} is not in this week.` });
      continue;
    }
    const arr = byEmp.get(d.employeeId) ?? [];
    arr.push(d);
    byEmp.set(d.employeeId, arr);
  }

  for (const [emp, list] of byEmp) {
    const who = list[0]?.employeeName ?? 'This employee';
    const perDate = new Map<string, WeekDayInput>();
    for (const d of list) {
      if (perDate.has(d.date)) {
        issues.push({ level: 'error', code: 'DUPLICATE_DAY', employeeId: emp, date: d.date, message: `${who} has two entries for ${d.date}.` });
        continue;
      }
      perDate.set(d.date, d);
    }

    out.days[emp] = {};
    let weekOt = 0;
    let restDays = 0;
    let prevEnd: { date: string; minute: number } | null = null;

    for (const date of weekDates) {
      const d = perDate.get(date);
      if (!d || d.isOff || d.segments.length === 0) {
        restDays++;
        out.days[emp][date] = { totalMinutes: 0, mealMinutes: 0, paidMinutes: 0, plannedOtMinutes: 0 };
        prevEnd = null;
        continue;
      }
      // shape of each segment
      let bad = false;
      for (const s of d.segments) {
        if (!(Number.isInteger(s.start) && Number.isInteger(s.end)) || s.start < 0 || s.end > 1440 || s.end <= s.start) {
          issues.push({ level: 'error', code: 'BAD_SEGMENT', employeeId: emp, date, message: `${who}: a time block on ${date} ends before it starts.` });
          bad = true;
        }
      }
      const sorted = [...d.segments].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
          issues.push({ level: 'error', code: 'OVERLAP', employeeId: emp, date, message: `${who}: time blocks overlap on ${date}.` });
          bad = true;
        }
      }
      if (bad) continue;

      const plan = planDay(d.segments, rules);
      out.days[emp][date] = plan;
      weekOt += plan.plannedOtMinutes;

      if (plan.totalMinutes > rules.maxDayMinutes) {
        issues.push({ level: 'error', code: 'DAY_TOO_LONG', employeeId: emp, date, message: `${who}: ${Math.floor(plan.totalMinutes / 60)} hours on ${date} is more than the ${rules.maxDayMinutes / 60}-hour limit.` });
      }
      if (holidays[date] && plan.paidMinutes > 0) {
        issues.push({ level: 'warning', code: 'HOLIDAY_WORK', employeeId: emp, date, message: `${who} is rostered on ${holidays[date]} (${date}). Holiday pay applies.` });
      }
      const first = sorted[0].start;
      if (prevEnd && prevEnd.minute === 1440 && first === 0) {
        // a night shift continuing past midnight; not a short rest
      } else if (prevEnd) {
        const rest = 1440 - prevEnd.minute + first;
        if (rest < rules.minRestMinutes) {
          issues.push({ level: 'warning', code: 'SHORT_REST', employeeId: emp, date, message: `${who} has only ${Math.floor(rest / 60)} h ${rest % 60} min rest before ${date}.` });
        }
      }
      prevEnd = { date, minute: sorted[sorted.length - 1].end };
    }

    out.weeklyOt[emp] = weekOt;
    if (restDays === 0) {
      issues.push({ level: 'error', code: 'NO_REST_DAY', employeeId: emp, message: `${who} has no rest day this week. At least one weekly rest day is required by law.` });
    }
    const existing = approvedUnrosteredOt[emp] ?? 0;
    if (weekOt + existing > rules.weeklyOtCapMinutes) {
      const fmt = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
      issues.push({
        level: 'error',
        code: 'OT_CAP',
        employeeId: emp,
        message: `${who}: ${fmt(weekOt)} planned overtime${existing ? ` + ${fmt(existing)} already approved` : ''} is more than the ${fmt(rules.weeklyOtCapMinutes)} weekly limit.`,
      });
    }
  }
  return out;
}

export function hasErrors(c: WeekCheck): boolean {
  return c.issues.some((i) => i.level === 'error');
}

/** Turn a shift pattern's blocks into roster segments. */
export function patternSegments(pattern: { segments: Block[] }, mode: Mode = 'OFFICE'): RosterSegment[] {
  return pattern.segments.map((s) => ({ start: s.start, end: Math.min(1440, s.end), mode }));
}

export function patternTotal(segments: Block[]): number {
  return segments.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
}
