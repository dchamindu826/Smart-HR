'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, money, periodLabel, shiftPeriod, thisPeriod } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, StatusChip, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { roleCan, type TenantList } from '../_admin';

type InvoiceStatus = 'DUE' | 'PAID' | 'VOID';
interface InvoiceRow {
  id: string;
  tenantId: string;
  tenant: { id: string; name: string; slug: string };
  number: string;
  periodStart: string;
  periodEnd: string;
  planCode: string;
  employees: number;
  amount: string;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

/** Sum money strings in whole cents (display only). */
function sumCents(rows: InvoiceRow[]): string {
  const c = rows.reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  return (c / 100).toFixed(2);
}

export default function InvoicesPage() {
  const me = useAdmin();
  const sp = useSearchParams();
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [period, setPeriod] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [generating, setGenerating] = useState(false);
  const { data, error, loading, reload } = useApi<InvoiceRow[]>('/platform/invoices', { status, period, tenantId });
  const tenants = useApi<TenantList>('/platform/tenants', { pageSize: 200, demo: 'false' });
  const isAdmin = roleCan(me.role, 'ADMIN');

  const setInv = async (inv: InvoiceRow, s: InvoiceStatus) => {
    let reference: string | undefined;
    if (s === 'PAID') {
      const r = await confirm({ title: `Mark ${inv.number} paid?`, body: `${inv.tenant.name} · Rs ${money(inv.amount)}`, input: { label: 'Payment reference (bank slip, cheque or transfer number)', minLength: 2 }, ok: 'Mark paid' });
      if (r === false) return;
      reference = r;
    } else if (s === 'VOID') {
      if ((await confirm({ title: `Void ${inv.number}?`, body: `${inv.tenant.name} · Rs ${money(inv.amount)}. A void invoice is not counted as due. Generating the month again does not make a new one.`, ok: 'Void invoice', danger: true })) === false) return;
    } else if ((await confirm({ title: `Mark ${inv.number} due again?`, body: 'The paid date is cleared.', ok: 'Mark due' })) === false) return;
    const r = await act.run(() => api.post(`/platform/invoices/${inv.id}/status`, { status: s, reference }));
    if (r !== undefined) {
      toast(`${inv.number} marked ${s === 'PAID' ? 'paid' : s === 'VOID' ? 'void' : 'due'}.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        sub="Monthly invoices for active, non-demo companies, including terminal fees."
        actions={
          isAdmin && (
            <Button variant="pri" icon="receipt" onClick={() => setGenerating(true)}>
              Generate invoices for a month
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
              { value: 'DUE', label: 'Due' },
              { value: 'PAID', label: 'Paid' },
              { value: 'VOID', label: 'Void' },
            ]}
          />
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month" />
          {period && (
            <Button size="sm" variant="ghost" onClick={() => setPeriod('')}>
              All months
            </Button>
          )}
          <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="All companies" options={(tenants.data?.rows ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          {data && data.length >= 500 && <span className="small warn-t">Showing the latest 500. Filter to see more.</span>}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No invoices" icon="receipt">
                {status || period || tenantId ? 'Nothing matches these filters.' : 'Generate invoices for a month to start.'}
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Company</th>
                      <th>Period</th>
                      <th>Plan</th>
                      <th className="num">Employees</th>
                      <th className="num">Amount (Rs)</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th>Paid · reference</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((inv) => {
                      const overdue = inv.status === 'DUE' && inv.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
                      return (
                        <tr key={inv.id}>
                          <td className="mono nowrap">{inv.number}</td>
                          <td>
                            <Link href={`/admin/tenants/${inv.tenant.id}`}>{inv.tenant.name}</Link>
                          </td>
                          <td className="nowrap">{periodLabel(inv.periodStart.slice(0, 7))}</td>
                          <td>{inv.planCode}</td>
                          <td className="num">{inv.employees}</td>
                          <td className="num">{money(inv.amount)}</td>
                          <td className="nowrap">{date(inv.dueDate.slice(0, 10))}</td>
                          <td className="nowrap">
                            <StatusChip status={inv.status} /> {overdue && <Chip tone="bad">Overdue</Chip>}
                          </td>
                          <td className="small">
                            {inv.paidAt ? date(inv.paidAt) : '—'}
                            {inv.reference && <div className="muted">{inv.reference}</div>}
                          </td>
                          <td className="nowrap right">
                            {isAdmin && inv.status === 'DUE' && (
                              <>
                                <Button size="xs" variant="ok" disabled={act.busy} onClick={() => setInv(inv, 'PAID')}>
                                  Mark paid
                                </Button>{' '}
                                <Button size="xs" variant="danger" disabled={act.busy} onClick={() => setInv(inv, 'VOID')}>
                                  Void
                                </Button>
                              </>
                            )}
                            {isAdmin && inv.status !== 'DUE' && (
                              <Button size="xs" disabled={act.busy} onClick={() => setInv(inv, 'DUE')}>
                                Mark due
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>{rows.length} invoice(s)</td>
                      <td className="num">{money(sumCents(rows.filter((r) => r.status !== 'VOID')))}</td>
                      <td colSpan={4} className="small" style={{ fontWeight: 500 }}>
                        Due Rs {money(sumCents(rows.filter((r) => r.status === 'DUE')))} · Paid Rs {money(sumCents(rows.filter((r) => r.status === 'PAID')))} · void not counted
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          }
        </Async>
      </Card>
      {generating && (
        <GenerateModal
          onClose={() => setGenerating(false)}
          onDone={(p, created) => {
            setGenerating(false);
            toast(created === 0 ? `No new invoices — every company already has one for ${periodLabel(p)}.` : `${created} invoice(s) made for ${periodLabel(p)}.`);
            setPeriod(p);
            reload();
          }}
        />
      )}
    </>
  );
}

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: (period: string, created: number) => void }) {
  const act = useAction();
  const [period, setPeriod] = useState(thisPeriod());
  const go = async () => {
    const r = await act.run(() => api.post<{ created: number }>('/platform/invoices/generate', { period }));
    if (r !== undefined) onDone(period, r.created);
  };
  return (
    <Modal
      title="Generate invoices"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!/^\d{4}-\d{2}$/.test(period)} onClick={go}>
            Generate for {/^\d{4}-\d{2}$/.test(period) ? periodLabel(period) : '…'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <Field label="Month">
          <div className="row tight" style={{ flexWrap: 'nowrap' }}>
            <Button size="sm" icon="chev-l" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))} />
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            <Button size="sm" icon="chev-r" aria-label="Next month" onClick={() => setPeriod(shiftPeriod(period, 1))} />
          </div>
        </Field>
        <ul className="small muted" style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
          <li>One invoice per active, non-demo company. Trial, suspended and cancelled companies are skipped.</li>
          <li>The amount is the company&apos;s monthly price (custom price or plan, less any discount) plus the fees of terminals allocated to it.</li>
          <li>Due 14 days after the first of the month.</li>
          <li>Safe to run twice: a company that already has an invoice for the month is skipped.</li>
        </ul>
      </div>
    </Modal>
  );
}
