/** Display formatting. Sri Lanka time (UTC+05:30), rupees with two decimals. */

const TZ = 'Asia/Colombo';

/** "12345.5" → "12,345.50" */
export function money(v: string | number | null | undefined, withRs = false): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withRs ? `Rs ${s}` : s;
}

/** Compact rupees for stats: 1,250,000 → "Rs 1.25M" */
export function moneyShort(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (Math.abs(n) >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `Rs ${(n / 1_000).toFixed(1)}K`;
  return `Rs ${n.toFixed(0)}`;
}

/** "2026-10-05" → "Mon 5 Oct 2026" */
export function date(d: string | Date | null | undefined, opts: { weekday?: boolean; year?: boolean } = { year: true }): string {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00+05:30' : d) : d;
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', ...(opts.year !== false ? { year: 'numeric' } : {}), ...(opts.weekday ? { weekday: 'short' } : {}) });
}

/** instant → "08:32" in Colombo */
export function time(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return `${date(d)} ${time(d)}`;
}

/** minutes → "8 h 30 min" */
export function dur(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const sign = min < 0 ? '−' : '';
  const v = Math.abs(Math.round(min));
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

/** minute of day → "08:30" */
export function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "08:30" → 510 */
export function parseHhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Today in Colombo, YYYY-MM-DD */
export function today(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

export function mondayOf(d: string): string {
  const wd = new Date(d + 'T00:00:00Z').getUTCDay() || 7;
  return addDays(d, 1 - wd);
}

export function thisPeriod(): string {
  return today().slice(0, 7);
}

/** "2026-10" → "October 2026" */
export function periodLabel(p: string): string {
  return new Date(p + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftPeriod(p: string, n: number): string {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** An ISO instant for a Colombo date + "HH:MM" (for forms). */
export function colomboIso(date: string, hm: string): string {
  return new Date(`${date}T${hm}:00+05:30`).toISOString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function fullName(e: { firstName: string; lastName: string } | null | undefined): string {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

/** "PROBATION" → "Probation", "HALF_LEAVE" → "Half leave" */
export function label(s: string | null | undefined): string {
  if (!s) return '—';
  const t = s.toLowerCase().replace(/_/g, ' ');
  return t[0].toUpperCase() + t.slice(1);
}

export function ago(d: string | Date | null | undefined): string {
  if (!d) return 'never';
  const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(new Date(t));
}
