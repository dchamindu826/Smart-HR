'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, qs } from '@/lib/api';
import { useAction, useApi, useDebounced, usePoll } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { addDays, date as fmtDate, dur, time, today } from '@/lib/format';
import { BranchSelect, DepartmentSelect } from '@/components/pickers';
import { Alert, Async, Button, Card, Empty, ErrorBox, Input, PageHeader, Person, Seg, Stat, StatusChip, useUi } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AddSessionModal, FlagChips, HolidayChip, LeaveChip, ModeChip, SOURCE_LABEL, segText, type HolidayInfo, type Mode, type Segment, type Source } from './parts';

interface BoardSession {
  id: string;
  startAt: string;
  endAt: string | null;
  mode: Mode;
  source: Source;
  flags: string[];
  minutes: number;
  inLat: number | null;
  inLng: number | null;
  distanceHomeM: number | null;
}

interface BoardRow {
  employee: { id: string; empNo: string; name: string; designation: string | null; branch: string | null; department: string | null };
  status: string;
  firstIn: string | null;
  lastOut: string | null;
  sessions: BoardSession[];
  workedMinutes: number;
  paidMinutes: number;
  lateMinutes: number;
  otMinutes: number;
  roster: { isOff: boolean; segments: Segment[]; paidMinutes: number } | null;
  leave: { type: string; color: string; halfDay: string | null } | null;
  flags: string[];
  closed: boolean;
}

interface Board {
  date: string;
  holiday: HolidayInfo | null;
  summary: { total: number; in: number; present: number; remoteNow: number; late: number; leave: number; notIn: number; off: number; flagged: number };
  rows: BoardRow[];
}

type StatusKey = 'all' | 'in' | 'present' | 'notin' | 'late' | 'leave' | 'off' | 'flagged';

const FILTERS: { value: StatusKey; label: string; test: (r: BoardRow) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'in', label: 'In now', test: (r) => r.status === 'IN' },
  { value: 'present', label: 'Present', test: (r) => ['IN', 'PRESENT', 'INCOMPLETE'].includes(r.status) },
  { value: 'notin', label: 'Not in', test: (r) => ['NOT_IN', 'ABSENT'].includes(r.status) },
  { value: 'late', label: 'Late', test: (r) => r.lateMinutes > 0 },
  { value: 'leave', label: 'On leave', test: (r) => ['LEAVE', 'HALF_LEAVE'].includes(r.status) || !!r.leave },
  { value: 'off', label: 'Off', test: (r) => ['OFF', 'HOLIDAY'].includes(r.status) },
  { value: 'flagged', label: 'Flagged', test: (r) => r.flags.length > 0 },
];

function parseStatus(s: string | null): StatusKey {
  if (!s) return 'all';
  const k = s.toLowerCase().replace(/[^a-z]/g, '');
  const map: Record<string, StatusKey> = { in: 'in', innow: 'in', present: 'present', notin: 'notin', absent: 'notin', late: 'late', leave: 'leave', halfleave: 'leave', onleave: 'leave', off: 'off', holiday: 'off', flagged: 'flagged' };
  return map[k] ?? 'all';
}

export default function AttendancePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();

  const [day, setDay] = useState(sp.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? (sp.get('date') as string) : today());
  const [branchId, setBranchId] = useState(sp.get('branchId') ?? '');
  const [departmentId, setDepartmentId] = useState(sp.get('departmentId') ?? '');
  const [status, setStatus] = useState<StatusKey>(parseStatus(sp.get('status')));
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const { data, error, loading, reload } = useApi<Board>('/attendance/day', { date: day, branchId, departmentId, q: dq });
  const isToday = day === today();
  const isPast = day < today();
  const canCorrect = can('attendance.correct');

  usePoll(() => {
    if (day === today()) {
      setNowMs(Date.now());
      reload();
    }
  }, 60_000);

  useEffect(() => {
    router.replace(`/attendance${qs({ date: day === today() ? undefined : day, branchId, departmentId, status: status === 'all' ? undefined : status })}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, branchId, departmentId, status]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = FILTERS.find((x) => x.value === status) ?? FILTERS[0];
    return data.rows.filter(f.test);
  }, [data, status]);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = { all: 0, in: 0, present: 0, notin: 0, late: 0, leave: 0, off: 0, flagged: 0 };
    for (const r of data?.rows ?? []) for (const f of FILTERS) if (f.test(r)) c[f.value]++;
    return c;
  }, [data]);

  const removeSession = async (s: BoardSession, who: string) => {
    const reason = await confirm({
      title: 'Delete this session?',
      body: `${who}: ${time(s.startAt)} – ${s.endAt ? time(s.endAt) : 'still in'}. The day totals are recalculated. This is kept in the audit log.`,
      ok: 'Delete session',
      danger: true,
      input: { label: 'Reason', minLength: 5 },
    });
    if (reason === false) return;
    const r = await act.run(() => api.del(`/attendance/sessions/${s.id}`, { reason }));
    if (r !== undefined) {
      toast('Session deleted.');
      reload();
    }
  };

  const recalc = async () => {
    const ok = await confirm({
      title: `Recalculate ${fmtDate(day, { weekday: true })}?`,
      body: 'Day close runs again for everyone on this date, using the current roster, holidays, leave and sessions. Overtime claims are refreshed. Use this after fixing a roster or a holiday.',
      ok: 'Recalculate day',
    });
    if (ok === false) return;
    const r = await act.run(() => api.post<{ employees: number }>('/attendance/recalculate', { date: day }));
    if (r !== undefined) {
      toast(`Day recalculated for ${r.employees} employee${r.employees === 1 ? '' : 's'}.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        sub="Who is in, who is not, and how long they worked. A day runs 00:00–23:59 Colombo time; people can have several office and remote sessions in a day."
        actions={
          <>
            {isPast && canCorrect && (
              <Button icon="refresh" busy={act.busy} onClick={recalc}>
                Recalculate day
              </Button>
            )}
            {canCorrect && (
              <Button variant="pri" icon="plus-clock" onClick={() => setAdding(true)}>
                Add session
              </Button>
            )}
          </>
        }
      />

      <div className="row" style={{ marginBottom: 14 }}>
        <div className="row tight">
          <Button size="sm" icon="chev-l" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} />
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 160 }} />
          <Button size="sm" icon="chev-r" aria-label="Next day" onClick={() => setDay(addDays(day, 1))} />
          <Button size="sm" disabled={isToday} onClick={() => setDay(today())}>
            Today
          </Button>
        </div>
        <b style={{ fontSize: 15 }}>{fmtDate(day, { weekday: true })}</b>
        {isToday && <span className="muted small">Refreshes every minute</span>}
        {data?.holiday && <HolidayChip h={data.holiday} />}
      </div>

      <ErrorBox error={act.error} />

      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <>
            {d.holiday && (
              <div style={{ marginBottom: 14 }}>
                <Alert tone="info">
                  {d.holiday.name} — hours worked today are paid at {d.holiday.multiplier}×{d.holiday.isPaidOff ? '; a paid day off for people not rostered' : ''}. The holiday premium is not overtime.
                </Alert>
              </div>
            )}
            <div className="stats">
              <Stat label="Staff" value={d.summary.total} />
              <Stat label={isToday ? 'In now' : 'Present'} value={isToday ? d.summary.in : d.summary.present} sub={isToday ? `${d.summary.remoteNow} remote · ${d.summary.present} present today` : undefined} tone="ok" />
              <Stat label={isToday ? 'Not in' : 'Absent'} value={d.summary.notIn} tone={d.summary.notIn ? 'bad' : undefined} />
              <Stat label="Late" value={d.summary.late} tone={d.summary.late ? 'warn' : undefined} />
              <Stat label="On leave" value={d.summary.leave} tone="mag" />
              <Stat label="Off / holiday" value={d.summary.off} />
              <Stat label="Flagged" value={d.summary.flagged} tone={d.summary.flagged ? 'warn' : undefined} />
            </div>

            <Card pad={false}>
              <div className="filters">
                <Seg<StatusKey> value={status} onChange={setStatus} options={FILTERS.map((f) => ({ value: f.value, label: f.value === 'all' ? `All ${counts.all}` : `${f.label} ${counts[f.value]}` }))} />
                <Input className="search" placeholder="Search name or number…" value={q} onChange={(e) => setQ(e.target.value)} />
                <BranchSelect value={branchId} onChange={setBranchId} />
                <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
              </div>
              {rows.length === 0 ? (
                <Empty title="Nobody here" icon="clock">
                  {d.rows.length ? 'No one matches this filter.' : 'No active employees in this view on this date.'}
                </Empty>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Status</th>
                        <th>In / out</th>
                        <th style={{ minWidth: 240 }}>
                          <div className="row between tiny faint" style={{ fontWeight: 600 }}>
                            <span>00</span>
                            <span>06</span>
                            <span>12</span>
                            <span>18</span>
                            <span>24</span>
                          </div>
                        </th>
                        <th className="num">Worked</th>
                        <th className="num">Paid</th>
                        <th className="num">Late</th>
                        <th>Flags</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const isOpen = open === r.employee.id;
                        return (
                          <Fragment key={r.employee.id}>
                            <tr className="click" onClick={() => setOpen(isOpen ? null : r.employee.id)}>
                              <td onClick={(e) => e.stopPropagation()}>
                                <Person
                                  name={r.employee.name}
                                  sub={[r.employee.empNo, r.employee.designation, r.employee.branch].filter(Boolean).join(' · ')}
                                  href={`/attendance/${r.employee.id}?period=${day.slice(0, 7)}`}
                                  photoEmployeeId={r.employee.id}
                                />
                              </td>
                              <td className="nowrap">
                                <div className="row tight" style={{ gap: 4 }}>
                                  {r.status ? <StatusChip status={r.status} labelText={r.status === 'NOT_IN' ? 'Not in' : r.status === 'IN' ? 'In now' : undefined} /> : <span className="faint">—</span>}
                                  {r.leave && <LeaveChip leave={r.leave} />}
                                </div>
                              </td>
                              <td className="nowrap">
                                {r.firstIn ? (
                                  <>
                                    {time(r.firstIn)} – {r.lastOut ? time(r.lastOut) : <span className="ok-t">in</span>}
                                    {r.sessions.length > 1 && <div className="tiny muted">{r.sessions.length} sessions</div>}
                                  </>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                              <td>
                                <DayTimeline date={day} roster={r.roster} sessions={r.sessions} nowMs={isToday ? nowMs : null} />
                                <div className="tiny faint" style={{ marginTop: 2 }}>
                                  {r.roster ? (r.roster.isOff || !r.roster.segments.length ? 'Rostered off' : `Roster ${r.roster.segments.map(segText).join(', ')}`) : 'No roster'}
                                </div>
                              </td>
                              <td className="num">{r.workedMinutes ? dur(r.workedMinutes) : '—'}</td>
                              <td className="num">
                                {r.paidMinutes ? dur(r.paidMinutes) : '—'}
                                {r.otMinutes > 0 && <div className="tiny warn-t">OT {dur(r.otMinutes)}</div>}
                              </td>
                              <td className="num">{r.lateMinutes > 0 ? <span className="warn-t">{dur(r.lateMinutes)}</span> : '—'}</td>
                              <td>
                                <FlagChips flags={r.flags} />
                              </td>
                              <td className="right">
                                <span className="faint" style={{ display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : undefined }}>
                                  <Icon name="chev-d" size={16} />
                                </span>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={9} style={{ background: 'var(--card-2)', padding: '10px 16px 14px' }}>
                                  <SessionList row={r} canCorrect={canCorrect} busy={act.busy} onDelete={(s) => removeSession(s, r.employee.name)} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <p className="tiny faint" style={{ marginTop: 10 }}>
              Bars: dashed outline = rostered time, blue = office, magenta = remote, striped green = still marked in. The meal hour is deducted only when one unbroken session covers 12:00–13:00.
            </p>
          </>
        )}
      </Async>

      {adding && <AddSessionModal defaultDate={isToday || isPast ? day : today()} onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}

function DayTimeline({ date, roster, sessions, nowMs }: { date: string; roster: BoardRow['roster']; sessions: BoardSession[]; nowMs: number | null }) {
  const base = Date.parse(`${date}T00:00:00+05:30`);
  const clamp = (m: number) => Math.max(0, Math.min(1440, m));
  const pct = (m: number) => `${(clamp(m) / 1440) * 100}%`;
  const nowMin = nowMs !== null ? (nowMs - base) / 60_000 : 1440;
  const endOf = (s: BoardSession) => (s.endAt ? (Date.parse(s.endAt) - base) / 60_000 : nowMin);
  return (
    <div className="timeline">
      {[360, 720, 1080].map((m) => (
        <span key={m} style={{ position: 'absolute', left: pct(m), top: 0, bottom: 0, width: 1, background: 'var(--rule-2)' }} />
      ))}
      {roster && !roster.isOff && roster.segments.map((s, i) => <i key={`p${i}`} className="plan" title={`Roster ${segText(s)}`} style={{ left: pct(s.start), width: pct(s.end - s.start) }} />)}
      {sessions.map((s) => {
        const a = clamp((Date.parse(s.startAt) - base) / 60_000);
        const b = clamp(endOf(s));
        return (
          <i
            key={s.id}
            className={`${s.mode === 'REMOTE' ? 'remote' : ''} ${s.endAt ? '' : 'open'}`}
            title={`${s.mode === 'REMOTE' ? 'Remote' : 'Office'} ${time(s.startAt)} – ${s.endAt ? time(s.endAt) : 'now'}`}
            style={{ left: `${(a / 1440) * 100}%`, width: `${(Math.max(b - a, 4) / 1440) * 100}%` }}
          />
        );
      })}
      {nowMs !== null && nowMin >= 0 && nowMin <= 1440 && <span style={{ position: 'absolute', left: pct(nowMin), top: 0, bottom: 0, width: 2, background: 'var(--pink)' }} title="Now" />}
    </div>
  );
}

function SessionList({ row, canCorrect, busy, onDelete }: { row: BoardRow; canCorrect: boolean; busy: boolean; onDelete: (s: BoardSession) => void }) {
  if (!row.sessions.length) {
    return <div className="muted small">No sessions on this date.{row.leave ? ` On ${row.leave.type.toLowerCase()}.` : ''}</div>;
  }
  return (
    <table className="tbl" style={{ background: 'var(--card)', borderRadius: 8 }}>
      <thead>
        <tr>
          <th>Session</th>
          <th>Where</th>
          <th>Source</th>
          <th className="num">Length</th>
          <th>Location</th>
          <th className="num">From home</th>
          <th>Flags</th>
          {canCorrect && <th />}
        </tr>
      </thead>
      <tbody>
        {row.sessions.map((s) => (
          <tr key={s.id}>
            <td className="nowrap">
              {time(s.startAt)} – {s.endAt ? time(s.endAt) : <span className="ok-t">still in</span>}
            </td>
            <td>
              <ModeChip mode={s.mode} />
            </td>
            <td>{SOURCE_LABEL[s.source] ?? s.source}</td>
            <td className="num">{dur(s.minutes)}</td>
            <td>
              {s.inLat !== null && s.inLng !== null ? (
                <a href={`https://maps.google.com/?q=${s.inLat},${s.inLng}`} target="_blank" rel="noreferrer" className="row tight" style={{ display: 'inline-flex' }}>
                  <Icon name="pin" size={14} /> Map
                </a>
              ) : (
                <span className="faint">—</span>
              )}
            </td>
            <td className="num">{s.distanceHomeM !== null ? `${(s.distanceHomeM / 1000).toFixed(1)} km` : '—'}</td>
            <td>
              <FlagChips flags={s.flags} />
            </td>
            {canCorrect && (
              <td className="right">
                <Button size="xs" variant="danger" icon="trash" disabled={busy} onClick={() => onDelete(s)}>
                  Delete
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
