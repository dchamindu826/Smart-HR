'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { date, dateTime, dur, fullName, money, periodLabel } from '@/lib/format';
import { EmployeePicker } from '@/components/pickers';
import { Icon } from '@/components/Icon';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Person, Select, Stat, StatusChip, Textarea, useUi } from '@/components/ui';

type RunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'LOCKED';

interface Totals {
  employees: number;
  gross: string;
  deductions: string;
  net: string;
  epfEmployee: string;
  epfEmployer: string;
  etf: string;
  apit: string;
  stampDuty: string;
  otPay: string;
  warnings: number;
}

interface Snapshot {
  empNo: string;
  name: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
}

interface RunSlip {
  id: string;
  employeeId: string;
  basic: string;
  gross: string;
  totalDeductions: string;
  net: string;
  epfEmployee: string;
  epfEmployer: string;
  etf: string;
  apit: string;
  otMinutes: number;
  noPayDays: number;
  warnings: string[];
  snapshot: Snapshot;
}

/** GET /payroll/runs/:id */
interface Run {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  calculatedById: string | null;
  calculatedAt: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  lockedById: string | null;
  lockedAt: string | null;
  releasedAt: string | null;
  totals: Totals | null;
  payslips: RunSlip[];
}

/** GET /payroll/runs/:id/checklist */
interface Checklist {
  employees: number;
  daysSoFar: number;
  items: { key: string; label: string; count: number; blocking: boolean; link: string }[];
}

/** GET /payroll/adjustments?period */
interface Adjustment {
  id: string;
  employeeId: string;
  period: string;
  kind: 'EARNING' | 'DEDUCTION';
  code: string;
  label: string;
  amount: string;
  epfApplicable: boolean;
  taxable: boolean;
  reason: string | null;
  createdAt: string;
  employee: { id: string; empNo: string; firstName: string; lastName: string };
}

const STEPS = ['Draft', 'Calculated', 'Approved', 'Locked', 'Released'];

function stepIndex(r: Run): number {
  if (r.releasedAt) return 4;
  return { DRAFT: 0, CALCULATED: 1, APPROVED: 2, LOCKED: 3 }[r.status];
}

function Stepper({ run }: { run: Run }) {
  const at = stepIndex(run);
  const when = [null, run.calculatedAt, run.approvedAt, run.lockedAt, run.releasedAt];
  return (
    <div className="row" style={{ gap: 0, marginBottom: 16, alignItems: 'stretch' }}>
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && i === 4);
        const current = i === at && i !== 4;
        const color = done ? 'var(--ok)' : current ? 'var(--blue)' : 'var(--ink-3)';
        return (
          <div key={s} className="row tight" style={{ flex: '1 1 120px', minWidth: 110, padding: '6px 0' }}>
            <span
              style={{
                width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flex: 'none',
                background: done ? 'var(--ok)' : current ? 'var(--blue)' : 'var(--card-2)', color: done || current ? '#fff' : 'var(--ink-3)',
              }}
            >
              {done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <div style={{ lineHeight: 1.2 }}>
              <b style={{ color, fontSize: 13 }}>{s}</b>
              <div className="tiny faint">{when[i] ? date(when[i], { year: false }) : current ? 'Now' : ' '}</div>
            </div>
            {i < STEPS.length - 1 && <span style={{ flex: 1, height: 2, background: i < at ? 'var(--ok)' : 'var(--rule)', margin: '0 8px', minWidth: 12 }} />}
          </div>
        );
      })}
    </div>
  );
}

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const { data, error, loading, reload } = useApi<Run>(`/payroll/runs/${id}`);
  const checklist = useApi<Checklist>(`/payroll/runs/${id}/checklist`);
  const adjustments = useApi<Adjustment[]>(data ? '/payroll/adjustments' : null, data ? { period: data.period } : undefined);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const reloadAll = () => {
    reload();
    checklist.reload();
    adjustments.reload();
  };

  const step = async (path: string, done: string, opts?: Parameters<typeof confirm>[0]) => {
    if (opts && (await confirm(opts)) === false) return;
    const r = await act.run(() => api.post(`/payroll/runs/${id}/${path}`));
    if (r !== undefined) {
      toast(done);
      reloadAll();
    }
  };

  const remove = async (r: Run) => {
    if ((await confirm({ title: `Delete ${periodLabel(r.period)} payroll?`, body: 'The run and its payslips are removed. Adjustments for the month are kept. You can start the month again.', ok: 'Delete run', danger: true })) === false) return;
    const ok = await act.run(() => api.del(`/payroll/runs/${id}`));
    if (ok !== undefined) {
      toast('Payroll run deleted.');
      router.push('/payroll');
    }
  };

  const dl = async (path: string, name: string) => {
    await act.run(() => download(path, undefined, name));
  };

  const delAdj = async (a: Adjustment) => {
    if ((await confirm({ title: 'Remove this adjustment?', body: `${a.label} — Rs ${money(a.amount)} for ${fullName(a.employee)}.`, ok: 'Remove', danger: true })) === false) return;
    const ok = await act.run(() => api.del(`/payroll/adjustments/${a.id}`));
    if (ok !== undefined) {
      toast('Adjustment removed. Recalculate to update payslips.');
      adjustments.reload();
    }
  };

  const slips = useMemo(() => {
    const all = data?.payslips ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((p) => [p.snapshot.empNo, p.snapshot.name, p.snapshot.designation ?? '', p.snapshot.department ?? ''].some((v) => v.toLowerCase().includes(s)));
  }, [data, q]);

  return (
    <Async data={data} error={error} loading={loading}>
      {(r) => {
        const open = r.status === 'DRAFT' || r.status === 'CALCULATED';
        const t = r.totals;
        const selfCalc = r.status === 'CALCULATED' && r.calculatedById === me?.user.id && me?.user.role !== 'OWNER';
        return (
          <>
            <PageHeader
              crumbs={[{ href: '/payroll', label: 'Payroll' }]}
              title={`${periodLabel(r.period)} payroll`}
              sub={`${date(r.periodStart)} – ${date(r.periodEnd)}`}
              actions={
                <>
                  {can('payroll.run') && open && (
                    <Button
                      variant={r.status === 'DRAFT' ? 'pri' : ''}
                      icon="refresh"
                      busy={act.busy}
                      onClick={() =>
                        step(
                          'calculate',
                          'Payroll calculated.',
                          r.status === 'CALCULATED' ? { title: 'Recalculate payroll?', body: 'Every payslip is rebuilt from the latest attendance, leave, overtime, loans and adjustments.', ok: 'Recalculate' } : undefined,
                        )
                      }
                    >
                      {r.status === 'DRAFT' ? 'Calculate' : 'Recalculate'}
                    </Button>
                  )}
                  {can('payroll.approve') && r.status === 'CALCULATED' && (
                    <Button variant="ok" icon="check" busy={act.busy} onClick={() => step('approve', 'Payroll approved.', { title: `Approve ${periodLabel(r.period)} payroll?`, body: `Net pay Rs ${money(t?.net)} for ${t?.employees ?? r.payslips.length} employees. After approval the bank file can be downloaded.`, ok: 'Approve' })}>
                      Approve
                    </Button>
                  )}
                  {can('payroll.run') && (r.status === 'CALCULATED' || r.status === 'APPROVED') && (
                    <Button busy={act.busy} onClick={() => step('reopen', 'Payroll reopened as a draft.', { title: 'Reopen payroll?', body: 'The run goes back to draft. Approval is cleared and it must be calculated and approved again.', ok: 'Reopen' })}>
                      Reopen
                    </Button>
                  )}
                  {can('payroll.approve') && r.status === 'APPROVED' && (
                    <Button
                      variant="danger"
                      className="solid"
                      icon="key"
                      busy={act.busy}
                      onClick={() =>
                        step('lock', 'Payroll locked.', {
                          title: `Lock ${periodLabel(r.period)} payroll?`,
                          body: 'Lock — this cannot be undone. Corrections after this go into next month as arrears. Overtime is marked paid and loan instalments are recorded.',
                          ok: 'Lock payroll',
                          danger: true,
                        })
                      }
                    >
                      Lock
                    </Button>
                  )}
                  {can('payroll.approve') && r.status === 'LOCKED' && !r.releasedAt && (
                    <Button variant="pri" icon="send" busy={act.busy} onClick={() => step('release', 'Payslips released to employees.', { title: 'Release payslips?', body: 'Employees can see their payslips in the app and get a notification.', ok: 'Release payslips' })}>
                      Release payslips
                    </Button>
                  )}
                  {can('payroll.run') && r.status !== 'LOCKED' && (
                    <Button variant="danger" icon="trash" busy={act.busy} onClick={() => remove(r)}>
                      Delete
                    </Button>
                  )}
                </>
              }
            />
            <ErrorBox error={act.error} />
            <Stepper run={r} />

            {selfCalc && (
              <div style={{ marginBottom: 14 }}>
                <Alert tone="info">You calculated this run. If another payroll user exists, they must approve it.</Alert>
              </div>
            )}
            {r.status === 'LOCKED' && (
              <div style={{ marginBottom: 14 }}>
                <Alert tone="ok">
                  Locked on {dateTime(r.lockedAt)}. This month is final. Corrections go into an open month as arrears or deductions.
                  {r.releasedAt ? ` Payslips released on ${dateTime(r.releasedAt)}.` : ' Payslips are not yet visible to employees.'}
                </Alert>
              </div>
            )}

            {open && (
              <Card title="Before you calculate" sub={checklist.data ? `${checklist.data.employees} employees in this month` : undefined} pad={false}>
                <Async data={checklist.data} error={checklist.error} loading={checklist.loading}>
                  {(c) => (
                    <>
                      {c.items.map((i) => (
                        <div className="list-row" key={i.key}>
                          <span className={`dot ${i.count === 0 ? 'ok' : i.blocking ? 'bad' : 'warn'}`} />
                          <div className="bd">
                            <b style={{ fontWeight: i.count ? 600 : 400 }}>{i.label}</b>
                          </div>
                          {i.count === 0 ? <Chip tone="ok">None</Chip> : <Chip tone={i.blocking ? 'bad' : 'warn'}>{i.count}</Chip>}
                          {i.count > 0 && (
                            <Link className="btn xs" href={i.link}>
                              Open
                            </Link>
                          )}
                        </div>
                      ))}
                      <div className="card-b tight small muted">These do not stop the calculation, but sort them out first so payslips are right. You can recalculate any time before approval.</div>
                    </>
                  )}
                </Async>
              </Card>
            )}

            {t ? (
              <div className="stats" style={{ marginTop: 16 }}>
                <Stat label="Employees" value={t.employees} sub={t.warnings ? `${t.warnings} with warnings` : 'no warnings'} tone={t.warnings ? 'warn' : undefined} />
                <Stat label="Gross pay" value={money(t.gross)} sub={`OT pay Rs ${money(t.otPay)}`} />
                <Stat label="Deductions" value={money(t.deductions)} sub={`stamp duty Rs ${money(t.stampDuty)}`} tone="bad" />
                <Stat label="Net pay" value={money(t.net)} sub="to the bank" tone="ok" />
                <Stat label="EPF 8% (employee)" value={money(t.epfEmployee)} />
                <Stat label="EPF 12% (employer)" value={money(t.epfEmployer)} />
                <Stat label="ETF 3%" value={money(t.etf)} />
                <Stat label="APIT" value={money(t.apit)} tone="mag" />
              </div>
            ) : (
              <div style={{ marginTop: 16 }} />
            )}

            <Card
              title="Payslips"
              sub={r.payslips.length ? `${r.payslips.length} employees · amounts in Rs` : undefined}
              pad={false}
              actions={
                <>
                  <Button size="sm" icon="download" disabled={!r.payslips.length || act.busy} onClick={() => dl(`/payroll/runs/${r.id}/register.xlsx`, `payroll-register-${r.period}.xlsx`)}>
                    Payroll register (Excel)
                  </Button>
                  <Button
                    size="sm"
                    icon="download"
                    disabled={!(r.status === 'APPROVED' || r.status === 'LOCKED') || act.busy}
                    title={r.status === 'APPROVED' || r.status === 'LOCKED' ? 'Generic CSV — the bank SLIPS layout is added when a real sample is supplied' : 'Available after approval'}
                    onClick={() => dl(`/payroll/runs/${r.id}/bank-file.csv`, `bank-transfer-${r.period}.csv`)}
                  >
                    Bank transfer file (CSV)
                  </Button>
                </>
              }
            >
              {r.payslips.length === 0 ? (
                <Empty title="No payslips yet" icon="receipt">
                  {can('payroll.run') ? 'Check the list above, then press Calculate.' : 'Payslips appear once payroll is calculated.'}
                </Empty>
              ) : (
                <>
                  <div className="filters">
                    <Input className="search" placeholder="Search name, number, designation…" value={q} onChange={(e) => setQ(e.target.value)} />
                    {q && (
                      <span className="small muted">
                        {slips.length} of {r.payslips.length}
                      </span>
                    )}
                  </div>
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>Name</th>
                          <th>Designation</th>
                          <th className="num">Basic</th>
                          <th className="num">Gross</th>
                          <th className="num">Deductions</th>
                          <th className="num">Net</th>
                          <th className="num">EPF 8%</th>
                          <th className="num">APIT</th>
                          <th className="num">No-pay days</th>
                          <th className="num">OT</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {slips.map((p) => (
                          <tr key={p.id} className="click" onClick={() => router.push(`/payslips/${p.id}`)}>
                            <td className="mono">{p.snapshot.empNo}</td>
                            <td>
                              <b>{p.snapshot.name}</b>
                            </td>
                            <td className="muted small">{p.snapshot.designation ?? '—'}</td>
                            <td className="num">{money(p.basic)}</td>
                            <td className="num">{money(p.gross)}</td>
                            <td className="num">{money(p.totalDeductions)}</td>
                            <td className="num">
                              <b>{money(p.net)}</b>
                            </td>
                            <td className="num">{money(p.epfEmployee)}</td>
                            <td className="num">{money(p.apit)}</td>
                            <td className="num">{p.noPayDays || '—'}</td>
                            <td className="num">{p.otMinutes ? dur(p.otMinutes) : '—'}</td>
                            <td>
                              {p.warnings.length > 0 && (
                                <Chip tone="warn" title={p.warnings.join('\n')}>
                                  <Icon name="alert" size={12} /> {p.warnings.length}
                                </Chip>
                              )}
                            </td>
                          </tr>
                        ))}
                        {slips.length === 0 && (
                          <tr>
                            <td colSpan={12} className="center muted">
                              No payslips match “{q}”.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      {t && (
                        <tfoot>
                          <tr>
                            <td colSpan={3}>Run totals ({t.employees})</td>
                            <td className="num">—</td>
                            <td className="num">{money(t.gross)}</td>
                            <td className="num">{money(t.deductions)}</td>
                            <td className="num">{money(t.net)}</td>
                            <td className="num">{money(t.epfEmployee)}</td>
                            <td className="num">{money(t.apit)}</td>
                            <td className="num" />
                            <td className="num" />
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              )}
            </Card>

            <Card
              title="Adjustments for this month"
              sub="Arrears, bonuses, incentives and one-off deductions"
              pad={false}
              actions={
                can('payroll.run') && open ? (
                  <Button size="sm" variant="pri" icon="edit" onClick={() => setAdding(true)}>
                    Add adjustment
                  </Button>
                ) : undefined
              }
            >
              <Async data={adjustments.data} error={adjustments.error} loading={adjustments.loading}>
                {(rows) =>
                  rows.length === 0 ? (
                    <Empty title="No adjustments" icon="sliders">
                      {open ? 'Add arrears, a bonus or a one-off deduction for someone this month.' : 'Nothing was added for this month.'}
                    </Empty>
                  ) : (
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Type</th>
                            <th>Code</th>
                            <th>Label</th>
                            <th className="num">Amount (Rs)</th>
                            <th>EPF</th>
                            <th>Taxable</th>
                            <th>Reason</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((a) => (
                            <tr key={a.id}>
                              <td>
                                <Person name={fullName(a.employee)} sub={a.employee.empNo} photoEmployeeId={a.employee.id} href={`/employees/${a.employee.id}`} />
                              </td>
                              <td>{a.kind === 'EARNING' ? <Chip tone="ok">Earning</Chip> : <Chip tone="bad">Deduction</Chip>}</td>
                              <td className="mono">{a.code}</td>
                              <td>{a.label}</td>
                              <td className="num">{money(a.amount)}</td>
                              <td>{a.epfApplicable ? 'Yes' : 'No'}</td>
                              <td>{a.taxable ? 'Yes' : 'No'}</td>
                              <td className="muted small" style={{ maxWidth: 260 }}>
                                {a.reason || '—'}
                              </td>
                              <td className="right">
                                {can('payroll.run') && open && (
                                  <Button size="xs" variant="danger" icon="trash" onClick={() => delAdj(a)}>
                                    Remove
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </Async>
              <div className="card-b tight small muted">
                {open
                  ? 'Recalculate after changing adjustments — payslips are not updated until you do.'
                  : 'This month is closed for adjustments. Add corrections to the next open month as arrears.'}
              </div>
            </Card>

            {adding && (
              <AdjustmentModal
                period={r.period}
                onClose={() => setAdding(false)}
                onSaved={() => {
                  setAdding(false);
                  toast('Adjustment added. Recalculate to update payslips.');
                  adjustments.reload();
                }}
              />
            )}
          </>
        );
      }}
    </Async>
  );
}

const CODES = [
  { value: 'ARREARS', label: 'Arrears', kind: 'EARNING' as const },
  { value: 'BONUS', label: 'Bonus', kind: 'EARNING' as const },
  { value: 'INCENTIVE', label: 'Incentive', kind: 'EARNING' as const },
  { value: 'DEDUCTION', label: 'Deduction', kind: 'DEDUCTION' as const },
  { value: 'OTHER', label: 'Other', kind: 'EARNING' as const },
  { value: '__custom', label: 'Custom code…', kind: 'EARNING' as const },
];

function AdjustmentModal({ period, onClose, onSaved }: { period: string; onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [kind, setKind] = useState<'EARNING' | 'DEDUCTION'>('EARNING');
  const [codeSel, setCodeSel] = useState('ARREARS');
  const [custom, setCustom] = useState('');
  const [labelText, setLabelText] = useState('Arrears');
  const [amount, setAmount] = useState('');
  const [epf, setEpf] = useState(false);
  const [taxable, setTaxable] = useState(true);
  const [reason, setReason] = useState('');

  const code = codeSel === '__custom' ? custom.trim().toUpperCase() : codeSel;
  const amountOk = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  const valid = !!employeeId && code.length >= 2 && code.length <= 12 && labelText.trim().length >= 2 && amountOk;

  const pickCode = (v: string) => {
    setCodeSel(v);
    const c = CODES.find((x) => x.value === v);
    if (c && v !== '__custom') {
      setKind(c.kind);
      setLabelText(c.label);
    }
  };

  const save = async () => {
    const r = await act.run(() =>
      api.post('/payroll/adjustments', {
        employeeId,
        period,
        kind,
        code,
        label: labelText.trim(),
        amount: amount.trim(),
        epfApplicable: epf,
        taxable,
        reason: reason.trim() || null,
      }),
    );
    if (r !== undefined) onSaved();
  };

  return (
    <Modal
      title={`Add adjustment — ${periodLabel(period)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!valid} onClick={save}>
            Add adjustment
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Employee" required wide>
            <EmployeePicker value={employeeId} onChange={(v) => setEmployeeId(v)} />
          </Field>
          <Field label="Code" required>
            <Select value={codeSel} onChange={(e) => pickCode(e.target.value)} options={CODES.map((c) => ({ value: c.value, label: c.label }))} />
          </Field>
          {codeSel === '__custom' && (
            <Field label="Custom code" required hint="2–12 letters or digits, e.g. TRAVEL">
              <Input value={custom} maxLength={12} onChange={(e) => setCustom(e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase())} />
            </Field>
          )}
          <Field label="Type" required>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'EARNING' | 'DEDUCTION')}
              options={[
                { value: 'EARNING', label: 'Earning (adds to pay)' },
                { value: 'DEDUCTION', label: 'Deduction (taken from pay)' },
              ]}
            />
          </Field>
          <Field label="Label on payslip" required>
            <Input value={labelText} maxLength={60} onChange={(e) => setLabelText(e.target.value)} />
          </Field>
          <Field label="Amount (Rs)" required error={amount && !amountOk ? 'Enter an amount like 12500.00' : null}>
            <Input inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {kind === 'EARNING' && (
            <div className="field wide">
              <div className="row">
                <Check checked={epf} onChange={setEpf} label="EPF applicable (counts for EPF/ETF)" />
                <Check checked={taxable} onChange={setTaxable} label="Taxable (counts for APIT)" />
              </div>
            </div>
          )}
          <Field label="Reason" wide hint="Kept with the record for audit.">
            <Textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
