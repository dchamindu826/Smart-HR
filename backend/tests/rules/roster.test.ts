import { describe, expect, it } from 'vitest';
import { hasErrors, planDay, splitShift, validateWeek, type RosterRules, type WeekDayInput } from '../../src/rules/roster.js';

const rules: RosterRules = {
  normalDayMinutes: 480,
  mealMinutes: 60,
  mealStart: 720,
  mealEnd: 780,
  weeklyOtCapMinutes: 720,
  maxDayMinutes: 960,
  minRestMinutes: 480,
};
const MON = '2026-10-05';
const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

function week(blocks: (null | [number, number][])[], emp = 'e1'): WeekDayInput[] {
  return blocks.map((b, i) => ({
    employeeId: emp,
    employeeName: 'Kamal',
    date: dates[i],
    isOff: b === null,
    segments: (b ?? []).map(([start, end]) => ({ start, end, mode: 'OFFICE' as const })),
  }));
}
const day = (h: number): [number, number][] => [[480, 480 + h * 60]];

describe('planDay', () => {
  it('9 hours with lunch = 8 paid, no OT', () => {
    expect(planDay([{ start: 510, end: 1050 }], rules)).toEqual({ totalMinutes: 540, mealMinutes: 60, paidMinutes: 480, plannedOtMinutes: 0 });
  });
  it('10 hours with lunch = 9 paid, 1 h planned OT', () => {
    expect(planDay([{ start: 480, end: 1080 }], rules).plannedOtMinutes).toBe(60);
  });
  it('a split (breakdown) shift with no block over lunch has no meal deduction', () => {
    const p = planDay([{ start: 420, end: 660 }, { start: 960, end: 1260 }], rules);
    expect(p).toEqual({ totalMinutes: 540, mealMinutes: 0, paidMinutes: 540, plannedOtMinutes: 60 });
  });
  it('4 h office + 4 h remote = 8 paid', () => {
    expect(planDay([{ start: 480, end: 720 }, { start: 840, end: 1080 }], rules).paidMinutes).toBe(480);
  });
});

describe('splitShift', () => {
  it('keeps a day shift on one date', () => {
    expect(splitShift(MON, 510, 1050, 'OFFICE')).toHaveLength(1);
  });
  it('splits a night shift 22:00–06:00 into two dates', () => {
    const s = splitShift(MON, 1320, 360, 'OFFICE');
    expect(s).toEqual([
      { date: MON, segment: { start: 1320, end: 1440, mode: 'OFFICE' } },
      { date: '2026-10-06', segment: { start: 0, end: 360, mode: 'OFFICE' } },
    ]);
  });
  it('a shift ending at midnight stays on one date', () => {
    expect(splitShift(MON, 960, 0, 'OFFICE')).toHaveLength(1);
  });
});

describe('validateWeek', () => {
  it('a normal 5-day week passes', () => {
    const c = validateWeek(MON, week([day(9), day(9), day(9), day(9), day(9), null, null]), rules);
    expect(hasErrors(c)).toBe(false);
    expect(c.weeklyOt.e1).toBe(0);
  });

  it('refuses a week with no rest day', () => {
    const c = validateWeek(MON, week([day(9), day(9), day(9), day(9), day(9), day(9), day(9)]), rules);
    expect(c.issues.some((i) => i.code === 'NO_REST_DAY')).toBe(true);
  });

  it('6 days of 11 h = 12 h planned OT: allowed exactly at the limit', () => {
    const c = validateWeek(MON, week([day(11), day(11), day(11), day(11), day(11), day(11), null]), rules);
    expect(c.weeklyOt.e1).toBe(720);
    expect(c.issues.some((i) => i.code === 'OT_CAP')).toBe(false);
  });

  it('12 h 01 min is refused', () => {
    const blocks = week([day(11), day(11), day(11), day(11), day(11), day(11), null]);
    blocks[0].segments[0].end += 1;
    const c = validateWeek(MON, blocks, rules);
    expect(c.issues.some((i) => i.code === 'OT_CAP' && i.level === 'error')).toBe(true);
  });

  it('counts already-approved unrostered OT toward the limit', () => {
    const c = validateWeek(MON, week([day(10), day(10), day(10), day(10), day(10), null, null]), rules, { e1: 7 * 60 + 1 });
    expect(c.issues.some((i) => i.code === 'OT_CAP')).toBe(true);
  });

  it('refuses overlapping blocks', () => {
    const c = validateWeek(MON, week([[[480, 720], [700, 900]], null, null, null, null, null, null]), rules);
    expect(c.issues.some((i) => i.code === 'OVERLAP')).toBe(true);
  });

  it('refuses a block that ends before it starts', () => {
    const c = validateWeek(MON, week([[[900, 800]], null, null, null, null, null, null]), rules);
    expect(c.issues.some((i) => i.code === 'BAD_SEGMENT')).toBe(true);
  });

  it('refuses a day longer than 16 hours', () => {
    const c = validateWeek(MON, week([[[0, 1020]], null, null, null, null, null, null]), rules);
    expect(c.issues.some((i) => i.code === 'DAY_TOO_LONG')).toBe(true);
  });

  it('warns about short rest between days', () => {
    const c = validateWeek(MON, week([[[840, 1380]], [[240, 780]], null, null, null, null, null]), rules);
    expect(c.issues.some((i) => i.code === 'SHORT_REST' && i.level === 'warning')).toBe(true);
  });

  it('does not treat a night shift continuing past midnight as short rest', () => {
    const c = validateWeek(MON, week([[[1320, 1440]], [[0, 360]], null, null, null, null, null]), rules);
    expect(c.issues.some((i) => i.code === 'SHORT_REST')).toBe(false);
  });

  it('warns when rostered on a holiday', () => {
    const c = validateWeek(MON, week([day(9), null, null, null, null, null, null]), rules, {}, { [MON]: 'Vap Poya' });
    expect(c.issues.some((i) => i.code === 'HOLIDAY_WORK')).toBe(true);
    expect(hasErrors(c)).toBe(false);
  });

  it('a week must start on Monday', () => {
    const c = validateWeek('2026-10-06', [], rules);
    expect(c.issues[0].code).toBe('WEEK_START');
  });

  it('checks each employee separately', () => {
    const c = validateWeek(MON, [...week([day(9), day(9), day(9), day(9), day(9), null, null], 'a'), ...week([day(9), day(9), day(9), day(9), day(9), day(9), day(9)], 'b')], rules);
    expect(c.issues.filter((i) => i.level === 'error').map((i) => i.employeeId)).toEqual(['b']);
  });
});
