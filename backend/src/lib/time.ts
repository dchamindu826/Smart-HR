/**
 * Time helpers. Sri Lanka is UTC+05:30 all year (no daylight saving), so
 * conversion is a fixed offset and needs no time-zone library.
 *
 * Vocabulary
 *   instant   a Date in UTC (a punch, createdAt)
 *   date      a business date "YYYY-MM-DD" in Asia/Colombo
 *   dbDate    a Date at 00:00 UTC carrying that business date, for @db.Date columns
 *   minute    minutes after local midnight (0 … 1440)
 */

export const COLOMBO_OFFSET_MIN = 330;
const OFFSET_MS = COLOMBO_OFFSET_MIN * 60_000;
export const DAY_MIN = 1440;

/** Business date (YYYY-MM-DD) in Colombo for an instant. */
export function colomboDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes after Colombo midnight for an instant. */
export function colomboMinute(instant: Date): number {
  const d = new Date(instant.getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The instant of Colombo local time `minute` on business date `date`. */
export function colomboInstant(date: string, minute = 0): Date {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(base)) throw new Error(`Invalid date: ${date}`);
  return new Date(base - OFFSET_MS + minute * 60_000);
}

/** Start of the next Colombo day after `date`, as an instant. */
export function colomboMidnightAfter(date: string): Date {
  return colomboInstant(addDays(date, 1), 0);
}

/** A business date string → Date for a @db.Date column. */
export function dbDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

/** A @db.Date value → business date string. */
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00.000Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

/** 1 = Monday … 7 = Sunday */
export function isoWeekday(date: string): number {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "2026-10" → first and last date of the month. */
export function monthRange(period: string): { start: string; end: string; days: number } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period: ${period}`);
  const [y, m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${period}-${String(last).padStart(2, '0')}`, days: last };
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function prevPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Minutes between two instants, rounded down. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60_000));
}

/** 510 → "08:30"; 1500 → "25:00" is shown as "01:00". */
export function hhmm(minute: number): string {
  const m = ((minute % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "08:30" → 510 */
export function parseHhmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time: ${s}`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) throw new Error(`Invalid time: ${s}`);
  return h * 60 + mi;
}

/** 545 → "9 h 05 min"; 60 → "1 h"; 30 → "30 min" */
export function duration(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const v = Math.abs(minutes);
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${String(m).padStart(2, '0')} min`;
}

/** Age in whole years / completed months on a date. */
export function completedYears(from: string, on: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = on.split('-').map(Number);
  let y = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) y--;
  return Math.max(0, y);
}

export function completedMonths(from: string, on: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = on.split('-').map(Number);
  let m = (ty - fy) * 12 + (tm - fm);
  if (td < fd) m--;
  return Math.max(0, m);
}

export function todayColombo(now: Date = new Date()): string {
  return colomboDate(now);
}
