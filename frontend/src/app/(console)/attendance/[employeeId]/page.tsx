'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date as fmtDate, dur, periodLabel, shiftPeriod, thisPeriod, time, today } from '@/lib/format';
import { Async, Button, Card, Chip, PageHeader, Stat, StatusChip } from '@/components/ui';
import { AddSessionModal, FlagChips, HolidayChip, LeaveChip, ModeChip, segText, type HolidayInfo, type Mode, type Segment, type Source } from '../parts';

interface MonthRow {
  date: string;
  status: string | null;
  sessions: { id: string; startAt: string; endAt: string | null; mode: Mode; source: Source; minutes: number; flags: string[] }[];
  workedMinutes: number;
  paidMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  otMinutes: number;
  flags: string[];
  roster: { isOff: boolean; segments: Segment[]; paidMinutes: number; plannedOtMinutes: number; totalMinutes: number; shiftPatternId: string | null } | null;
  holiday: HolidayInfo | null;
  leave: { type: string; color: string; halfDay: string | null } | null;
  overtime: { id: string; kind: 'PLANNED' | 'UNROSTERED'; minutes: number; status: string }[];
}

interface Month {
  employee: { id: string; empNo: string; firstName: string; lastName: string; branchId: string | null; designation: string | null };
  period: string;
  rows: MonthRow[];
  totals: { present: number; absent: number; leave: number; lateDays: number; workedMinutes: number; paidMinutes: number; lateMinutes: number; otMinutes: number };
}

const OT_TONE: Record<string, 'ok' | 'warn' | 'bad' | ''> = { APPROVED: 'ok', PENDING: 'warn', NEEDS_REASON: 'warn', REJECTED: 'bad' };

export default function EmployeeMonthPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const initial = sp.get('period');
  const [period, setPeriod] = useState(initial && /^\d{4}-\d{2}$/.test(initial) ? initial : thisPeriod());
  const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useApi<Month>('/attendance/month', { employeeId, period });
  const now = today();

  useEffect(() => {
    router.replace(`/attendance/${employeeId}?period=${period}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const name = data ? `${data.employee.firstName} ${data.employee.lastName}` : 'Attendance';

  return (
    <>
      <PageHeader
        crumbs={[{ href: '/attendance', label: 'Attendance' }]}
        title={name}
        sub={data ? [data.employee.empNo, data.employee.designation, periodLabel(period)].filter(Boolean).join(' · ') : periodLabel(period)}
        actions={
          <>
            <div className="row tight">
              <Button size="sm" icon="chev-l" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))} />
              <b style={{ minWidth: 120, textAlign: 'center' }}>{periodLabel(period)}</b>
              <Button size="sm" icon="chev-r" aria-label="Next month" disabled={period >= thisPeriod()} onClick={() => setPeriod(shiftPeriod(period, 1))} />
              {period !== thisPeriod() && (
                <Button size="sm" onClick={() => setPeriod(thisPeriod())}>
                  This month
                </Button>
              )}
            </div>
            {can('attendance.correct') && data && (
              <Button variant="pri" icon="plus-clock" onClick={() => setAdding(true)}>
                Add session
              </Button>
            )}
          </>
        }
      />
      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <>
            <div className="stats">
              <Stat label="Present days" value={d.totals.present} tone="ok" />
              <Stat label="Absent days" value={d.totals.absent} tone={d.totals.absent ? 'bad' : undefined} />
              <Stat label="Leave days" value={d.totals.leave} tone="mag" />
              <Stat label="Late days" value={d.totals.lateDays} sub={d.totals.lateMinutes ? `${dur(d.totals.lateMinutes)} in all` : undefined} tone={d.totals.lateDays ? 'warn' : undefined} />
              <Stat label="Worked" value={`${Math.round(d.totals.workedMinutes / 6) / 10} h`} sub={dur(d.totals.workedMinutes)} />
              <Stat label="Paid" value={`${Math.round(d.totals.paidMinutes / 6) / 10} h`} sub="After the meal hour" />
              <Stat label="Overtime" value={dur(d.totals.otMinutes)} tone={d.totals.otMinutes ? 'warn' : undefined} />
            </div>
            <Card pad={false} title="Day by day" sub="Totals appear after day close (just after midnight). Today shows sessions so far.">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Roster</th>
                      <th>Sessions</th>
                      <th className="num">Worked</th>
                      <th className="num">Paid</th>
                      <th className="num">Late</th>
                      <th className="num">OT</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => {
                      const future = r.date > now;
                      const weekend = [0, 6].includes(new Date(r.date + 'T00:00:00Z').getUTCDay());
                      return (
                        <tr key={r.date} style={future ? { opacity: 0.55 } : r.date === now ? { boxShadow: 'inset 3px 0 0 var(--blue)' } : undefined}>
                          <td className="nowrap">
                            <b className={weekend ? 'muted' : ''}>{fmtDate(r.date, { weekday: true, year: false })}</b>
                          </td>
                          <td className="nowrap small">
                            {r.roster ? (
                              r.roster.isOff || !r.roster.segments.length ? (
                                <span className="muted">Off</span>
                              ) : (
                                <>
                                  {r.roster.segments.map((s, i) => (
                                    <div key={i}>
                                      {segText(s)}
                                      {s.mode === 'REMOTE' && <span className="chip mag" style={{ marginLeft: 4, padding: '0 5px' }}>R</span>}
                                    </div>
                                  ))}
                                  {r.roster.plannedOtMinutes > 0 && <div className="tiny warn-t">+{dur(r.roster.plannedOtMinutes)} planned OT</div>}
                                </>
                              )
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                          <td className="small">
                            {r.sessions.length === 0 ? (
                              <span className="faint">—</span>
                            ) : (
                              r.sessions.map((s) => (
                                <div key={s.id} className="row tight nowrap" style={{ gap: 5 }}>
                                  <span>
                                    {time(s.startAt)} – {s.endAt ? time(s.endAt) : <span className="ok-t">in</span>}
                                  </span>
                                  <ModeChip mode={s.mode} />
                                  {s.source === 'MANUAL' && <Chip tone="info">Manual</Chip>}
                                </div>
                              ))
                            )}
                          </td>
                          <td className="num">{r.workedMinutes ? dur(r.workedMinutes) : '—'}</td>
                          <td className="num">{r.paidMinutes ? dur(r.paidMinutes) : '—'}</td>
                          <td className="num">
                            {r.lateMinutes ? <span className="warn-t">{dur(r.lateMinutes)}</span> : '—'}
                            {r.earlyMinutes > 0 && <div className="tiny muted">left {dur(r.earlyMinutes)} early</div>}
                          </td>
                          <td className="num">{r.otMinutes ? <span className="warn-t">{dur(r.otMinutes)}</span> : '—'}</td>
                          <td>{r.status ? <StatusChip status={r.status} /> : <span className="faint">{future ? '' : r.date === now ? 'Today' : 'Not closed'}</span>}</td>
                          <td>
                            <div className="row tight" style={{ gap: 4 }}>
                              {r.holiday && <HolidayChip h={r.holiday} />}
                              {r.leave && <LeaveChip leave={r.leave} />}
                              {r.overtime.map((o) => (
                                <Chip key={o.id} tone={OT_TONE[o.status] ?? ''} title={`${o.kind === 'PLANNED' ? 'Planned' : 'Unrostered'} overtime: ${o.status.toLowerCase().replace('_', ' ')}`}>
                                  {o.kind === 'PLANNED' ? 'Planned' : 'Unrostered'} OT {dur(o.minutes)} · {o.status === 'NEEDS_REASON' ? 'needs reason' : o.status.toLowerCase()}
                                </Chip>
                              ))}
                              {r.flags.length > 0 && <FlagChips flags={r.flags} />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </Async>
      {adding && data && (
        <AddSessionModal
          employeeId={data.employee.id}
          employeeName={`${data.employee.firstName} ${data.employee.lastName} (${data.employee.empNo})`}
          defaultDate={period === thisPeriod() ? now : `${period}-01`}
          onClose={() => setAdding(false)}
          onSaved={reload}
        />
      )}
    </>
  );
}
