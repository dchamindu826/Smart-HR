'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, dur, fullName, time } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, PageHeader, Person, Tabs, useUi } from '@/components/ui';

type Emp = { id: string; empNo: string; firstName: string; lastName: string; designation: string | null };
interface Inbox {
  counts: { leave: number; overtime: number; corrections: number; assets: number; roster: number; total: number };
  leave: { id: string; employee: Emp; leaveType: { name: string; color: string }; fromDate: string; toDate: string; days: number; halfDay: string | null; reason: string | null; createdAt: string }[];
  overtime: { id: string; employee: Emp; date: string; minutes: number; reason: string | null; createdAt: string }[];
  corrections: { id: string; employee: Emp; date: string; startAt: string; endAt: string; mode: string; reason: string }[];
  assets: { id: string; employee: Emp; category: string; item: string; reason: string; neededBy: string | null }[];
  roster: { id: string; weekStart: string; revision: number; group: { id: string; name: string; maker: { name: string } }; submittedAt: string | null }[];
}
type TabKey = 'leave' | 'overtime' | 'corrections' | 'roster' | 'assets';

export default function ApprovalsPage() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<TabKey>((sp.get('tab') as TabKey) || 'leave');
  const { data, error, loading, reload } = useApi<Inbox>('/approvals');
  const act = useAction();
  const { toast, confirm } = useUi();

  const decide = async (path: string, approve: boolean, what: string, extra: Record<string, unknown> = {}) => {
    let note: string | undefined;
    if (!approve) {
      const r = await confirm({ title: `Reject ${what}?`, input: { label: 'Reason (the employee will see this)', minLength: 3 }, ok: 'Reject', danger: true });
      if (r === false) return;
      note = r;
    }
    const ok = await act.run(() => api.post(path, { approve, note, ...extra }));
    if (ok !== undefined) {
      toast(approve ? `${what[0].toUpperCase() + what.slice(1)} approved.` : `${what[0].toUpperCase() + what.slice(1)} rejected.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader title="Approvals" sub="Everything waiting for your decision. Your own requests go to your manager or HR, never to you." />
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <>
            <Tabs<TabKey>
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'leave', label: 'Leave', count: d.counts.leave },
                { value: 'overtime', label: 'Overtime', count: d.counts.overtime },
                { value: 'corrections', label: 'Attendance corrections', count: d.counts.corrections },
                { value: 'roster', label: 'Roster weeks', count: d.counts.roster },
                { value: 'assets', label: 'Equipment', count: d.counts.assets },
              ]}
            />
            {tab === 'leave' && (
              <Card pad={false}>
                {d.leave.length === 0 ? (
                  <Empty title="No leave requests waiting" icon="leaf" />
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Leave</th>
                          <th>Dates</th>
                          <th className="num">Days</th>
                          <th>Reason</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.leave.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <Person name={fullName(l.employee)} sub={`${l.employee.empNo} · ${l.employee.designation ?? ''}`} href={`/employees/${l.employee.id}`} photoEmployeeId={l.employee.id} />
                            </td>
                            <td>
                              <span className="chip" style={{ background: l.leaveType.color + '22', color: l.leaveType.color }}>
                                {l.leaveType.name}
                              </span>
                            </td>
                            <td className="nowrap">
                              {date(l.fromDate, { weekday: true })}
                              {l.toDate !== l.fromDate && <> → {date(l.toDate, { weekday: true })}</>}
                              {l.halfDay && <Chip tone="info">{l.halfDay}</Chip>}
                            </td>
                            <td className="num">{l.days}</td>
                            <td className="muted" style={{ maxWidth: 280 }}>
                              {l.reason || '—'}
                            </td>
                            <td className="nowrap right">
                              <Button size="sm" variant="ok" busy={act.busy} onClick={() => decide(`/leave/requests/${l.id}/decide`, true, 'leave')}>
                                Approve
                              </Button>{' '}
                              <Button size="sm" variant="danger" onClick={() => decide(`/leave/requests/${l.id}/decide`, false, 'leave')}>
                                Reject
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'overtime' && (
              <Card pad={false} sub="Unrostered overtime with the employee's reason. Approval is refused above the 12-hour weekly limit.">
                {d.overtime.length === 0 ? (
                  <Empty title="No overtime waiting" icon="plus-clock" />
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Date</th>
                          <th className="num">Overtime</th>
                          <th>Reason</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.overtime.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <Person name={fullName(o.employee)} sub={o.employee.empNo} href={`/employees/${o.employee.id}`} photoEmployeeId={o.employee.id} />
                            </td>
                            <td className="nowrap">{date(o.date, { weekday: true })}</td>
                            <td className="num">{dur(o.minutes)}</td>
                            <td style={{ maxWidth: 320 }}>{o.reason}</td>
                            <td className="nowrap right">
                              <Button size="sm" variant="ok" busy={act.busy} onClick={() => decide(`/overtime/${o.id}/decide`, true, 'overtime')}>
                                Approve
                              </Button>{' '}
                              <Button size="sm" variant="danger" onClick={() => decide(`/overtime/${o.id}/decide`, false, 'overtime')}>
                                Reject
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'corrections' && (
              <Card pad={false}>
                {d.corrections.length === 0 ? (
                  <Empty title="No corrections waiting" icon="clock" />
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Date</th>
                          <th>Asked for</th>
                          <th>Reason</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.corrections.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <Person name={fullName(c.employee)} sub={c.employee.empNo} href={`/employees/${c.employee.id}`} photoEmployeeId={c.employee.id} />
                            </td>
                            <td className="nowrap">{date(c.date, { weekday: true })}</td>
                            <td className="nowrap">
                              {time(c.startAt)} – {time(c.endAt)} <Chip tone={c.mode === 'REMOTE' ? 'mag' : 'info'}>{c.mode === 'REMOTE' ? 'Remote' : 'Office'}</Chip>
                            </td>
                            <td style={{ maxWidth: 320 }}>{c.reason}</td>
                            <td className="nowrap right">
                              <Button size="sm" variant="ok" busy={act.busy} onClick={() => decide(`/attendance/corrections/${c.id}/decide`, true, 'correction')}>
                                Approve
                              </Button>{' '}
                              <Button size="sm" variant="danger" onClick={() => decide(`/attendance/corrections/${c.id}/decide`, false, 'correction')}>
                                Reject
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'roster' && (
              <Card pad={false}>
                {d.roster.length === 0 ? (
                  <Empty title="No roster weeks waiting" icon="grid" />
                ) : (
                  d.roster.map((w) => (
                    <div className="list-row" key={w.id}>
                      <div className="bd">
                        <b>
                          {w.group.name} — week of {date(w.weekStart)}
                          {w.revision > 1 && <> (revision {w.revision})</>}
                        </b>
                        <span>Made by {w.group.maker.name}</span>
                      </div>
                      <Link className="btn sm pri" href={`/roster?group=${w.group.id}&week=${w.weekStart}`}>
                        Review roster
                      </Link>
                    </div>
                  ))
                )}
              </Card>
            )}

            {tab === 'assets' && (
              <Card pad={false}>
                {d.assets.length === 0 ? (
                  <Empty title="No equipment requests" icon="box" />
                ) : (
                  d.assets.map((a) => (
                    <div className="list-row" key={a.id}>
                      <Person name={fullName(a.employee)} sub={a.employee.empNo} photoEmployeeId={a.employee.id} />
                      <div className="bd">
                        <b>{a.item}</b>
                        <span>
                          {a.reason}
                          {a.neededBy && <> · needed by {date(a.neededBy)}</>}
                        </span>
                      </div>
                      <Link className="btn sm" href="/assets?tab=requests">
                        Assign from stock
                      </Link>
                      <Button size="sm" variant="danger" onClick={() => decide(`/assets/requests/${a.id}/decide`, false, 'request')}>
                        Reject
                      </Button>
                    </div>
                  ))
                )}
              </Card>
            )}
          </>
        )}
      </Async>
    </>
  );
}
