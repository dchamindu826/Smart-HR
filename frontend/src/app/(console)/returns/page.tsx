'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, download } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, dateTime, money, periodLabel, shiftPeriod, thisPeriod, today } from '@/lib/format';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Input, LinkButton, PageHeader, StatusChip, useUi } from '@/components/ui';

type ReturnType = 'EPF_C_FORM' | 'ETF_R4' | 'APIT_T10' | 'BANK_SLIPS';

interface Filing {
  id: string;
  type: ReturnType;
  period: string;
  status: 'PREPARED' | 'FILED';
  reference: string | null;
  filedAt: string | null;
}

interface ReturnItem {
  type: ReturnType;
  name: string;
  members: number;
  base?: string;
  employee?: string;
  employer?: string;
  total: string;
  dueBy?: string;
  filing: Filing | null;
  formatStatus: string;
}

/** GET /returns?period */
interface Returns {
  period: string;
  ready: boolean;
  message?: string;
  run: { id: string; status: string } | null;
  missing?: string[];
  warnings?: string[];
  returns: ReturnItem[];
  filings?: Filing[];
}

export default function ReturnsPage() {
  const [period, setPeriod] = useState(shiftPeriod(thisPeriod(), -1));
  const valid = /^\d{4}-\d{2}$/.test(period);
  const { data, error, loading, reload } = useApi<Returns>(valid ? '/returns' : null, { period });
  const act = useAction();
  const { toast, confirm } = useUi();

  const markFiled = async (r: ReturnItem) => {
    const ref = await confirm({
      title: `Mark ${r.name} as filed?`,
      body: `${periodLabel(period)} · Rs ${money(r.total)}. Enter the reference you got when you filed or paid (receipt, slip or confirmation number).`,
      input: { label: 'Reference number', placeholder: 'e.g. EPF/2026/10/12345', minLength: 2 },
      ok: 'Mark as filed',
    });
    if (ref === false) return;
    const ok = await act.run(() => api.post(`/returns/${period}/${r.type}/filed`, { reference: ref }));
    if (ok !== undefined) {
      toast(`${r.name} marked as filed.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Statutory returns"
        sub="EPF, ETF, APIT and the bank salary transfer, built from the locked payroll."
        actions={
          <div className="row tight">
            <Button size="sm" icon="chev-l" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))} disabled={!valid} />
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 170 }} />
            <Button size="sm" icon="chev-r" aria-label="Next month" onClick={() => setPeriod(shiftPeriod(period, 1))} disabled={!valid} />
          </div>
        }
      />
      <div style={{ marginBottom: 14 }}>
        <Alert tone="info">
          The official file layouts (EPF C-Form, ETF R-4, APIT T-10, bank SLIPS) are added once a real filed sample is supplied. Until then, use the totals below and the generic CSV to fill in the
          official forms or the bank&apos;s upload.
        </Alert>
      </div>
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(d) =>
          !d.ready ? (
            <Card>
              <Empty
                title={`${periodLabel(d.period)} is not ready`}
                icon="file"
                action={
                  d.run ? (
                    <LinkButton href={`/payroll/${d.run.id}`} variant="pri">
                      Open {periodLabel(d.period)} payroll
                    </LinkButton>
                  ) : (
                    <LinkButton href="/payroll" variant="pri">
                      Go to payroll
                    </LinkButton>
                  )
                }
              >
                {d.message ?? 'Lock the payroll for this month first.'}
                {d.run && (
                  <>
                    {' '}
                    The run is <StatusChip status={d.run.status} />.
                  </>
                )}
              </Empty>
            </Card>
          ) : (
            <>
              {d.missing && d.missing.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <Alert tone="warn">
                    Your company profile is missing: {d.missing.join(', ')}. The returns need them. <Link href="/settings/company">Add them in Company &amp; logo</Link>.
                  </Alert>
                </div>
              )}
              {d.warnings && d.warnings.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <Alert tone="warn">
                    <ul>
                      {d.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              )}
              <div className="grid2">
                {d.returns.map((r) => (
                  <div key={r.type}>
                  <ReturnCard r={r} period={d.period} busy={act.busy} onDownload={() => act.run(() => download(`/returns/${d.period}/${r.type}.csv`, undefined, `${r.type.toLowerCase()}-${d.period}.csv`))} onFiled={() => markFiled(r)} />
                  </div>
                ))}
              </div>
              {d.run && (
                <p className="small muted" style={{ marginTop: 14 }}>
                  Figures come from the locked <Link href={`/payroll/${d.run.id}`}>{periodLabel(d.period)} payroll</Link>. Due dates are as commonly applied — verify with the EPF, ETF and Inland Revenue departments.
                </p>
              )}
            </>
          )
        }
      </Async>
    </>
  );
}

function ReturnCard({ r, period, busy, onDownload, onFiled }: { r: ReturnItem; period: string; busy: boolean; onDownload: () => void; onFiled: () => void }) {
  const filed = r.filing?.status === 'FILED';
  const sample = r.formatStatus === 'sample needed';
  const overdue = !filed && r.dueBy && r.dueBy < today();
  const lines: [string, string][] = [];
  if (r.base !== undefined) lines.push(['Earnings for EPF/ETF', r.base]);
  if (r.employee !== undefined) lines.push(['Employee 8%', r.employee]);
  if (r.employer !== undefined) lines.push(['Employer 12%', r.employer]);
  return (
    <Card
      title={r.name}
      actions={filed ? <Chip tone="ok">Filed</Chip> : overdue ? <Chip tone="bad">Overdue</Chip> : <Chip tone="warn">Not filed</Chip>}
      footer={
        <>
          <Button size="sm" icon="download" disabled={busy} onClick={onDownload}>
            Download CSV
          </Button>
          <Button size="sm" variant={filed ? '' : 'pri'} icon="check" disabled={busy} onClick={onFiled}>
            {filed ? 'Update reference' : 'Mark as filed'}
          </Button>
        </>
      }
    >
      <div className="stack tight">
        <div className="row tight">
          <Chip tone={sample ? 'warn' : 'info'} title={sample ? 'The official layout is added when a real filed sample is supplied.' : 'A plain CSV with one row per employee.'}>
            {sample ? 'Official format: sample needed' : 'Generic CSV'}
          </Chip>
          <span className="small muted">
            {r.members} {r.members === 1 ? 'person' : 'people'} · {periodLabel(period)}
          </span>
        </div>
        <dl className="kv">
          {lines.map(([k, v]) => (
            <Pair key={k} k={k} v={`Rs ${money(v)}`} />
          ))}
          <dt>
            <b>Total</b>
          </dt>
          <dd style={{ fontSize: 17, fontWeight: 700 }}>Rs {money(r.total)}</dd>
          {r.dueBy && <Pair k="Due by" v={date(r.dueBy)} />}
          {filed && r.filing && (
            <>
              <Pair k="Reference" v={r.filing.reference ?? '—'} />
              <Pair k="Filed" v={dateTime(r.filing.filedAt)} />
            </>
          )}
        </dl>
      </div>
    </Card>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
