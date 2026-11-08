/**
 * Attendance rules — pure functions, no database, `now` passed in.
 *
 * A day is 00:00–23:59 Asia/Colombo. A person can have many sessions in a day,
 * mixing OFFICE and REMOTE. A session that crosses midnight is split into two.
 * The meal hour is deducted only when one unbroken session covers the whole
 * meal window (default 12:00–13:00); nobody marks out for lunch.
 */

import { addDays, colomboDate, colomboInstant, colomboMinute, colomboMidnightAfter, minutesBetween } from '../lib/time.js';
import { distanceM, insideFence, validLatLng, type Fence } from '../lib/geo.js';

export type Mode = 'OFFICE' | 'REMOTE';

export interface Block {
  start: number; // minute after midnight
  end: number; // minute after midnight, > start, ≤ 1440
}

export interface AttendanceRules {
  normalDayMinutes: number; // 480 = 8 paid hours
  mealMinutes: number; // 60
  mealStart: number; // 720 = 12:00
  mealEnd: number; // 780 = 13:00
  graceMinutes: number; // late after this many minutes
  otMinMinutes: number; // OT below this is ignored
  otRoundMinutes: number; // OT rounded down to blocks of this size
  workWeek: number[]; // index 1…7 (Mon…Sun) → normal paid minutes for people not on a roster; index 0 unused
}

// ─── Punch planning ─────────────────────────────────────────────

export interface OpenSession {
  id: string;
  startAt: Date;
  mode: Mode;
}

export interface PunchInput {
  kind: 'IN' | 'OUT';
  occurredAt: Date;
  mode: Mode;
}

export type PunchPlan =
  | { action: 'OPEN' }
  | { action: 'CLOSE'; sessionId: string }
  | { action: 'REJECT'; reason: string };

/** What a punch does, given the session that is open now (if any). */
export function planPunch(open: OpenSession | null, p: PunchInput, now: Date): PunchPlan {
  const ahead = p.occurredAt.getTime() - now.getTime();
  if (ahead > 5 * 60_000) return { action: 'REJECT', reason: 'The phone clock is ahead of the server. Set the time automatically and try again.' };
  if (now.getTime() - p.occurredAt.getTime() > 7 * 86_400_000) return { action: 'REJECT', reason: 'This punch is more than 7 days old. Ask HR for a correction.' };

  if (p.kind === 'IN') {
    if (open) return { action: 'REJECT', reason: 'You are already marked in. Mark out first.' };
    return { action: 'OPEN' };
  }
  if (!open) return { action: 'REJECT', reason: 'You are not marked in.' };
  if (p.occurredAt.getTime() <= open.startAt.getTime()) return { action: 'REJECT', reason: 'Mark-out time is before mark-in time.' };
  return { action: 'CLOSE', sessionId: open.id };
}

// ─── Location ───────────────────────────────────────────────────

export interface LocationPolicy {
  requireLocation: boolean;
  allowRemote: boolean;
  officeMustBeInFence: boolean;
  remoteFlagMeters: number; // remote further than this from home is flagged
  maxAccuracyM: number; // fixes vaguer than this are refused
}

export interface LocationInput {
  mode: Mode;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  mocked?: boolean;
}

export interface LocationResult {
  ok: boolean;
  reason?: string;
  branchId?: string | null;
  distanceHomeM?: number | null;
  flags: string[];
}

export function checkLocation(
  input: LocationInput,
  policy: LocationPolicy,
  fences: Fence[],
  home: { lat: number; lng: number } | null,
): LocationResult {
  const flags: string[] = [];
  const has = validLatLng(input.lat, input.lng);
  if (input.mocked) flags.push('MOCK_LOCATION');

  if (input.mode === 'REMOTE' && !policy.allowRemote) {
    return { ok: false, reason: 'Remote work is not allowed for you. Mark in at the office.', flags };
  }
  // GPS is mandatory for remote work, whatever the company setting.
  if (input.mode === 'REMOTE' && !has) {
    return { ok: false, reason: 'Turn on location. Your location is required to mark in remotely.', flags };
  }
  if (!has) {
    if (policy.requireLocation) return { ok: false, reason: 'Turn on location to mark attendance.', flags };
    return { ok: true, branchId: null, distanceHomeM: null, flags };
  }
  if (input.accuracyM != null && input.accuracyM > policy.maxAccuracyM) {
    return { ok: false, reason: `Location is not accurate enough (±${Math.round(input.accuracyM)} m). Move to an open area and try again.`, flags };
  }
  const lat = input.lat as number;
  const lng = input.lng as number;

  if (input.mode === 'OFFICE') {
    const hit = insideFence(lat, lng, input.accuracyM, fences);
    if (!hit) {
      if (policy.officeMustBeInFence && fences.length > 0) {
        return { ok: false, reason: 'You are not at an office location. Mark in when you reach the office, or choose remote work.', flags };
      }
      return { ok: true, branchId: null, distanceHomeM: null, flags: [...flags, 'OUTSIDE_FENCE'] };
    }
    return { ok: true, branchId: hit.fence.id, distanceHomeM: null, flags };
  }

  // REMOTE: recorded, and flagged if far from the registered address.
  let dHome: number | null = null;
  if (home && validLatLng(home.lat, home.lng)) {
    dHome = distanceM(lat, lng, home.lat, home.lng);
    if (dHome > policy.remoteFlagMeters) flags.push('FAR_FROM_HOME');
  } else {
    flags.push('NO_HOME_ADDRESS');
  }
  return { ok: true, branchId: null, distanceHomeM: dHome, flags };
}

// ─── Splitting at midnight ─────────────────────────────────────

export interface DayPiece {
  date: string;
  startAt: Date;
  endAt: Date;
  minutes: number;
}

/** Cuts an interval at every Colombo midnight it crosses. */
export function splitAtMidnight(startAt: Date, endAt: Date): DayPiece[] {
  if (endAt.getTime() <= startAt.getTime()) return [];
  const out: DayPiece[] = [];
  let s = startAt;
  while (s.getTime() < endAt.getTime()) {
    const date = colomboDate(s);
    const midnight = colomboMidnightAfter(date);
    const e = midnight.getTime() < endAt.getTime() ? midnight : endAt;
    out.push({ date, startAt: s, endAt: e, minutes: minutesBetween(s, e) });
    s = e;
  }
  return out;
}

/** A session on its own date as minutes after midnight. */
export function toBlock(date: string, startAt: Date, endAt: Date): Block {
  const dayStart = colomboInstant(date, 0).getTime();
  const start = Math.max(0, Math.floor((startAt.getTime() - dayStart) / 60_000));
  const end = Math.min(1440, Math.floor((endAt.getTime() - dayStart) / 60_000));
  return { start, end: Math.max(start, end) };
}

// ─── Meal deduction ─────────────────────────────────────────────

/** Meal minutes to deduct: only if one block covers the whole meal window. */
export function mealDeduction(blocks: Block[], rules: Pick<AttendanceRules, 'mealStart' | 'mealEnd' | 'mealMinutes'>): number {
  const covered = blocks.some((b) => b.start <= rules.mealStart && b.end >= rules.mealEnd);
  return covered ? rules.mealMinutes : 0;
}

export function blockMinutes(blocks: Block[]): number {
  return blocks.reduce((a, b) => a + Math.max(0, b.end - b.start), 0);
}

export function mergeTouching(blocks: Block[]): Block[] {
  const s = [...blocks].filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const out: Block[] = [];
  for (const b of s) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

// ─── Day totals (used by the day-close job) ────────────────────

export interface RosterForDay {
  isOff: boolean;
  blocks: Block[];
  paidMinutes: number;
  plannedOtMinutes: number;
}

export interface DayInput {
  date: string;
  sessions: Block[]; // closed sessions on this date
  hadOpenSession: boolean; // a session was still open at day end (auto-closed)
  roster: RosterForDay | null; // null = no roster for this person/date
  usesRoster: boolean; // this person is in a roster group
  holiday: { multiplier: number; isPaidOff: boolean } | null;
  leave: { days: number } | null; // 1 = full day, 0.5 = half
}

export interface DayResult {
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'OFF' | 'INCOMPLETE';
  rosteredMinutes: number;
  workedMinutes: number;
  mealMinutes: number;
  paidMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  plannedOtMinutes: number; // within the roster's planned OT, actually worked
  unrosteredOtMinutes: number; // beyond the roster (or beyond a normal day)
  holidayMinutes: number; // paid minutes worked on a premium date
  multiplier: number;
  flags: string[];
}

export function roundOt(minutes: number, rules: Pick<AttendanceRules, 'otMinMinutes' | 'otRoundMinutes'>): number {
  if (minutes < rules.otMinMinutes) return 0;
  const r = Math.max(1, rules.otRoundMinutes);
  return Math.floor(minutes / r) * r;
}

export function weekdayOf(date: string): number {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

export function computeDay(input: DayInput, rules: AttendanceRules): DayResult {
  const blocks = mergeTouching(input.sessions);
  const worked = blockMinutes(blocks);
  const meal = worked > 0 ? mealDeduction(blocks, rules) : 0;
  const paid = Math.max(0, worked - meal);
  const flags: string[] = [];
  if (input.hadOpenSession) flags.push('MISSING_MARK_OUT');

  const multiplier = input.holiday?.multiplier ?? 1;
  const holidayMinutes = input.holiday && multiplier > 1 ? paid : 0;

  let rostered = 0;
  let late = 0;
  let early = 0;
  let plannedOt = 0;
  let unrosteredOt = 0;

  const r = input.roster;
  if (r && !r.isOff && r.blocks.length > 0) {
    rostered = r.paidMinutes;
    const first = Math.min(...r.blocks.map((b) => b.start));
    const last = Math.max(...r.blocks.map((b) => b.end));
    if (blocks.length > 0) {
      const lateBy = blocks[0].start - first;
      if (lateBy > rules.graceMinutes) late = lateBy;
      const earlyBy = last - blocks[blocks.length - 1].end;
      if (earlyBy > 0 && !input.hadOpenSession) early = earlyBy;
    }
    const normalPart = r.paidMinutes - r.plannedOtMinutes;
    plannedOt = Math.min(r.plannedOtMinutes, Math.max(0, paid - normalPart));
    unrosteredOt = roundOt(Math.max(0, paid - r.paidMinutes), rules);
  } else if (r && r.isOff) {
    // rest day: every paid minute worked is unrostered overtime
    unrosteredOt = roundOt(paid, rules);
  } else if (!input.usesRoster) {
    const normal = input.holiday?.isPaidOff ? 0 : rules.workWeek[weekdayOf(input.date)] ?? 0;
    rostered = normal;
    if (normal === 0) {
      // weekly rest day or paid holiday without a roster
      unrosteredOt = input.holiday && multiplier > 1 ? roundOt(Math.max(0, paid - rules.normalDayMinutes), rules) : roundOt(paid, rules);
    } else {
      unrosteredOt = roundOt(Math.max(0, paid - normal), rules);
    }
  } else {
    // in a roster group but nothing rostered for this date
    if (paid > 0) flags.push('NOT_ROSTERED');
    unrosteredOt = roundOt(paid, rules);
  }

  // A forgotten mark-out was closed by the system: the end time is a guess, so no
  // unrostered overtime is created from it. HR corrects the time if needed.
  if (input.hadOpenSession) unrosteredOt = 0;

  // If the day is a premium holiday, the premium pays for those hours; overtime is
  // only the part beyond a normal day. The two are never the same minutes twice.
  if (holidayMinutes > 0 && !input.hadOpenSession && !(r && !r.isOff && r.blocks.length > 0)) {
    unrosteredOt = roundOt(Math.max(0, paid - rules.normalDayMinutes), rules);
  }

  let status: DayResult['status'];
  if (worked > 0) {
    status = input.hadOpenSession ? 'INCOMPLETE' : input.leave && input.leave.days < 1 ? 'HALF_LEAVE' : 'PRESENT';
  } else if (input.leave) {
    status = input.leave.days >= 1 ? 'LEAVE' : 'HALF_LEAVE';
  } else if (input.holiday && input.holiday.isPaidOff && !(r && !r.isOff && r.blocks.length > 0)) {
    status = 'HOLIDAY';
  } else if (r ? r.isOff || r.blocks.length === 0 : input.usesRoster ? true : (rules.workWeek[weekdayOf(input.date)] ?? 0) === 0) {
    status = 'OFF';
  } else {
    status = 'ABSENT';
  }
  if (input.leave && input.leave.days < 1 && status === 'ABSENT') status = 'HALF_LEAVE';

  return {
    status,
    rosteredMinutes: rostered,
    workedMinutes: worked,
    mealMinutes: meal,
    paidMinutes: paid,
    lateMinutes: late,
    earlyMinutes: early,
    plannedOtMinutes: plannedOt,
    unrosteredOtMinutes: unrosteredOt,
    holidayMinutes,
    multiplier,
    flags,
  };
}

/** For the app's home screen: today so far, including an open session up to `now`. */
export function todaySoFar(
  date: string,
  sessions: { startAt: Date; endAt: Date | null }[],
  now: Date,
  rules: Pick<AttendanceRules, 'mealStart' | 'mealEnd' | 'mealMinutes'>,
): { workedMinutes: number; paidMinutes: number; mealMinutes: number; open: boolean } {
  const dayEnd = colomboMidnightAfter(date);
  const blocks: Block[] = [];
  let open = false;
  for (const s of sessions) {
    const end = s.endAt ?? (now < dayEnd ? now : dayEnd);
    if (!s.endAt) open = true;
    const startOnDay = colomboDate(s.startAt) === date ? s.startAt : colomboInstant(date, 0);
    blocks.push(toBlock(date, startOnDay, end));
  }
  const merged = mergeTouching(blocks);
  const worked = blockMinutes(merged);
  const meal = mealDeduction(merged, rules);
  return { workedMinutes: worked, mealMinutes: meal, paidMinutes: Math.max(0, worked - meal), open };
}

export { colomboMinute, addDays };
