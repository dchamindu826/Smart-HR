'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { ago, date, dateTime, label, money, periodLabel } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Seg, Select, StatusChip, Textarea, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { CopyBox, daysLeft, isoToDate, moneyInput, roleCan, type PlansResp, type TenantStatus } from '../../_admin';

interface Invoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  planCode: string;
  employees: number;
  amount: string;
  status: 'DUE' | 'PAID' | 'VOID';
  dueDate: string;
  paidAt: string | null;
  reference: string | null;
}

interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  planId: string;
  isDemo: boolean;
  demoExpiresAt: string | null;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
  billingCycle: 'MONTHLY' | 'YEARLY';
  customPrice: string | null;
  discountPct: string | null;
  monthlyAmount: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  industry: string | null;
  createdAt: string;
  plan: { id: string; code: string; name: string; priceMonthly: string; priceYearly: string | null; maxEmployees: number; features: string[] };
  branches: { id: string; code: string; name: string }[];
  terminals: { id: string; serialNo: string; model: string; name: string | null; status: string; branchId: string | null; lastSeenAt: string | null; monthlyFee: string | null; allocatedAt: string | null }[];
  invoices: Invoice[];
  users: { id: string; name: string; email: string | null; phone: string | null; role: string; lastLoginAt: string | null; active: boolean }[];
  usage: { employees: number; users: number; punches30: number; lastPayroll: { period: string; status: string } | null };
}

interface SupportStart {
  ok: boolean;
  expiresAt: string;
  sessionId: string;
  url: string;
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useAdmin();
  const { toast, confirm } = useUi();
  const act = useAction();
  const { data, error, loading, reload } = useApi<TenantDetail>(`/platform/tenants/${id}`);
  const plans = useApi<PlansResp>('/platform/plans');
  const [editPlan, setEditPlan] = useState(false);
  const [editBiz, setEditBiz] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [support, setSupport] = useState<SupportStart | null>(null);
  const [tempPw, setTempPw] = useState<{ name: string; email: string | null; password: string } | null>(null);

  const isAdmin = roleCan(me.role, 'ADMIN');
  const canSupport = roleCan(me.role, 'ADMIN', 'SUPPORT');

  const setStatus = async (t: TenantDetail, status: TenantStatus) => {
    let reason: string | undefined;
    if (status === 'SUSPENDED') {
      const r = await confirm({ title: `Suspend ${t.name}?`, body: 'Nobody in the company can log in until you activate it again. Data is kept.', input: { label: 'Reason (kept in the audit log)', minLength: 5 }, ok: 'Suspend', danger: true });
      if (r === false) return;
      reason = r;
    } else if (status === 'CANCELLED') {
      if ((await confirm({ title: `Cancel ${t.name}?`, body: 'The company is closed and nobody can log in. No more invoices are made. Data is kept and you can activate it again later.', ok: 'Cancel company', danger: true })) === false) return;
    } else if (status === 'ACTIVE') {
      const body = t.isDemo ? 'This demo becomes a paying account and keeps its sample data. To remove the sample data, use "Convert demo" instead.' : 'The company can log in and is invoiced every month.';
      if ((await confirm({ title: `Activate ${t.name}?`, body, ok: 'Activate' })) === false) return;
    }
    const r = await act.run(() => api.post(`/platform/tenants/${t.id}/status`, { status, reason }));
    if (r !== undefined) {
      toast(`${t.name} is now ${label(status).toLowerCase()}.`);
      reload();
    }
  };

  const convert = async (t: TenantDetail) => {
    if ((await confirm({ title: 'Convert to a real account?', body: 'All sample employees, attendance, roster, leave and assets are removed. Settings stay. The company starts a 14-day trial.', ok: 'Convert', danger: true })) === false) return;
    const r = await act.run(() => api.post(`/platform/tenants/${t.id}/convert-demo`));
    if (r !== undefined) {
      toast('Demo converted. A 14-day trial has started.');
      reload();
    }
  };

  const resetPw = async (u: TenantDetail['users'][number]) => {
    if ((await confirm({ title: `Reset password for ${u.name}?`, body: 'Their current password stops working and they are logged out everywhere. They must set a new one at the next login.', ok: 'Reset password', danger: true })) === false) return;
    const r = await act.run(() => api.post<{ tempPassword: string }>(`/platform/tenants/${id}/users/${u.id}/reset-password`));
    if (r !== undefined) setTempPw({ name: u.name, email: u.email, password: r.tempPassword });
  };

  const invoiceStatus = async (inv: Invoice, status: Invoice['status']) => {
    let reference: string | undefined;
    if (status === 'PAID') {
      const r = await confirm({ title: `Mark ${inv.number} paid?`, body: `Rs ${money(inv.amount)}`, input: { label: 'Payment reference (bank slip, cheque or transfer number)', minLength: 2 }, ok: 'Mark paid' });
      if (r === false) return;
      reference = r;
    } else if (status === 'VOID') {
      if ((await confirm({ title: `Void ${inv.number}?`, body: 'The invoice no longer counts as due.', ok: 'Void', danger: true })) === false) return;
    }
    const r = await act.run(() => api.post(`/platform/invoices/${inv.id}/status`, { status, reference }));
    if (r !== undefined) {
      toast(`${inv.number} marked ${label(status).toLowerCase()}.`);
      reload();
    }
  };

  const endSupport = async () => {
    if (!support) return;
    const r = await act.run(() => api.post(`/platform/support/${support.sessionId}/end`));
    if (r !== undefined) {
      toast('Support session ended.');
      setSupport(null);
    }
  };

  return (
    <Async data={data} error={error} loading={loading}>
      {(t) => {
        const trialLeft = daysLeft(t.trialEndsAt);
        const demoLeft = daysLeft(t.demoExpiresAt);
        const branchName = (bid: string | null) => t.branches.find((b) => b.id === bid)?.name ?? '—';
        return (
          <>
            <PageHeader
              crumbs={[{ href: '/admin/tenants', label: 'Companies' }]}
              title={
                <span className="row" style={{ gap: 8 }}>
                  {t.name} <StatusChip status={t.status} /> {t.isDemo && <Chip tone="mag">Demo</Chip>}
                </span>
              }
              sub={
                <>
                  Code <span className="mono">{t.slug}</span> · created {date(t.createdAt)}
                  {t.status === 'TRIAL' && t.trialEndsAt && <> · trial ends {date(t.trialEndsAt)}{trialLeft !== null && trialLeft >= 0 ? ` (${trialLeft} d)` : ' (ended)'}</>}
                  {t.isDemo && t.demoExpiresAt && <> · demo expires {date(t.demoExpiresAt)}{demoLeft !== null && demoLeft >= 0 ? ` (${demoLeft} d)` : ' (expired)'}</>}
                </>
              }
              actions={
                <>
                  {canSupport && (
                    <Button icon="eye" onClick={() => setSupportOpen(true)}>
                      Open support view
                    </Button>
                  )}
                  {isAdmin && t.isDemo && (
                    <Button icon="flask" busy={act.busy} onClick={() => convert(t)}>
                      Convert demo
                    </Button>
                  )}
                  {isAdmin && t.status !== 'ACTIVE' && (
                    <Button variant="ok" busy={act.busy} onClick={() => setStatus(t, 'ACTIVE')}>
                      Activate
                    </Button>
                  )}
                  {isAdmin && t.status !== 'SUSPENDED' && t.status !== 'CANCELLED' && (
                    <Button variant="danger" onClick={() => setStatus(t, 'SUSPENDED')}>
                      Suspend
                    </Button>
                  )}
                  {isAdmin && t.status !== 'CANCELLED' && (
                    <Button variant="danger" onClick={() => setStatus(t, 'CANCELLED')}>
                      Cancel
                    </Button>
                  )}
                </>
              }
            />
            <div className="stack">
              <ErrorBox error={act.error} />
              {t.status === 'SUSPENDED' && (
                <div className="alert bad">
                  Suspended {t.suspendedAt ? dateTime(t.suspendedAt) : ''}
                  {t.suspendReason ? ` — ${t.suspendReason}` : ''}
                </div>
              )}
              {support && (
                <div className="alert info" style={{ alignItems: 'center' }}>
                  <div className="grow">
                    Support session <span className="mono">{support.sessionId}</span> is open until {dateTime(support.expiresAt)}. Everything you do is written to the company&apos;s audit log.{' '}
                    <a href={support.url} target="_blank" rel="noreferrer">
                      Open the company console
                    </a>
                  </div>
                  <Button size="sm" variant="danger" busy={act.busy} onClick={endSupport}>
                    End support session
                  </Button>
                </div>
              )}

              <div className="grid2">
                <Card
                  title="Plan & billing"
                  actions={
                    isAdmin && (
                      <Button size="sm" icon="edit" onClick={() => setEditPlan(true)}>
                        Edit
                      </Button>
                    )
                  }
                >
                  <dl className="kv">
                    <dt>Plan</dt>
                    <dd>
                      {t.plan.name} <span className="muted small">· up to {t.plan.maxEmployees} employees</span>
                    </dd>
                    <dt>Plan price</dt>
                    <dd>
                      Rs {money(t.plan.priceMonthly)} a month
                      {t.plan.priceYearly && <span className="muted small"> · Rs {money(t.plan.priceYearly)} a year</span>}
                    </dd>
                    <dt>Billing cycle</dt>
                    <dd>{label(t.billingCycle)}</dd>
                    <dt>Custom price</dt>
                    <dd>{t.customPrice ? `Rs ${money(t.customPrice)} a month` : <span className="muted">None — plan price</span>}</dd>
                    <dt>Discount</dt>
                    <dd>{t.discountPct ? `${Number(t.discountPct)}%` : <span className="muted">None</span>}</dd>
                    <dt>Monthly amount</dt>
                    <dd>
                      <b>Rs {money(t.monthlyAmount)}</b> <span className="muted small">before terminal fees</span>
                    </dd>
                    <dt>Trial ends</dt>
                    <dd>{t.trialEndsAt ? date(t.trialEndsAt) : '—'}</dd>
                    {t.isDemo && (
                      <>
                        <dt>Demo expires</dt>
                        <dd>{t.demoExpiresAt ? date(t.demoExpiresAt) : '—'}</dd>
                      </>
                    )}
                  </dl>
                </Card>

                <Card
                  title="Business details"
                  actions={
                    isAdmin && (
                      <Button size="sm" icon="edit" onClick={() => setEditBiz(true)}>
                        Edit
                      </Button>
                    )
                  }
                >
                  <dl className="kv">
                    <dt>Name</dt>
                    <dd>{t.name}</dd>
                    <dt>Contact</dt>
                    <dd>{t.contactName ?? '—'}</dd>
                    <dt>Email</dt>
                    <dd>{t.email ? <a href={`mailto:${t.email}`}>{t.email}</a> : '—'}</dd>
                    <dt>Phone</dt>
                    <dd>{t.phone ?? '—'}</dd>
                    <dt>Address</dt>
                    <dd style={{ whiteSpace: 'pre-wrap' }}>{t.address ?? '—'}</dd>
                    <dt>Industry</dt>
                    <dd>{t.industry ?? '—'}</dd>
                  </dl>
                </Card>
              </div>

              <div className="stats" style={{ marginBottom: 0 }}>
                <div className={`stat ${t.usage.employees >= t.plan.maxEmployees ? 'bad' : ''}`}>
                  <span>Active employees</span>
                  <b>
                    {t.usage.employees}
                    <span className="muted" style={{ fontSize: 15 }}>
                      {' '}
                      / {t.plan.maxEmployees}
                    </span>
                  </b>
                </div>
                <div className="stat">
                  <span>Logins</span>
                  <b>{t.usage.users}</b>
                </div>
                <div className="stat">
                  <span>Punches, last 30 days</span>
                  <b>{t.usage.punches30.toLocaleString('en-LK')}</b>
                </div>
                <div className="stat">
                  <span>Last payroll</span>
                  <b style={{ fontSize: 18 }}>{t.usage.lastPayroll ? periodLabel(t.usage.lastPayroll.period) : 'None yet'}</b>
                  {t.usage.lastPayroll && <small>{label(t.usage.lastPayroll.status)}</small>}
                </div>
              </div>

              <Card title="Owners & HR logins" sub="owner and HR manager accounts" pad={false}>
                {t.users.length === 0 ? (
                  <Empty title="No owner or HR logins" icon="key" />
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Email</th>
                          <th>Mobile</th>
                          <th>Last login</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {t.users.map((u) => (
                          <tr key={u.id}>
                            <td>
                              <b>{u.name}</b> {!u.active && <Chip>Inactive</Chip>}
                            </td>
                            <td>{label(u.role)}</td>
                            <td>{u.email ?? '—'}</td>
                            <td>{u.phone ?? '—'}</td>
                            <td className="nowrap">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                            <td className="right">
                              {canSupport && (
                                <Button size="xs" icon="key" busy={act.busy} onClick={() => resetPw(u)}>
                                  Reset password
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <div className="grid2">
                <Card title="Branches" sub={`${t.branches.length}`} pad={false}>
                  {t.branches.length === 0 ? (
                    <div className="card-b muted small">No branches.</div>
                  ) : (
                    t.branches.map((b) => (
                      <div className="list-row" key={b.id}>
                        <span className="chip mono">{b.code}</span>
                        <div className="bd">
                          <b>{b.name}</b>
                        </div>
                      </div>
                    ))
                  )}
                </Card>
                <Card title="Terminals allocated" sub={`${t.terminals.length}`} pad={false} actions={isAdmin && <Link className="btn sm" href="/admin/terminals">Manage terminals</Link>}>
                  {t.terminals.length === 0 ? (
                    <div className="card-b muted small">{t.plan.features.includes('terminals') ? 'No terminals allocated.' : `The ${t.plan.name} plan does not include terminals.`}</div>
                  ) : (
                    t.terminals.map((x) => {
                      const online = !!x.lastSeenAt && Date.now() - Date.parse(x.lastSeenAt) < 15 * 60_000;
                      return (
                        <div className="list-row" key={x.id}>
                          <span className={`dot ${online ? 'ok' : 'bad'}`} title={online ? 'Online' : 'Offline'} />
                          <div className="bd">
                            <b>
                              {x.name || x.model} <span className="mono muted small">{x.serialNo}</span>
                            </b>
                            <span>
                              {branchName(x.branchId)} · last seen {ago(x.lastSeenAt)}
                              {x.monthlyFee && <> · Rs {money(x.monthlyFee)} a month</>}
                            </span>
                          </div>
                          <StatusChip status={x.status} />
                        </div>
                      );
                    })
                  )}
                </Card>
              </div>

              <Card title="Invoices" sub="last 24" pad={false}>
                {t.invoices.length === 0 ? (
                  <Empty title="No invoices yet" icon="receipt">
                    Invoices are made each month for active, non-demo companies.
                  </Empty>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Period</th>
                          <th>Plan</th>
                          <th className="num">Employees</th>
                          <th className="num">Amount (Rs)</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th>Paid</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {t.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="mono nowrap">{inv.number}</td>
                            <td className="nowrap">{periodLabel(inv.periodStart.slice(0, 7))}</td>
                            <td>{inv.planCode}</td>
                            <td className="num">{inv.employees}</td>
                            <td className="num">{money(inv.amount)}</td>
                            <td className="nowrap">{date(inv.dueDate.slice(0, 10))}</td>
                            <td>
                              <StatusChip status={inv.status} />
                              {inv.status === 'DUE' && Date.parse(inv.dueDate) < Date.now() && <> <Chip tone="bad">Overdue</Chip></>}
                            </td>
                            <td className="small">
                              {inv.paidAt ? date(inv.paidAt) : '—'}
                              {inv.reference && <div className="muted">{inv.reference}</div>}
                            </td>
                            <td className="nowrap right">
                              {isAdmin && inv.status === 'DUE' && (
                                <>
                                  <Button size="xs" variant="ok" onClick={() => invoiceStatus(inv, 'PAID')}>
                                    Mark paid
                                  </Button>{' '}
                                  <Button size="xs" variant="danger" onClick={() => invoiceStatus(inv, 'VOID')}>
                                    Void
                                  </Button>
                                </>
                              )}
                              {isAdmin && inv.status !== 'DUE' && (
                                <Button size="xs" onClick={() => invoiceStatus(inv, 'DUE')}>
                                  Mark due
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {editPlan && plans.data && (
              <PlanModal
                t={t}
                plans={plans.data}
                onClose={() => setEditPlan(false)}
                onDone={() => {
                  setEditPlan(false);
                  toast('Plan and billing saved.');
                  reload();
                }}
              />
            )}
            {editBiz && (
              <BusinessModal
                t={t}
                onClose={() => setEditBiz(false)}
                onDone={() => {
                  setEditBiz(false);
                  toast('Business details saved.');
                  reload();
                }}
              />
            )}
            {supportOpen && (
              <SupportModal
                t={t}
                onClose={() => setSupportOpen(false)}
                onStarted={(s) => {
                  setSupportOpen(false);
                  setSupport(s);
                  window.open(s.url, '_blank', 'noopener');
                }}
              />
            )}
            {tempPw && (
              <Modal title="Password reset" size="narrow" onClose={() => setTempPw(null)} footer={<Button onClick={() => setTempPw(null)}>Done</Button>}>
                <div className="stack">
                  <p>
                    Give <b>{tempPw.name}</b> this temporary password. It is shown only now. They must change it when they log in.
                  </p>
                  {tempPw.email && <CopyBox label="Login" value={tempPw.email} />}
                  <CopyBox label="Company code" value={t.slug} />
                  <CopyBox label="Temporary password" value={tempPw.password} />
                </div>
              </Modal>
            )}
          </>
        );
      }}
    </Async>
  );
}

function PlanModal({ t, plans, onClose, onDone }: { t: TenantDetail; plans: PlansResp; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    planId: t.planId,
    billingCycle: t.billingCycle,
    customPrice: t.customPrice ?? '',
    discountPct: t.discountPct ? String(Number(t.discountPct)) : '',
    trialEndsAt: isoToDate(t.trialEndsAt),
    demoExpiresAt: isoToDate(t.demoExpiresAt),
  });
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const plan = plans.plans.find((p) => p.id === f.planId);
  const options = plans.plans.filter((p) => p.active || p.id === t.planId).map((p) => ({ value: p.id, label: `${p.name} — Rs ${money(p.priceMonthly)} · ${p.maxEmployees} employees${p.active ? '' : ' (inactive)'}` }));

  const save = async () => {
    setErr(null);
    const customPrice = moneyInput(f.customPrice);
    if (customPrice === undefined) return setErr('Enter the custom price like 5000.00, or leave it blank.');
    const disc = f.discountPct.trim();
    if (disc && (!/^\d+(\.\d{1,2})?$/.test(disc) || Number(disc) > 100)) return setErr('Discount must be a number from 0 to 100.');
    const body: Record<string, unknown> = {
      planId: f.planId,
      billingCycle: f.billingCycle,
      customPrice,
      discountPct: disc || null,
      trialEndsAt: f.trialEndsAt || null,
    };
    if (t.isDemo) body.demoExpiresAt = f.demoExpiresAt || null;
    const r = await act.run(() => api.patch(`/platform/tenants/${t.id}`, body));
    if (r !== undefined) onDone();
  };

  return (
    <Modal
      title="Plan & billing"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={err ?? act.error} />
        <div className="form-grid">
          <Field label="Plan" wide hint={plan && t.usage.employees > plan.maxEmployees ? `This company has ${t.usage.employees} active employees — more than this plan allows.` : undefined}>
            <Select value={f.planId} onChange={(e) => set('planId', e.target.value)} options={options} />
          </Field>
          <Field label="Billing cycle">
            <Select
              value={f.billingCycle}
              onChange={(e) => set('billingCycle', e.target.value as 'MONTHLY' | 'YEARLY')}
              options={[
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'YEARLY', label: 'Yearly (1/12 of the yearly price each month)' },
              ]}
            />
          </Field>
          <Field label="Custom monthly price (Rs)" hint="Blank = plan price. Overrides the plan and cycle.">
            <Input inputMode="decimal" value={f.customPrice} onChange={(e) => set('customPrice', e.target.value)} />
          </Field>
          <Field label="Discount %">
            <Input inputMode="decimal" value={f.discountPct} onChange={(e) => set('discountPct', e.target.value)} />
          </Field>
          <Field label="Trial ends" hint="Blank = no trial end date.">
            <Input type="date" value={f.trialEndsAt} onChange={(e) => set('trialEndsAt', e.target.value)} />
          </Field>
          {t.isDemo && (
            <Field label="Demo expires">
              <Input type="date" value={f.demoExpiresAt} onChange={(e) => set('demoExpiresAt', e.target.value)} />
            </Field>
          )}
        </div>
        <p className="small muted">The monthly amount is worked out by the server after you save (custom price, or the plan price for the cycle, less the discount). It applies from the next invoice.</p>
      </div>
    </Modal>
  );
}

function BusinessModal({ t, onClose, onDone }: { t: TenantDetail; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: t.name, contactName: t.contactName ?? '', email: t.email ?? '', phone: t.phone ?? '', address: t.address ?? '', industry: t.industry ?? '' });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const r = await act.run(() => api.patch(`/platform/tenants/${t.id}`, { ...f, name: f.name.trim() }));
    if (r !== undefined) onDone();
  };
  return (
    <Modal
      title="Business details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={f.name.trim().length < 2} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Company name" required wide>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Contact name">
            <Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Industry">
            <Input value={f.industry} onChange={(e) => set('industry', e.target.value)} />
          </Field>
          <Field label="Address" wide>
            <Textarea value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <p className="small muted">The company code ({t.slug}) cannot be changed.</p>
      </div>
    </Modal>
  );
}

function SupportModal({ t, onClose, onStarted }: { t: TenantDetail; onClose: () => void; onStarted: (s: SupportStart) => void }) {
  const act = useAction();
  const [reason, setReason] = useState('');
  const [type, setType] = useState<'GENERAL' | 'PAYROLL'>('GENERAL');
  const start = async () => {
    const r = await act.run(() => api.post<SupportStart>(`/platform/tenants/${t.id}/support`, { reason: reason.trim(), reasonType: type }));
    if (r !== undefined) onStarted(r);
  };
  return (
    <Modal
      title={`Support view — ${t.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" icon="eye" busy={act.busy} disabled={reason.trim().length < 10} onClick={start}>
            Open support view
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="alert info">You see the company console as its owner, read-only, for 30 minutes. The company sees this session and your reason in its audit log.</div>
        <Field label="Why do you need to open this company?" required hint="At least 10 characters.">
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner called about missing punches on 3 Nov" />
        </Field>
        <Field label="Type">
          <Seg
            value={type}
            onChange={setType}
            options={[
              { value: 'GENERAL', label: 'General' },
              { value: 'PAYROLL', label: 'Payroll' },
            ]}
          />
        </Field>
        <p className="small muted">{type === 'PAYROLL' ? 'Payroll support shows salary figures. Use it only when the question is about pay.' : 'General support hides salary figures.'}</p>
      </div>
    </Modal>
  );
}
