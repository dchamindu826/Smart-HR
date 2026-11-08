'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { addDays, date as fmtDate, fullName, mondayOf, periodLabel, shiftPeriod, thisPeriod, today } from '@/lib/format';
import { BranchSelect, DepartmentSelect, EmployeePicker } from '@/components/pickers';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pager, Person, Select, StatusChip, Tabs, Textarea, useUi } from '@/components/ui';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Half = 'AM' | 'PM';

interface LeaveType {
  id: string;
  code: string;
  name: string;
  color: string;
  paid: boolean;
  allowHalfDay: boolean;
  active: boolean;
}

interface Request {
  id: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  halfDay: Half | null;
  days: number;
  reason: string | null;
  status: Status;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  leaveType: { id: string; code: string; name: string; color: string };
  employee: { id: string; empNo: string; firstName: string; lastName: string; designation: string | null };
}

interface CalItem {
  id: string;
  status: 'APPROVED' | 'PENDING';
  days: number;
  halfDay: Half | null;
  fromDate: string;
  toDate: string;
  leaveType: { name: string; color: string };
  employee: { id: string; firstName: string; lastName: string; department: { name: string } | null };
}

interface Balance {
  id: string;
  employee: { id: string; empNo: string; firstName: string; lastName: string };
  leaveType: { id: string; code: string; name: string; color: string; rule: string; paid: boolean };
  year: number;
  entitled: number;
  carried: number;
  adjusted: number;
  taken: number;
  pending: number;
  available: number;
}

type TabKey = 'requests' | 'calendar' | 'balances';
const PAGE = 50;

function TypeChip({ t }: { t: { name: string; color: string } }) {
  return (
    <span className="chip" style={{ background: t.color + '22', color: t.color }}>
      {t.name}
    </span>
  );
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function LeavePage() {
  const sp = useSearchParams();
  const initial = sp.get('tab');
  const [tab, setTab] = useState<TabKey>(initial === 'calendar' || initial === 'balances' ? initial : 'requests');
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [bump, setBump] = useState(0);
  return (
    <>
      <PageHeader
        title="Leave"
        sub="Requests, who is away, and what is left. Rest days and paid holidays inside a request are not counted as leave."
        actions={
          can('leave.approve') && (
            <Button variant="pri" icon="leaf" onClick={() => setAdding(true)}>
              Add leave for an employee
            </Button>
          )
        }
      />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'requests', label: 'Requests' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'balances', label: 'Balances' },
        ]}
      />
      {tab === 'requests' && <Requests bump={bump} />}
      {tab === 'calendar' && <Calendar bump={bump} />}
      {tab === 'balances' && <Balances />}
      {adding && <AddLeaveModal onClose={() => setAdding(false)} onSaved={() => setBump((b) => b + 1)} />}
    </>
  );
}

// ─── requests ─────────────────────────────────────────────────

function Requests({ bump }: { bump: number }) {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState<Status | ''>('PENDING');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ total: number; rows: Request[] }>('/leave/requests', { status, from, to, employeeId, page, pageSize: PAGE }, [bump]);
  const canApprove = can('leave.approve');

  const decide = async (r: Request, approve: boolean) => {
    let note: string | undefined;
    if (!approve) {
      const n = await confirm({ title: 'Reject this leave?', body: `${fullName(r.employee)} · ${r.leaveType.name}, ${num(r.days)} day${r.days === 1 ? '' : 's'}.`, ok: 'Reject', danger: true, input: { label: 'Reason (the employee will see this)', minLength: 3 } });
      if (n === false) return;
      note = n;
    }
    const ok = await act.run(() => api.post(`/leave/requests/${r.id}/decide`, { approve, note }));
    if (ok !== undefined) {
      toast(approve ? 'Leave approved.' : 'Leave rejected.');
      reload();
    }
  };

  const cancel = async (r: Request) => {
    const ok = await confirm({
      title: 'Cancel this leave?',
      body: r.status === 'APPROVED' ? 'The days go back to the balance and past days are recalculated.' : 'The request is withdrawn.',
      ok: 'Cancel leave',
      danger: true,
    });
    if (ok === false) return;
    const res = await act.run(() => api.post(`/leave/requests/${r.id}/cancel`));
    if (res !== undefined) {
      toast('Leave cancelled.');
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
            { value: 'PENDING', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'CANCELLED', label: 'Cancelled' },
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
            <Empty title="No leave requests" icon="leaf">
              {status === 'PENDING' ? 'Nothing is waiting for a decision.' : 'Nothing matches these filters.'}
            </Empty>
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Leave</th>
                      <th>Dates</th>
                      <th className="num">Days</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Person name={fullName(r.employee)} sub={[r.employee.empNo, r.employee.designation].filter(Boolean).join(' · ')} href={`/employees/${r.employee.id}`} photoEmployeeId={r.employee.id} />
                        </td>
                        <td>
                          <TypeChip t={r.leaveType} />
                        </td>
                        <td className="nowrap">
                          {fmtDate(r.fromDate, { weekday: true })}
                          {r.toDate !== r.fromDate && <> → {fmtDate(r.toDate, { weekday: true })}</>}
                          {r.halfDay && (
                            <>
                              {' '}
                              <Chip tone="info">{r.halfDay === 'AM' ? 'Morning' : 'Afternoon'}</Chip>
                            </>
                          )}
                        </td>
                        <td className="num">{num(r.days)}</td>
                        <td className="muted" style={{ maxWidth: 280 }}>
                          {r.reason || '—'}
                        </td>
                        <td>
                          <StatusChip status={r.status} />
                          {r.decisionNote && <div className="tiny muted" style={{ maxWidth: 200 }}>{r.decisionNote}</div>}
                        </td>
                        <td className="nowrap right">
                          {canApprove && r.status === 'PENDING' && (
                            <>
                              <Button size="sm" variant="ok" disabled={act.busy} onClick={() => decide(r, true)}>
                                Approve
                              </Button>{' '}
                              <Button size="sm" variant="danger" disabled={act.busy} onClick={() => decide(r, false)}>
                                Reject
                              </Button>{' '}
                            </>
                          )}
                          {canApprove && (r.status === 'PENDING' || r.status === 'APPROVED') && (
                            <Button size="sm" variant="ghost" disabled={act.busy} onClick={() => cancel(r)}>
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
            </>
          )
        }
      </Async>
    </Card>
  );
}

// ─── calendar ─────────────────────────────────────────────────

function Calendar({ bump }: { bump: number }) {
  const [period, setPeriod] = useState(thisPeriod());
  const first = `${period}-01`;
  const gridStart = mondayOf(first);
  const lastOfMonth = addDays(`${shiftPeriod(period, 1)}-01`, -1);
  const gridEnd = addDays(mondayOf(lastOfMonth), 6);
  const { data, error, loading } = useApi<CalItem[]>('/leave/calendar', { from: gridStart, to: gridEnd }, [bump]);
  const now = today();

  const dates = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);

  return (
    <Card
      title={periodLabel(period)}
      actions={
        <div className="row tight">
          <span className="row tight tiny muted" style={{ marginRight: 10 }}>
            <span className="ev" style={{ background: 'var(--blue)', color: '#fff', padding: '0 6px', borderRadius: 4 }}>
              Approved
            </span>
            <span style={{ border: '1.5px dashed var(--blue)', color: 'var(--blue)', padding: '0 6px', borderRadius: 4, fontWeight: 600 }}>Pending</span>
          </span>
          <Button size="sm" icon="chev-l" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))} />
          <Button size="sm" disabled={period === thisPeriod()} onClick={() => setPeriod(thisPeriod())}>
            This month
          </Button>
          <Button size="sm" icon="chev-r" aria-label="Next month" onClick={() => setPeriod(shiftPeriod(period, 1))} />
        </div>
      }
    >
      <Async data={data} error={error} loading={loading}>
        {(items) => (
          <>
            <div className="cal">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="dow">
                  {d}
                </div>
              ))}
              {dates.map((d) => {
                const on = items.filter((i) => i.fromDate <= d && i.toDate >= d);
                const shown = on.slice(0, 4);
                return (
                  <div key={d} className={`day ${d.slice(0, 7) !== period ? 'out' : ''} ${d === now ? 'today' : ''}`}>
                    <span className="n">{Number(d.slice(8))}</span>
                    {shown.map((i) => {
                      const name = `${i.employee.firstName} ${i.employee.lastName.slice(0, 1)}.`;
                      const style =
                        i.status === 'APPROVED'
                          ? { background: i.leaveType.color, color: '#fff' }
                          : { background: i.leaveType.color + '14', color: i.leaveType.color, border: `1.5px dashed ${i.leaveType.color}`, padding: '1px 4px' };
                      return (
                        <span
                          key={i.id}
                          className="ev"
                          style={style}
                          title={`${i.employee.firstName} ${i.employee.lastName}${i.employee.department ? ` (${i.employee.department.name})` : ''} — ${i.leaveType.name}${i.halfDay ? ` ${i.halfDay}` : ''}, ${i.status === 'PENDING' ? 'pending' : 'approved'}: ${fmtDate(i.fromDate, { year: false })}${i.toDate !== i.fromDate ? ` – ${fmtDate(i.toDate, { year: false })}` : ''}`}
                        >
                          {name}
                          {i.halfDay ? ` ½${i.halfDay}` : ''}
                        </span>
                      );
                    })}
                    {on.length > shown.length && <span className="tiny muted">+{on.length - shown.length} more</span>}
                  </div>
                );
              })}
            </div>
            {items.length === 0 && <p className="muted small" style={{ marginTop: 10 }}>Nobody is on leave in this period.</p>}
          </>
        )}
      </Async>
    </Card>
  );
}

// ─── balances ─────────────────────────────────────────────────

function Balances() {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [adjusting, setAdjusting] = useState<{ employee: Balance['employee']; type: Balance['leaveType']; balance: Balance | null } | null>(null);
  const { data, error, loading, reload } = useApi<Balance[]>('/leave/balances', { year, branchId, departmentId });
  const canAdjust = can('leave.adjust');

  const matrix = useMemo(() => {
    const emps = new Map<string, Balance['employee']>();
    const types = new Map<string, Balance['leaveType']>();
    const cell = new Map<string, Balance>();
    for (const b of data ?? []) {
      emps.set(b.employee.id, b.employee);
      types.set(b.leaveType.id, b.leaveType);
      cell.set(`${b.employee.id}|${b.leaveType.id}`, b);
    }
    return { emps: [...emps.values()], types: [...types.values()], cell };
  }, [data]);

  const generate = async () => {
    const ok = await confirm({ title: `Generate balances for ${year}?`, body: 'Entitlements are created or refreshed for every active employee. Days taken and manual adjustments are never changed.', ok: 'Generate' });
    if (ok === false) return;
    const r = await act.run(() => api.post<{ updated: number }>('/leave/balances/generate', { year }));
    if (r !== undefined) {
      toast(`${r.updated} balance${r.updated === 1 ? '' : 's'} created or updated.`);
      reload();
    }
  };

  return (
    <Card pad={false}>
      <div className="filters">
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} />
        <BranchSelect value={branchId} onChange={setBranchId} />
        <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
        {canAdjust && (
          <Button icon="refresh" busy={act.busy} onClick={generate} style={{ marginLeft: 'auto' }}>
            Generate / refresh balances for {year}
          </Button>
        )}
      </div>
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {() =>
          matrix.emps.length === 0 ? (
            <Empty title={`No balances for ${year}`} icon="leaf">
              {canAdjust ? 'Generate the balances for the year to create each employee’s entitlement.' : 'HR has not generated the balances for this year yet.'}
            </Empty>
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {matrix.types.map((t) => (
                        <th key={t.id} className="num">
                          <span style={{ color: t.color }}>●</span> {t.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.emps.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Person name={fullName(e)} sub={e.empNo} href={`/employees/${e.id}`} photoEmployeeId={e.id} />
                        </td>
                        {matrix.types.map((t) => {
                          const b = matrix.cell.get(`${e.id}|${t.id}`) ?? null;
                          const total = b ? b.entitled + b.carried + b.adjusted : 0;
                          const body = b ? (
                            <>
                              <b className={b.available < 0 ? 'bad-t' : ''}>{num(b.available)}</b>
                              <span className="faint"> / {num(total)}</span>
                              {b.pending > 0 && <div className="tiny warn-t">{num(b.pending)} pending</div>}
                            </>
                          ) : (
                            <span className="faint">—</span>
                          );
                          const title = b ? `Entitled ${num(b.entitled)}, carried ${num(b.carried)}, adjusted ${num(b.adjusted)}, taken ${num(b.taken)}, pending ${num(b.pending)}` : undefined;
                          return (
                            <td key={t.id} className="num" title={title}>
                              {canAdjust ? (
                                <button type="button" className="linkbtn" style={{ color: 'inherit', fontWeight: 400 }} onClick={() => setAdjusting({ employee: e, type: t, balance: b })}>
                                  {body}
                                </button>
                              ) : (
                                body
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny faint" style={{ padding: '10px 16px' }}>
                Available / total (entitled + carried + adjusted). Pending requests are already taken out of available.{canAdjust ? ' Click a number to adjust it.' : ''}
              </p>
            </>
          )
        }
      </Async>
      {adjusting && (
        <AdjustModal
          {...adjusting}
          year={year}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function AdjustModal({ employee, type, balance, year, onClose, onSaved }: { employee: Balance['employee']; type: Balance['leaveType']; balance: Balance | null; year: number; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  const { toast } = useUi();
  const n = Number(days);
  const ok = days.trim() !== '' && Number.isFinite(n) && n !== 0 && Math.abs(n) <= 100 && Math.round(n * 2) === n * 2 && reason.trim().length >= 5;

  const save = async () => {
    const r = await act.run(() => api.post('/leave/balances/adjust', { employeeId: employee.id, leaveTypeId: type.id, year, days: n, reason: reason.trim() }));
    if (r !== undefined) {
      toast('Balance adjusted.');
      onSaved();
    }
  };

  return (
    <Modal
      title={`Adjust ${type.name.toLowerCase()}`}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            Adjust balance
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div>
          <b>{fullName(employee)}</b> <span className="muted small">{employee.empNo}</span>
          {balance ? (
            <div className="small muted" style={{ marginTop: 4 }}>
              {year}: entitled {num(balance.entitled)}, carried {num(balance.carried)}, adjusted {num(balance.adjusted)}, taken {num(balance.taken)} → <b>{num(balance.available)} available</b>
            </div>
          ) : (
            <div className="small muted">No balance yet for {year}; one will be created.</div>
          )}
        </div>
        <Field label="Days" required hint="Positive adds days, negative takes them away (e.g. 1.5 or -2). Half days allowed.">
          <Input type="number" step={0.5} value={days} onChange={(e) => setDays(e.target.value)} placeholder="+1" />
        </Field>
        <Field label="Reason" required hint="Kept in the audit log. At least 5 characters.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 60 }} />
        </Field>
        {balance && ok && (
          <div className="small">
            Available after: <b>{num(balance.available + n)}</b>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── add leave ────────────────────────────────────────────────

function AddLeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: types } = useApi<LeaveType[]>('/leave/types');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [half, setHalf] = useState<Half | ''>('');
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(true);
  const act = useAction();
  const { toast } = useUi();
  const type = (types ?? []).find((t) => t.id === typeId) ?? null;
  const single = from === to;
  const canHalf = single && !!type?.allowHalfDay;
  const valid = !!employeeId && !!typeId && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from;

  const save = async () => {
    const r = await act.run(() =>
      api.post<{ days: number; status: Status }>('/leave/requests', {
        employeeId,
        leaveTypeId: typeId,
        fromDate: from,
        toDate: to,
        halfDay: canHalf && half ? half : null,
        reason: reason.trim() || null,
        autoApprove: approveNow,
      }),
    );
    if (r !== undefined) {
      toast(`${num(r.days)} day${r.days === 1 ? '' : 's'} of leave ${r.status === 'APPROVED' ? 'added and approved' : 'added — waiting for approval'}.`);
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      title="Add leave for an employee"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!valid} onClick={save}>
            {approveNow ? 'Add and approve' : 'Add request'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Employee" required wide>
            <EmployeePicker value={employeeId} onChange={(id) => setEmployeeId(id)} />
          </Field>
          <Field label="Leave type" required wide>
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="Choose…" options={(types ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.paid ? '' : ' (no pay)'}` }))} />
          </Field>
          <Field label="From" required>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to < e.target.value) setTo(e.target.value);
              }}
            />
          </Field>
          <Field label="To" required error={to < from ? 'The end is before the start.' : null}>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {canHalf && (
            <Field label="Half day" hint="Only for a single date.">
              <Select
                value={half}
                onChange={(e) => setHalf(e.target.value as Half | '')}
                placeholder="Full day"
                options={[
                  { value: 'AM', label: 'Morning (AM)' },
                  { value: 'PM', label: 'Afternoon (PM)' },
                ]}
              />
            </Field>
          )}
          <Field label="Reason" wide>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 60 }} />
          </Field>
        </div>
        <Check checked={approveNow} onChange={setApproveNow} label="Approve now (the days are taken from the balance straight away)" />
        <Alert tone="info">Rest days and paid holidays in the range are not counted. The balance is checked; use no-pay leave if it runs out.</Alert>
      </div>
    </Modal>
  );
}
