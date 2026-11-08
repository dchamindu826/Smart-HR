'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { date, dur, label, money, moneyShort, periodLabel, shiftPeriod, thisPeriod } from '@/lib/format';
import { BranchSelect } from '@/components/pickers';
import { Async, Button, Card, Empty, HBars, Input, PageHeader, Stat, StatusChip, Tabs } from '@/components/ui';

type TabKey = 'headcount' | 'attendance' | 'overtime' | 'leave' | 'payroll' | 'cost';

type Group = { label: string; count: number }[];
/** GET /reports/headcount */
interface Headcount {
  total: number;
  byBranch: Group;
  byDepartment: Group;
  byType: Group;
  byGender: Group;
  byService: Group;
  byAge: Group;
}
/** GET /reports/attendance */
interface AttRow {
  empNo: string;
  name: string;
  department: string;
  present: number;
  absent: number;
  leave: number;
  off: number;
  lateDays: number;
  lateMinutes: number;
  workedHours: string;
  otHours: string;
  missingOut: number;
}
/** GET /reports/overtime */
interface Overtime {
  byDepartment: { department: string; approved: number; pending: number; rejected: number }[];
  rows: { date: string; empNo: string; name: string; kind: string; minutes: number; status: string; reason: string | null }[];
}
/** GET /reports/leave */
interface LeaveRow {
  empNo: string;
  name: string;
  leave: string;
  entitled: number;
  carried: number;
  adjusted: number;
  taken: number;
  available: number;
}
/** GET /reports/payroll-summary — run totals are null until calculated */
interface PayrollMonth {
  period: string;
  status: string;
  employees?: number;
  gross?: string;
  deductions?: string;
  net?: string;
  epfEmployee?: string;
  epfEmployer?: string;
  etf?: string;
  apit?: string;
  stampDuty?: string;
  otPay?: string;
}
/** GET /reports/salary-cost */
interface CostRow {
  department: string;
  people: number;
  gross: string;
  employerCost: string;
}

const TABS: TabKey[] = ['headcount', 'attendance', 'overtime', 'leave', 'payroll', 'cost'];

export default function ReportsPage() {
  const { can, has } = useAuth();
  const sp = useSearchParams();
  const tabs: { value: TabKey; label: string }[] = [
    { value: 'headcount', label: 'Headcount' },
    { value: 'attendance', label: 'Attendance' },
    ...(has('overtime') ? [{ value: 'overtime' as const, label: 'Overtime' }] : []),
    { value: 'leave', label: 'Leave balances' },
    ...(can('payroll.view')
      ? [
          { value: 'payroll' as const, label: 'Payroll summary' },
          { value: 'cost' as const, label: 'Salary cost by department' },
        ]
      : []),
  ];
  const fromUrl = sp.get('tab') as TabKey | null;
  const [tab, setTab] = useState<TabKey>(fromUrl && TABS.includes(fromUrl) ? fromUrl : 'headcount');
  const current = tabs.some((t) => t.value === tab) ? tab : 'headcount';

  return (
    <>
      <PageHeader title="Reports" sub="Figures for the people you can see. Export to Excel where shown." />
      <Tabs<TabKey> value={current} onChange={setTab} tabs={tabs} />
      {current === 'headcount' && <HeadcountTab />}
      {current === 'attendance' && <AttendanceTab />}
      {current === 'overtime' && <OvertimeTab />}
      {current === 'leave' && <LeaveTab />}
      {current === 'payroll' && <PayrollTab />}
      {current === 'cost' && <CostTab />}
    </>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ok = /^\d{4}-\d{2}$/.test(value);
  return (
    <div className="row tight">
      <Button size="sm" icon="chev-l" aria-label="Previous month" disabled={!ok} onClick={() => onChange(shiftPeriod(value, -1))} />
      <Input type="month" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 170 }} />
      <Button size="sm" icon="chev-r" aria-label="Next month" disabled={!ok} onClick={() => onChange(shiftPeriod(value, 1))} />
    </div>
  );
}

function ExportButton({ path, query, name }: { path: string; query: Record<string, string | number | undefined>; name: string }) {
  const act = useAction();
  return (
    <>
      <Button size="sm" icon="download" busy={act.busy} onClick={() => act.run(() => download(path, { ...query, format: 'xlsx' }, name))}>
        Export Excel
      </Button>
      {act.error && <span className="small bad-t">{act.error}</span>}
    </>
  );
}

// ─── Headcount ────────────────────────────────────────────────

function HeadcountTab() {
  const { data, error, loading } = useApi<Headcount>('/reports/headcount');
  return (
    <Async data={data} error={error} loading={loading}>
      {(h) => {
        const cards: [string, Group][] = [
          ['By branch', h.byBranch],
          ['By department', h.byDepartment],
          ['By employment type', h.byType.map((g) => ({ ...g, label: label(g.label) }))],
          ['By gender', h.byGender.map((g) => ({ ...g, label: label(g.label) }))],
          ['By length of service', h.byService],
          ['By age', h.byAge],
        ];
        return (
          <>
            <div className="stats">
              <Stat label="Active employees" value={h.total} href="/employees" />
              <Stat label="Branches" value={h.byBranch.length} />
              <Stat label="Departments" value={h.byDepartment.length} />
            </div>
            {h.total === 0 ? (
              <Card>
                <Empty title="No active employees" icon="users" />
              </Card>
            ) : (
              <div className="grid3">
                {cards.map(([t, g]) => (
                  <div key={t}>
                    <Card title={t}>
                      <HBars data={g.map((x) => ({ label: x.label, value: x.count }))} />
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      }}
    </Async>
  );
}

// ─── Attendance ───────────────────────────────────────────────

function AttendanceTab() {
  const [period, setPeriod] = useState(thisPeriod());
  const [branchId, setBranchId] = useState('');
  const ok = /^\d{4}-\d{2}$/.test(period);
  const { data, error, loading } = useApi<AttRow[]>(ok ? '/reports/attendance' : null, { period, branchId });
  return (
    <Card pad={false}>
      <div className="filters">
        <MonthPicker value={period} onChange={setPeriod} />
        <BranchSelect value={branchId} onChange={setBranchId} />
        <div className="grow" />
        {ok && <ExportButton path="/reports/attendance" query={{ period, branchId: branchId || undefined }} name={`attendance-${period}.xlsx`} />}
      </div>
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="No employees" icon="clock">
              Nobody active in this branch.
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th className="num">Present</th>
                    <th className="num">Absent</th>
                    <th className="num">Leave</th>
                    <th className="num">Off / holiday</th>
                    <th className="num">Late days</th>
                    <th className="num">Late time</th>
                    <th className="num">Worked h</th>
                    <th className="num">OT h</th>
                    <th className="num">Missing mark-out</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.empNo}>
                      <td className="mono">{r.empNo}</td>
                      <td>
                        <b>{r.name}</b>
                      </td>
                      <td className="muted">{r.department || '—'}</td>
                      <td className="num">{r.present}</td>
                      <td className={`num ${r.absent ? 'bad-t' : ''}`}>{r.absent}</td>
                      <td className="num">{r.leave}</td>
                      <td className="num">{r.off}</td>
                      <td className={`num ${r.lateDays ? 'warn-t' : ''}`}>{r.lateDays}</td>
                      <td className="num">{r.lateMinutes ? dur(r.lateMinutes) : '—'}</td>
                      <td className="num">{r.workedHours}</td>
                      <td className="num">{r.otHours}</td>
                      <td className={`num ${r.missingOut ? 'warn-t' : ''}`}>{r.missingOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
      <div className="card-b tight small muted">Counts are of closed attendance days in {ok ? periodLabel(period) : 'the month'}. Days close after midnight.</div>
    </Card>
  );
}

// ─── Overtime ─────────────────────────────────────────────────

function OvertimeTab() {
  const [period, setPeriod] = useState(thisPeriod());
  const ok = /^\d{4}-\d{2}$/.test(period);
  const { data, error, loading } = useApi<Overtime>(ok ? '/reports/overtime' : null, { period });
  return (
    <>
      <Card pad={false}>
        <div className="filters">
          <MonthPicker value={period} onChange={setPeriod} />
          <div className="grow" />
          {ok && <ExportButton path="/reports/overtime" query={{ period }} name={`overtime-${period}.xlsx`} />}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Async data={data} error={error} loading={loading}>
        {(o) =>
          o.rows.length === 0 ? (
            <Card>
              <Empty title="No overtime this month" icon="plus-clock" />
            </Card>
          ) : (
            <>
              <Card title="By department" sub="hours" pad={false}>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th className="num">Approved</th>
                        <th className="num">Waiting</th>
                        <th className="num">Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.byDepartment.map((d) => (
                        <tr key={d.department}>
                          <td>
                            <b>{d.department}</b>
                          </td>
                          <td className="num">{dur(d.approved)}</td>
                          <td className="num">{d.pending ? dur(d.pending) : '—'}</td>
                          <td className="num">{d.rejected ? dur(d.rejected) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Claims" sub={`${o.rows.length} in ${periodLabel(period)}`} pad={false}>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>No</th>
                        <th>Name</th>
                        <th>Kind</th>
                        <th className="num">Overtime</th>
                        <th>Status</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...o.rows]
                        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.empNo.localeCompare(b.empNo)))
                        .map((r, i) => (
                          <tr key={r.date + r.empNo + i}>
                            <td className="nowrap">{date(r.date, { weekday: true, year: false })}</td>
                            <td className="mono">{r.empNo}</td>
                            <td>{r.name}</td>
                            <td>{label(r.kind)}</td>
                            <td className="num">{dur(r.minutes)}</td>
                            <td>
                              <StatusChip status={r.status} />
                            </td>
                            <td className="muted small" style={{ maxWidth: 320 }}>
                              {r.reason || '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )
        }
      </Async>
    </>
  );
}

// ─── Leave ────────────────────────────────────────────────────

function LeaveTab() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [q, setQ] = useState('');
  const ok = /^\d{4}$/.test(year);
  const { data, error, loading } = useApi<LeaveRow[]>(ok ? '/reports/leave' : null, { year });
  const s = q.trim().toLowerCase();
  return (
    <Card pad={false}>
      <div className="filters">
        <Input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(e.target.value)} style={{ width: 110, minWidth: 0 }} aria-label="Year" />
        <Input className="search" placeholder="Search name, number or leave type…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grow" />
        {ok && <ExportButton path="/reports/leave" query={{ year }} name={`leave-${year}.xlsx`} />}
      </div>
      <Async data={data} error={error} loading={loading}>
        {(all) => {
          const rows = s ? all.filter((r) => [r.empNo, r.name, r.leave].some((v) => v.toLowerCase().includes(s))) : all;
          return rows.length === 0 ? (
            <Empty title="No leave balances" icon="leaf">
              {s ? 'Nothing matches your search.' : `Balances for ${year} are created when the leave year starts.`}
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Name</th>
                    <th>Leave</th>
                    <th className="num">Entitled</th>
                    <th className="num">Carried</th>
                    <th className="num">Adjusted</th>
                    <th className="num">Taken</th>
                    <th className="num">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.empNo + r.leave}>
                      <td className="mono">{r.empNo}</td>
                      <td>{r.name}</td>
                      <td>{r.leave}</td>
                      <td className="num">{r.entitled}</td>
                      <td className="num">{r.carried || '—'}</td>
                      <td className="num">{r.adjusted || '—'}</td>
                      <td className="num">{r.taken}</td>
                      <td className={`num ${r.available < 0 ? 'bad-t' : ''}`}>
                        <b>{r.available}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>
    </Card>
  );
}

// ─── Payroll summary ──────────────────────────────────────────

function PayrollTab() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const ok = /^\d{4}$/.test(year);
  const { data, error, loading } = useApi<PayrollMonth[]>(ok ? '/reports/payroll-summary' : null, { year });
  return (
    <Card pad={false} title="Payroll summary" sub="Run totals by month, amounts in Rs">
      <div className="filters">
        <Button size="sm" icon="chev-l" aria-label="Previous year" disabled={!ok} onClick={() => setYear(String(Number(year) - 1))} />
        <Input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(e.target.value)} style={{ width: 110, minWidth: 0 }} aria-label="Year" />
        <Button size="sm" icon="chev-r" aria-label="Next year" disabled={!ok} onClick={() => setYear(String(Number(year) + 1))} />
      </div>
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title={`No payroll in ${year}`} icon="money" />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Status</th>
                    <th className="num">Employees</th>
                    <th className="num">Gross</th>
                    <th className="num">Deductions</th>
                    <th className="num">Net</th>
                    <th className="num">EPF 8%</th>
                    <th className="num">EPF 12%</th>
                    <th className="num">ETF 3%</th>
                    <th className="num">APIT</th>
                    <th className="num">OT pay</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.period}>
                      <td>
                        <b>{periodLabel(r.period)}</b>
                      </td>
                      <td>
                        <StatusChip status={r.status} />
                      </td>
                      <td className="num">{r.employees ?? '—'}</td>
                      <td className="num">{money(r.gross)}</td>
                      <td className="num">{money(r.deductions)}</td>
                      <td className="num">
                        <b>{money(r.net)}</b>
                      </td>
                      <td className="num">{money(r.epfEmployee)}</td>
                      <td className="num">{money(r.epfEmployer)}</td>
                      <td className="num">{money(r.etf)}</td>
                      <td className="num">{money(r.apit)}</td>
                      <td className="num">{money(r.otPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
      <div className="card-b tight small muted">Only locked months are final. Draft and calculated months can still change.</div>
    </Card>
  );
}

// ─── Salary cost by department ────────────────────────────────

function CostTab() {
  const [period, setPeriod] = useState(shiftPeriod(thisPeriod(), -1));
  const ok = /^\d{4}-\d{2}$/.test(period);
  const { data, error, loading } = useApi<CostRow[]>(ok ? '/reports/salary-cost' : null, { period });
  return (
    <>
      <Card pad={false}>
        <div className="filters">
          <MonthPicker value={period} onChange={setPeriod} />
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Card>
              <Empty title={`No payroll for ${ok ? periodLabel(period) : 'this month'}`} icon="money">
                Salary cost comes from the calculated payroll for the month.
              </Empty>
            </Card>
          ) : (
            <div className="grid-main">
              <Card pad={false} title="Salary cost by department" sub="Employer cost = gross + EPF 12% + ETF 3%">
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th className="num">People</th>
                        <th className="num">Gross (Rs)</th>
                        <th className="num">Employer cost (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows]
                        .sort((a, b) => Number(b.employerCost) - Number(a.employerCost))
                        .map((r) => (
                          <tr key={r.department}>
                            <td>
                              <b>{r.department}</b>
                            </td>
                            <td className="num">{r.people}</td>
                            <td className="num">{money(r.gross)}</td>
                            <td className="num">
                              <b>{money(r.employerCost)}</b>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div>
                <Card title="Employer cost">
                  <HBars data={[...rows].sort((a, b) => Number(b.employerCost) - Number(a.employerCost)).map((r) => ({ label: r.department, value: Number(r.employerCost) }))} format={moneyShort} />
                </Card>
              </div>
            </div>
          )
        }
      </Async>
    </>
  );
}
