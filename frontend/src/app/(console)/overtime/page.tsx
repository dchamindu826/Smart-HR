'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { addDays, date as fmtDate, dur, fullName, mondayOf, today } from '@/lib/format';
import { EmployeePicker } from '@/components/pickers';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pager, Person, Progress, Select, StatusChip, Tabs, Textarea, useUi } from '@/components/ui';

type Kind = 'PLANNED' | 'UNROSTERED';
type Status = 'NEEDS_REASON' | 'PENDING' | 'APPROVED' | 'REJECTED';
type Emp = { id: string; empNo: string; firstName: string; lastName: string; designation?: string | null };

interface Claim {
  id: string;
  employeeId: string;
  date: string;
  kind: Kind;
  minutes: number;
  reason: string | null;
  status: Status;
  decidedAt: string | null;
  decisionNote: string | null;
  payrollRunId: string | null;
  employee: Emp;
  weekApprovedMinutes: number;
  capMinutes: number;
}

interface Weekly {
  weekStart: string;
  capMinutes: number;
  rows: { employee: Emp; approved: number; pending: number; needsReason: number; rejected: number }[];
}

type TabKey = 'claims' | 'week';
const PAGE = 50;

function capTone(used: number, cap: number): 'ok' | 'warn' | 'bad' {
  if (used > cap) return 'bad';
  if (used >= cap * 0.85) return 'warn';
  return 'ok';
}

export default function OvertimePage() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<TabKey>(sp.get('tab') === 'week' ? 'week' : 'claims');
  return (
    <>
      <PageHeader
        title="Overtime"
        sub="Planned overtime comes from the published roster. Unrostered overtime needs the employee's reason and then a manager's approval. The legal limit is 12 hours a week (planned + approved). A holiday premium is not overtime."
      />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'claims', label: 'Claims' },
          { value: 'week', label: 'This week' },
        ]}
      />
      {tab === 'claims' ? <Claims /> : <WeekView />}
    </>
  );
}

function Claims() {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState<Status | ''>('PENDING');
  const [kind, setKind] = useState<Kind | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [approving, setApproving] = useState<Claim | null>(null);
  const { data, error, loading, reload } = useApi<{ total: number; rows: Claim[] }>('/overtime', { status, kind, from, to, employeeId, page, pageSize: PAGE });
  const canApprove = can('overtime.approve');

  const reject = async (c: Claim) => {
    const note = await confirm({ title: `Reject ${dur(c.minutes)} overtime?`, body: `${fullName(c.employee)}, ${fmtDate(c.date, { weekday: true })}. It will not be paid.`, ok: 'Reject', danger: true, input: { label: 'Reason (the employee will see this)', minLength: 3 } });
    if (note === false) return;
    const r = await act.run(() => api.post(`/overtime/${c.id}/decide`, { approve: false, note }));
    if (r !== undefined) {
      toast('Overtime rejected.');
      reload();
    }
  };

  const f = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <Card pad={false}>
      <div className="filters">
        <Select
          value={status}
          onChange={(e) => f(setStatus)(e.target.value as Status | '')}
          placeholder="Any status"
          options={[
            { value: 'NEEDS_REASON', label: 'Needs reason' },
            { value: 'PENDING', label: 'Pending approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
        <Select
          value={kind}
          onChange={(e) => f(setKind)(e.target.value as Kind | '')}
          placeholder="Planned and unrostered"
          options={[
            { value: 'PLANNED', label: 'Planned (roster)' },
            { value: 'UNROSTERED', label: 'Unrostered' },
          ]}
        />
        <div style={{ minWidth: 240 }}>
          <EmployeePicker value={employeeId} onChange={(id) => f(setEmployeeId)(id)} placeholder="All employees" />
        </div>
        <span className="row tight small muted">
          From <Input type="date" value={from} onChange={(e) => f(setFrom)(e.target.value)} style={{ width: 150 }} />
          to <Input type="date" value={to} onChange={(e) => f(setTo)(e.target.value)} style={{ width: 150 }} />
        </span>
      </div>
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(d) =>
          d.rows.length === 0 ? (
            <Empty title="No overtime claims" icon="plus-clock">
              {status === 'PENDING' ? 'Nothing is waiting for approval.' : 'Nothing matches these filters.'}
            </Empty>
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Date</th>
                      <th>Kind</th>
                      <th className="num">Overtime</th>
                      <th>Reason</th>
                      <th style={{ minWidth: 170 }}>Week approved / limit</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((c) => {
                      const tone = capTone(c.weekApprovedMinutes + (c.status === 'PENDING' ? c.minutes : 0), c.capMinutes);
                      return (
                        <tr key={c.id}>
                          <td>
                            <Person name={fullName(c.employee)} sub={c.employee.empNo} href={`/attendance/${c.employee.id}?period=${c.date.slice(0, 7)}`} photoEmployeeId={c.employee.id} />
                          </td>
                          <td className="nowrap">{fmtDate(c.date, { weekday: true })}</td>
                          <td>
                            <Chip tone={c.kind === 'PLANNED' ? 'info' : 'mag'}>{c.kind === 'PLANNED' ? 'Planned' : 'Unrostered'}</Chip>
                          </td>
                          <td className="num">
                            <b>{dur(c.minutes)}</b>
                          </td>
                          <td style={{ maxWidth: 300 }}>
                            {c.status === 'NEEDS_REASON' ? <span className="warn-t small">Waiting for the employee&apos;s reason</span> : c.reason || <span className="faint">{c.kind === 'PLANNED' ? 'Rostered' : '—'}</span>}
                            {c.decisionNote && <div className="tiny muted">Note: {c.decisionNote}</div>}
                          </td>
                          <td>
                            <div className="small" style={{ marginBottom: 3 }}>
                              {dur(c.weekApprovedMinutes)} <span className="faint">of {dur(c.capMinutes)}</span>
                            </div>
                            <Progress value={c.weekApprovedMinutes} max={c.capMinutes} tone={tone} />
                            {c.status === 'PENDING' && c.weekApprovedMinutes + c.minutes > c.capMinutes && <div className="tiny bad-t">Full claim is over the limit; {dur(Math.max(0, c.capMinutes - c.weekApprovedMinutes))} left</div>}
                          </td>
                          <td>
                            <StatusChip status={c.status} />
                          </td>
                          <td className="nowrap right">
                            {c.status === 'PENDING' && c.kind === 'UNROSTERED' && canApprove && (
                              <>
                                <Button size="sm" variant="ok" disabled={act.busy} onClick={() => setApproving(c)}>
                                  Approve
                                </Button>{' '}
                                <Button size="sm" variant="danger" disabled={act.busy} onClick={() => reject(c)}>
                                  Reject
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
            </>
          )
        }
      </Async>
      {approving && (
        <ApproveModal
          claim={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            toast('Overtime approved.');
            reload();
          }}
        />
      )}
    </Card>
  );
}

function ApproveModal({ claim, onClose, onDone }: { claim: Claim; onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState(String(Math.floor(claim.minutes / 60)));
  const [m, setM] = useState(String(claim.minutes % 60));
  const [note, setNote] = useState('');
  const act = useAction();
  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0);
  const left = Math.max(0, claim.capMinutes - claim.weekApprovedMinutes);
  const inRange = minutes >= 1 && minutes <= claim.minutes && Number.isInteger(minutes);
  const overCap = minutes > left;

  const approve = async () => {
    const r = await act.run(() => api.post(`/overtime/${claim.id}/decide`, { approve: true, minutes, note: note.trim() || undefined }));
    if (r !== undefined) onDone();
  };

  return (
    <Modal
      title="Approve overtime"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="ok" busy={act.busy} disabled={!inRange || overCap} onClick={approve}>
            Approve {inRange ? dur(minutes) : ''}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div>
          <b>{fullName(claim.employee)}</b>
          <div className="muted small">
            {fmtDate(claim.date, { weekday: true })} · claimed {dur(claim.minutes)}
          </div>
          {claim.reason && <div className="small" style={{ marginTop: 6 }}>&ldquo;{claim.reason}&rdquo;</div>}
        </div>
        <Field label="Minutes to approve" hint={`You can approve less than claimed. Up to ${dur(claim.minutes)}.`} error={!inRange ? `Between 1 minute and ${dur(claim.minutes)}.` : null}>
          <div className="row tight">
            <Input type="number" min={0} max={16} value={h} onChange={(e) => setH(e.target.value)} style={{ width: 80 }} /> h
            <Input type="number" min={0} max={59} step={5} value={m} onChange={(e) => setM(e.target.value)} style={{ width: 80 }} /> min
          </div>
        </Field>
        <div>
          <div className="small row between" style={{ marginBottom: 4 }}>
            <span>This week after approval</span>
            <b className={overCap ? 'bad-t' : ''}>
              {dur(claim.weekApprovedMinutes + (inRange ? minutes : 0))} of {dur(claim.capMinutes)}
            </b>
          </div>
          <Progress value={claim.weekApprovedMinutes + (inRange ? minutes : 0)} max={claim.capMinutes} tone={overCap ? 'bad' : capTone(claim.weekApprovedMinutes + minutes, claim.capMinutes)} />
        </div>
        {overCap && <Alert tone="bad">This goes past the legal weekly limit. {dur(left)} is left this week — approve that much or less.</Alert>}
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
      </div>
    </Modal>
  );
}

function WeekView() {
  const [week, setWeek] = useState(mondayOf(today()));
  const { data, error, loading } = useApi<Weekly>('/overtime/weekly', { week });
  const thisWeek = mondayOf(today());
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="row tight">
          <Button size="sm" icon="chev-l" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} />
          <b style={{ minWidth: 200, textAlign: 'center' }}>
            {fmtDate(week, { year: false })} – {fmtDate(addDays(week, 6))}
          </b>
          <Button size="sm" icon="chev-r" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} />
          <Button size="sm" disabled={week === thisWeek} onClick={() => setWeek(thisWeek)}>
            This week
          </Button>
        </div>
      </div>
      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <Card pad={false} sub={`Legal limit ${dur(d.capMinutes)} a week, planned and approved together.`} title="Overtime this week">
            {d.rows.length === 0 ? (
              <Empty title="No overtime this week" icon="plus-clock" />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="num">Approved</th>
                      <th className="num">Pending</th>
                      <th className="num">Needs reason</th>
                      <th className="num">Rejected</th>
                      <th style={{ minWidth: 220 }}>Against the limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.rows]
                      .sort((a, b) => b.approved + b.pending - (a.approved + a.pending))
                      .map((r) => {
                        const tone = capTone(r.approved, d.capMinutes);
                        return (
                          <tr key={r.employee.id}>
                            <td>
                              <Person name={fullName(r.employee)} sub={r.employee.empNo} href={`/attendance/${r.employee.id}?period=${week.slice(0, 7)}`} photoEmployeeId={r.employee.id} />
                            </td>
                            <td className="num">
                              <b>{r.approved ? dur(r.approved) : '—'}</b>
                            </td>
                            <td className="num">{r.pending ? <span className="warn-t">{dur(r.pending)}</span> : '—'}</td>
                            <td className="num">{r.needsReason ? dur(r.needsReason) : '—'}</td>
                            <td className="num">{r.rejected ? <span className="muted">{dur(r.rejected)}</span> : '—'}</td>
                            <td>
                              <Progress value={r.approved} max={d.capMinutes} tone={tone} />
                              <div className="tiny muted" style={{ marginTop: 3 }}>
                                {r.approved > d.capMinutes ? <span className="bad-t">Over the limit by {dur(r.approved - d.capMinutes)}</span> : `${dur(d.capMinutes - r.approved)} left`}
                                {r.pending > 0 && r.approved + r.pending > d.capMinutes && <span className="warn-t"> · pending would pass the limit</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </Async>
    </>
  );
}
