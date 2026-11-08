import { describe, expect, it } from 'vitest';
import { checkLocation, computeDay, mealDeduction, planPunch, splitAtMidnight, todaySoFar, type AttendanceRules } from '../../src/rules/attendance.js';
import { colomboInstant } from '../../src/lib/time.js';

const rules: AttendanceRules = {
  normalDayMinutes: 480,
  mealMinutes: 60,
  mealStart: 720,
  mealEnd: 780,
  graceMinutes: 15,
  otMinMinutes: 30,
  otRoundMinutes: 15,
  workWeek: [0, 480, 480, 480, 480, 480, 0, 0],
};
const at = (date: string, h: number, m = 0) => colomboInstant(date, h * 60 + m);

describe('planPunch', () => {
  const now = at('2026-10-05', 9);
  it('opens a session when nothing is open', () => {
    expect(planPunch(null, { kind: 'IN', occurredAt: now, mode: 'OFFICE' }, now)).toEqual({ action: 'OPEN' });
  });
  it('refuses a second mark-in', () => {
    const r = planPunch({ id: 's1', startAt: at('2026-10-05', 8), mode: 'OFFICE' }, { kind: 'IN', occurredAt: now, mode: 'OFFICE' }, now);
    expect(r.action).toBe('REJECT');
  });
  it('closes the open session', () => {
    const r = planPunch({ id: 's1', startAt: at('2026-10-05', 8), mode: 'OFFICE' }, { kind: 'OUT', occurredAt: now, mode: 'OFFICE' }, now);
    expect(r).toEqual({ action: 'CLOSE', sessionId: 's1' });
  });
  it('refuses mark-out without mark-in', () => {
    expect(planPunch(null, { kind: 'OUT', occurredAt: now, mode: 'OFFICE' }, now).action).toBe('REJECT');
  });
  it('refuses a phone clock far ahead', () => {
    expect(planPunch(null, { kind: 'IN', occurredAt: new Date(now.getTime() + 10 * 60_000), mode: 'OFFICE' }, now).action).toBe('REJECT');
  });
  it('refuses mark-out before mark-in', () => {
    const r = planPunch({ id: 's1', startAt: at('2026-10-05', 10), mode: 'OFFICE' }, { kind: 'OUT', occurredAt: at('2026-10-05', 9), mode: 'OFFICE' }, now);
    expect(r.action).toBe('REJECT');
  });
});

describe('splitAtMidnight', () => {
  it('keeps a same-day session whole', () => {
    const p = splitAtMidnight(at('2026-10-05', 8, 30), at('2026-10-05', 17, 30));
    expect(p).toHaveLength(1);
    expect(p[0].date).toBe('2026-10-05');
    expect(p[0].minutes).toBe(540);
  });
  it('splits a night session at Colombo midnight', () => {
    const p = splitAtMidnight(at('2026-10-05', 22), at('2026-10-06', 6));
    expect(p.map((x) => [x.date, x.minutes])).toEqual([
      ['2026-10-05', 120],
      ['2026-10-06', 360],
    ]);
  });
  it('uses Colombo, not UTC, for the date of a 02:00 punch', () => {
    const p = splitAtMidnight(at('2026-10-06', 2), at('2026-10-06', 4));
    expect(p[0].date).toBe('2026-10-06');
  });
});

describe('mealDeduction', () => {
  it('deducts when one session covers 12:00–13:00', () => {
    expect(mealDeduction([{ start: 510, end: 1050 }], rules)).toBe(60);
  });
  it('does not deduct when the person marked out over lunch', () => {
    expect(mealDeduction([{ start: 510, end: 730 }, { start: 770, end: 1050 }], rules)).toBe(0);
  });
  it('does not deduct a morning-only session', () => {
    expect(mealDeduction([{ start: 480, end: 720 }], rules)).toBe(0);
  });
});

describe('computeDay', () => {
  const base = { hadOpenSession: false, holiday: null, leave: null, usesRoster: true };
  const roster9h = { isOff: false, blocks: [{ start: 510, end: 1050 }], paidMinutes: 480, plannedOtMinutes: 0 };
  const roster10h = { isOff: false, blocks: [{ start: 480, end: 1080 }], paidMinutes: 540, plannedOtMinutes: 60 };

  it('a normal 9-hour day is 8 paid hours and no overtime', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1050 }], roster: roster9h }, rules);
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 540, mealMinutes: 60, paidMinutes: 480, plannedOtMinutes: 0, unrosteredOtMinutes: 0, lateMinutes: 0 });
  });

  it('a 10-hour rostered day gives 1 hour planned overtime', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 480, end: 1080 }], roster: roster10h }, rules);
    expect(r.paidMinutes).toBe(540);
    expect(r.plannedOtMinutes).toBe(60);
    expect(r.unrosteredOtMinutes).toBe(0);
  });

  it('staying past the roster is unrostered overtime', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1170 }], roster: roster9h }, rules);
    expect(r.paidMinutes).toBe(600);
    expect(r.unrosteredOtMinutes).toBe(120);
  });

  it('4 h office + 2 h remote + 3 h remote = 9 h worked, no meal deduction', () => {
    const r = computeDay(
      { ...base, date: '2026-10-05', sessions: [{ start: 480, end: 720 }, { start: 840, end: 960 }, { start: 1140, end: 1320 }], roster: roster9h },
      rules,
    );
    expect(r.workedMinutes).toBe(540);
    expect(r.mealMinutes).toBe(0);
    expect(r.paidMinutes).toBe(540);
    expect(r.unrosteredOtMinutes).toBe(60);
  });

  it('marks late after the grace period', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 540, end: 1050 }], roster: roster9h }, rules);
    expect(r.lateMinutes).toBe(30);
  });

  it('within grace is not late', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 520, end: 1050 }], roster: roster9h }, rules);
    expect(r.lateMinutes).toBe(0);
  });

  it('ignores overtime under the minimum and rounds down', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1070 }], roster: roster9h }, rules);
    expect(r.unrosteredOtMinutes).toBe(0); // 20 min < 30 min
    const r2 = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1094 }], roster: roster9h }, rules);
    expect(r2.unrosteredOtMinutes).toBe(30); // 44 → 30
  });

  it('absent when rostered and no work', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [], roster: roster9h }, rules);
    expect(r.status).toBe('ABSENT');
  });

  it('work on a rest day is all overtime', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 540, end: 780 }], roster: { isOff: true, blocks: [], paidMinutes: 0, plannedOtMinutes: 0 } }, rules);
    // 09:00–13:00 covers the whole meal hour, so 4 h worked = 3 h paid
    expect(r.unrosteredOtMinutes).toBe(180);
  });

  it('holiday premium minutes are not overtime', () => {
    const r = computeDay(
      { ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1050 }], roster: roster9h, holiday: { multiplier: 2, isPaidOff: true } },
      rules,
    );
    expect(r.holidayMinutes).toBe(480);
    expect(r.unrosteredOtMinutes).toBe(0);
    expect(r.multiplier).toBe(2);
  });

  it('a person not on a roster: weekday normal day, Saturday is off', () => {
    const mon = computeDay({ ...base, usesRoster: false, date: '2026-10-05', sessions: [{ start: 510, end: 1050 }], roster: null }, rules);
    expect(mon).toMatchObject({ status: 'PRESENT', rosteredMinutes: 480, unrosteredOtMinutes: 0 });
    const sat = computeDay({ ...base, usesRoster: false, date: '2026-10-10', sessions: [], roster: null }, rules);
    expect(sat.status).toBe('OFF');
    const tue = computeDay({ ...base, usesRoster: false, date: '2026-10-06', sessions: [], roster: null }, rules);
    expect(tue.status).toBe('ABSENT');
  });

  it('approved leave', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [], roster: roster9h, leave: { days: 1 } }, rules);
    expect(r.status).toBe('LEAVE');
  });

  it('a missing mark-out makes the day incomplete', () => {
    const r = computeDay({ ...base, date: '2026-10-05', sessions: [{ start: 510, end: 1440 }], roster: roster9h, hadOpenSession: true }, rules);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.flags).toContain('MISSING_MARK_OUT');
    expect(r.unrosteredOtMinutes).toBe(0);
  });
});

describe('checkLocation', () => {
  const policy = { requireLocation: true, allowRemote: true, officeMustBeInFence: true, remoteFlagMeters: 2000, maxAccuracyM: 150 };
  const fences = [{ id: 'b1', name: 'Head office', lat: 6.9271, lng: 79.8612, radiusM: 150 }];
  it('accepts an office punch inside the fence', () => {
    const r = checkLocation({ mode: 'OFFICE', lat: 6.9272, lng: 79.8613, accuracyM: 10 }, policy, fences, null);
    expect(r).toMatchObject({ ok: true, branchId: 'b1' });
  });
  it('refuses an office punch outside every fence', () => {
    const r = checkLocation({ mode: 'OFFICE', lat: 6.95, lng: 79.9, accuracyM: 10 }, policy, fences, null);
    expect(r.ok).toBe(false);
  });
  it('remote work always needs GPS, even when the company setting is off', () => {
    const r = checkLocation({ mode: 'REMOTE' }, { ...policy, requireLocation: false }, fences, null);
    expect(r.ok).toBe(false);
  });
  it('flags a remote punch more than 2 km from home but accepts it', () => {
    const r = checkLocation({ mode: 'REMOTE', lat: 7.0, lng: 79.9, accuracyM: 20 }, policy, fences, { lat: 6.9, lng: 79.86 });
    expect(r.ok).toBe(true);
    expect(r.flags).toContain('FAR_FROM_HOME');
  });
  it('refuses remote work when not allowed', () => {
    expect(checkLocation({ mode: 'REMOTE', lat: 7, lng: 80 }, { ...policy, allowRemote: false }, fences, null).ok).toBe(false);
  });
  it('office punch without GPS is allowed when location is switched off', () => {
    expect(checkLocation({ mode: 'OFFICE' }, { ...policy, requireLocation: false }, fences, null).ok).toBe(true);
  });
});

describe('todaySoFar', () => {
  it('counts an open session up to now', () => {
    const r = todaySoFar('2026-10-05', [{ startAt: at('2026-10-05', 8, 30), endAt: null }], at('2026-10-05', 10, 30), rules);
    expect(r).toMatchObject({ workedMinutes: 120, open: true, mealMinutes: 0 });
  });
});
