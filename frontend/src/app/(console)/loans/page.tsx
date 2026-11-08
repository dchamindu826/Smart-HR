'use client';

import { Fragment, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { date, fullName, label, money, periodLabel, thisPeriod } from '@/lib/format';
import { EmployeePicker } from '@/components/pickers';
import { Icon } from '@/components/Icon';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Person, Progress, Select, StatusChip, Textarea, useUi } from '@/components/ui';

type LoanKind = 'LOAN' | 'ADVANCE' | 'FESTIVAL';
type LoanStatus = 'ACTIVE' | 'SETTLED' | 'CANCELLED';

/** GET /loans */
interface Loan {
  id: string;
  employeeId: string;
  kind: LoanKind;
  principal: string;
  installment: string;
  startPeriod: string;
  status: LoanStatus;
  note: string | null;
  createdAt: string;
  paid: string;
  outstanding: string;
  employee: { id: string; empNo: string; firstName: string; lastName: string };
  installments: { id: string; period: string; amount: string; kind: 'PAYROLL' | 'SETTLEMENT'; payslipId: string | null; createdAt: string }[];
}

const KIND_LABEL: Record<LoanKind, string> = { LOAN: 'Staff loan', ADVANCE: 'Salary advance', FESTIVAL: 'Festival advance' };
const MONEY_RE = /^\d+(\.\d{1,2})?$/;

export default function LoansPage() {
  const { can, has } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState<string>('ACTIVE');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const enabled = has('loans');
  const { data, error, loading, reload } = useApi<Loan[]>(enabled ? '/loans' : null, { status, employeeId });
  const canManage = can('loan.manage');

  const changeInstalment = async (l: Loan) => {
    const v = await confirm({ title: 'Change monthly instalment', body: `Now Rs ${money(l.installment)}. Outstanding Rs ${money(l.outstanding)}. The new amount applies from the next payroll calculation.`, input: { label: 'New instalment (Rs)', placeholder: 'e.g. 5000.00', minLength: 1 }, ok: 'Change' });
    if (v === false) return;
    const amt = v.replace(/,/g, '').trim();
    if (!MONEY_RE.test(amt) || Number(amt) <= 0) {
      toast('Enter an amount like 5000.00.', 'bad');
      return;
    }
    const r = await act.run(() => api.patch(`/loans/${l.id}`, { installment: amt }));
    if (r !== undefined) {
      toast('Instalment changed.');
      reload();
    }
  };

  const settle = async (l: Loan) => {
    if ((await confirm({ title: 'Settle this loan?', body: `${fullName(l.employee)} pays the outstanding Rs ${money(l.outstanding)} in cash now. It is recorded as a settlement and no more instalments are deducted.`, ok: 'Mark settled' })) === false) return;
    const r = await act.run(() => api.post<{ settled: string }>(`/loans/${l.id}/settle`, {}));
    if (r !== undefined) {
      toast(`Settled. Rs ${money(r.settled)} recorded.`);
      reload();
    }
  };

  const cancel = async (l: Loan) => {
    if ((await confirm({ title: 'Cancel this loan?', body: 'Nothing has been deducted yet, so the loan is simply cancelled.', ok: 'Cancel loan', danger: true })) === false) return;
    const r = await act.run(() => api.patch(`/loans/${l.id}`, { status: 'CANCELLED' }));
    if (r !== undefined) {
      toast('Loan cancelled.');
      reload();
    }
  };

  if (!enabled) {
    return (
      <>
        <PageHeader title="Loans & advances" />
        <Card>
          <Empty title="Loans are not in your plan" icon="loan">
            Upgrade your plan to record staff loans and salary advances that are deducted through payroll.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Loans & advances"
        sub="Instalments are deducted in payroll each month from the start month, and recorded when the payroll is locked."
        actions={
          canManage && (
            <Button variant="pri" icon="loan" onClick={() => setCreating(true)}>
              New loan or advance
            </Button>
          )
        }
      />
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <div className="filters">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'SETTLED', label: 'Settled' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <div style={{ minWidth: 260 }}>
            <EmployeePicker value={employeeId} onChange={(v) => setEmployeeId(v)} placeholder="Any employee" />
          </div>
        </div>
        <Async data={data} error={error} loading={loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No loans here" icon="loan">
                {status === 'ACTIVE' ? 'No active loans or advances.' : 'Nothing matches these filters.'}
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }} />
                      <th>Employee</th>
                      <th>Kind</th>
                      <th className="num">Principal (Rs)</th>
                      <th className="num">Instalment</th>
                      <th className="num">Paid</th>
                      <th className="num">Outstanding</th>
                      <th style={{ minWidth: 110 }}>Progress</th>
                      <th>Starts</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => {
                      const isOpen = open === l.id;
                      return (
                        <Fragment key={l.id}>
                          <tr className="click" onClick={() => setOpen(isOpen ? null : l.id)}>
                            <td>
                              <Icon name={isOpen ? 'chev-d' : 'chev-r'} size={14} />
                            </td>
                            <td>
                              <Person name={fullName(l.employee)} sub={l.employee.empNo} photoEmployeeId={l.employee.id} />
                            </td>
                            <td>{KIND_LABEL[l.kind] ?? label(l.kind)}</td>
                            <td className="num">{money(l.principal)}</td>
                            <td className="num">{money(l.installment)}</td>
                            <td className="num">{money(l.paid)}</td>
                            <td className="num">
                              <b>{money(l.outstanding)}</b>
                            </td>
                            <td>
                              <Progress value={Number(l.paid)} max={Number(l.principal)} tone={l.status === 'SETTLED' ? 'ok' : undefined} />
                            </td>
                            <td className="nowrap">{periodLabel(l.startPeriod)}</td>
                            <td>
                              <StatusChip status={l.status} />
                            </td>
                            <td className="nowrap right" onClick={(e) => e.stopPropagation()}>
                              {canManage && l.status === 'ACTIVE' && (
                                <>
                                  <Button size="xs" onClick={() => changeInstalment(l)} disabled={act.busy}>
                                    Change instalment
                                  </Button>{' '}
                                  <Button size="xs" variant="ok" onClick={() => settle(l)} disabled={act.busy}>
                                    Settle
                                  </Button>
                                  {l.installments.length === 0 && (
                                    <>
                                      {' '}
                                      <Button size="xs" variant="danger" onClick={() => cancel(l)} disabled={act.busy}>
                                        Cancel
                                      </Button>
                                    </>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td />
                              <td colSpan={10} style={{ background: 'var(--card-2)' }}>
                                <div className="stack tight">
                                  {l.note && (
                                    <div className="small">
                                      <span className="muted">Note:</span> {l.note}
                                    </div>
                                  )}
                                  <div className="small muted">Created {date(l.createdAt)}</div>
                                  {l.installments.length === 0 ? (
                                    <div className="small muted">No instalments yet. The first is deducted in the {periodLabel(l.startPeriod)} payroll.</div>
                                  ) : (
                                    <table className="tbl" style={{ maxWidth: 480, background: 'var(--card)' }}>
                                      <thead>
                                        <tr>
                                          <th>Month</th>
                                          <th>How</th>
                                          <th className="num">Amount (Rs)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {l.installments.map((i) => (
                                          <tr key={i.id}>
                                            <td>{periodLabel(i.period)}</td>
                                            <td>{i.kind === 'SETTLEMENT' ? <Chip tone="ok">Cash settlement</Chip> : <Chip tone="info">Payroll</Chip>}</td>
                                            <td className="num">{money(i.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>

      {creating && (
        <LoanModal
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            toast('Loan recorded.');
            reload();
          }}
        />
      )}
    </>
  );
}

function LoanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [kind, setKind] = useState<LoanKind>('LOAN');
  const [principal, setPrincipal] = useState('');
  const [installment, setInstallment] = useState('');
  const [startPeriod, setStartPeriod] = useState(thisPeriod());
  const [note, setNote] = useState('');

  const p = principal.replace(/,/g, '').trim();
  const i = installment.replace(/,/g, '').trim();
  const pOk = MONEY_RE.test(p) && Number(p) > 0;
  const iOk = MONEY_RE.test(i) && Number(i) > 0 && (!pOk || Number(i) <= Number(p));
  const months = pOk && iOk ? Math.ceil(Number(p) / Number(i)) : null;
  const valid = !!employeeId && pOk && iOk && /^\d{4}-\d{2}$/.test(startPeriod);

  const save = async () => {
    const r = await act.run(() => api.post('/loans', { employeeId, kind, principal: p, installment: i, startPeriod, note: note.trim() || null }));
    if (r !== undefined) onSaved();
  };

  return (
    <Modal
      title="New loan or advance"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!valid} onClick={save}>
            Record loan
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Employee" required wide>
            <EmployeePicker value={employeeId} onChange={(v) => setEmployeeId(v)} status="ACTIVE" />
          </Field>
          <Field label="Kind" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as LoanKind)} options={(Object.keys(KIND_LABEL) as LoanKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          </Field>
          <Field label="First deduction" required hint="The payroll month of the first instalment.">
            <Input type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} />
          </Field>
          <Field label="Amount given (Rs)" required error={principal && !pOk ? 'Enter an amount like 50000.00' : null}>
            <Input inputMode="decimal" value={principal} placeholder="0.00" onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="Monthly instalment (Rs)" required error={installment && !iOk ? (pOk && MONEY_RE.test(i) ? 'Cannot be more than the amount given' : 'Enter an amount like 5000.00') : null} hint={months ? `About ${months} month${months === 1 ? '' : 's'} to repay` : undefined}>
            <Input inputMode="decimal" value={installment} placeholder="0.00" onChange={(e) => setInstallment(e.target.value)} />
          </Field>
          <Field label="Note" wide>
            <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Purpose, approval reference…" />
          </Field>
        </div>
        <p className="small muted">The last instalment is reduced to whatever is left. No interest is charged.</p>
      </div>
    </Modal>
  );
}
