'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { date, money, periodLabel, thisPeriod } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, LinkButton, Modal, PageHeader, StatusChip, useUi } from '@/components/ui';

type RunStatus = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'LOCKED';

interface RunTotals {
  employees?: number;
  gross?: string;
  deductions?: string;
  net?: string;
  warnings?: number;
}

/** GET /payroll/runs */
interface RunRow {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  calculatedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  releasedAt: string | null;
  totals: RunTotals | null;
  _count: { payslips: number };
}

/** POST /payroll/runs returns the run (or the existing one for that month). */
interface CreatedRun {
  id: string;
  period: string;
}

export default function PayrollPage() {
  const { can, has } = useAuth();
  const router = useRouter();
  const { toast } = useUi();
  const { data, error, loading } = useApi<RunRow[]>('/payroll/runs');
  const [start, setStart] = useState(false);
  const [period, setPeriod] = useState(thisPeriod());
  const act = useAction();

  const create = async () => {
    const r = await act.run(() => api.post<CreatedRun>('/payroll/runs', { period }));
    if (r !== undefined) {
      toast(`Payroll for ${periodLabel(r.period)} is open.`);
      router.push(`/payroll/${r.id}`);
    }
  };

  return (
    <>
      <PageHeader
        title="Payroll"
        sub="Each month: start → calculate → check → approve → lock → release payslips. A locked month is final; corrections go into the next month as arrears."
        actions={
          <>
            {(can('employee.pay.edit') || can('payslip.template')) && (
              <LinkButton href="/settings/pay" icon="receipt">
                Pay components &amp; payslip
              </LinkButton>
            )}
            {has('loans') && <LinkButton href="/loans" icon="loan">Loans</LinkButton>}
            {can('returns.file') && <LinkButton href="/returns" icon="file">Returns</LinkButton>}
            {can('payroll.run') && (
              <Button variant="pri" icon="money" onClick={() => setStart(true)}>
                Start payroll
              </Button>
            )}
          </>
        }
      />

      <Async data={data} error={error} loading={loading}>
        {(runs) => (
          <Card pad={false}>
            {runs.length === 0 ? (
              <Empty
                title="No payroll runs yet"
                icon="money"
                action={
                  can('payroll.run') ? (
                    <Button variant="pri" onClick={() => setStart(true)}>
                      Start the first payroll
                    </Button>
                  ) : undefined
                }
              >
                Start a month to calculate salaries from attendance, leave, overtime and loans.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Status</th>
                      <th className="num">Payslips</th>
                      <th className="num">Gross (Rs)</th>
                      <th className="num">Net (Rs)</th>
                      <th>Calculated</th>
                      <th>Approved</th>
                      <th>Locked</th>
                      <th>Employees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="click" onClick={() => router.push(`/payroll/${r.id}`)}>
                        <td>
                          <b>{periodLabel(r.period)}</b>
                          <div className="tiny faint">
                            {date(r.periodStart, { year: false })} – {date(r.periodEnd)}
                          </div>
                        </td>
                        <td>
                          <StatusChip status={r.status} />
                          {r.totals?.warnings ? (
                            <>
                              {' '}
                              <Chip tone="warn" title="Payslips with warnings">
                                {r.totals.warnings} warning{r.totals.warnings === 1 ? '' : 's'}
                              </Chip>
                            </>
                          ) : null}
                        </td>
                        <td className="num">{r._count.payslips}</td>
                        <td className="num">{r.totals?.gross ? money(r.totals.gross) : '—'}</td>
                        <td className="num">
                          <b>{r.totals?.net ? money(r.totals.net) : '—'}</b>
                        </td>
                        <td className="nowrap small">{date(r.calculatedAt)}</td>
                        <td className="nowrap small">{date(r.approvedAt)}</td>
                        <td className="nowrap small">{date(r.lockedAt)}</td>
                        <td>{r.releasedAt ? <Chip tone="ok">Released {date(r.releasedAt, { year: false })}</Chip> : r.status === 'LOCKED' ? <Chip tone="warn">Not released</Chip> : <span className="faint small">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </Async>

      {start && (
        <Modal
          title="Start payroll"
          size="narrow"
          onClose={() => setStart(false)}
          footer={
            <>
              <Button onClick={() => setStart(false)}>Cancel</Button>
              <Button variant="pri" busy={act.busy} disabled={!/^\d{4}-\d{2}$/.test(period)} onClick={create}>
                Start {/^\d{4}-\d{2}$/.test(period) ? periodLabel(period) : ''}
              </Button>
            </>
          }
        >
          <div className="stack">
            <ErrorBox error={act.error} />
            <Field label="Month" required hint="If this month is already started, you are taken to it.">
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
            <p className="muted small">The run starts as a draft. Nothing is calculated or shown to employees until you choose to.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
