'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import { Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, LinkButton, Modal, PageHeader, Pager, Seg, Select, StatusChip, Textarea, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { CopyBox, moneyInput, roleCan, type CreatedTenant, type PlansResp, type TenantList } from '../_admin';

const PAGE_SIZE = 25;

export default function TenantsPage() {
  const me = useAdmin();
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [plan, setPlan] = useState('');
  const [demo, setDemo] = useState(sp.get('demo') ?? 'false');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedTenant | null>(null);

  const plans = useApi<PlansResp>('/platform/plans');
  const { data, error, loading, reload } = useApi<TenantList>('/platform/tenants', { q: dq, status, plan, demo, page, pageSize: PAGE_SIZE });

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Companies"
        sub="Every company on SmartHR. Open one to change its plan, billing, logins or status."
        actions={
          roleCan(me.role, 'ADMIN') && (
            <Button variant="pri" icon="building" onClick={() => setAdding(true)}>
              Add company
            </Button>
          )
        }
      />
      <Card pad={false}>
        <div className="filters">
          <Input className="search" placeholder="Search name, code or email…" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} />
          <Select
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value)}
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'TRIAL', label: 'Trial' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <Select value={plan} onChange={(e) => resetPage(setPlan)(e.target.value)} placeholder="All plans" options={(plans.data?.plans ?? []).map((p) => ({ value: p.code, label: p.name }))} />
          <Seg
            value={demo}
            onChange={resetPage(setDemo)}
            options={[
              { value: 'false', label: 'Customers' },
              { value: 'true', label: 'Demos' },
              { value: '', label: 'All' },
            ]}
          />
          {data && <span className="muted small" style={{ marginLeft: 'auto' }}>{data.total} companies</span>}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No companies found" icon="building">
                Try another search or filter.
              </Empty>
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Plan</th>
                        <th>Status</th>
                        <th className="num">Monthly (Rs)</th>
                        <th className="num">Employees</th>
                        <th className="num">Users</th>
                        <th className="num">Active 7 d</th>
                        <th className="num">Terminals</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((t) => (
                        <tr key={t.id} className="click" onClick={() => router.push(`/admin/tenants/${t.id}`)}>
                          <td>
                            <b>{t.name}</b>
                            <div className="small muted mono">{t.slug}</div>
                          </td>
                          <td>
                            {t.plan.name}
                            {t.billingCycle === 'YEARLY' && <div className="tiny muted">Yearly</div>}
                          </td>
                          <td className="nowrap">
                            <StatusChip status={t.status} /> {t.isDemo && <Chip tone="mag">Demo</Chip>}
                          </td>
                          <td className="num">
                            {money(t.monthlyAmount)}
                            {(t.customPrice || t.discountPct) && <div className="tiny muted">{t.customPrice ? 'custom price' : `${Number(t.discountPct)}% off`}</div>}
                          </td>
                          <td className="num">
                            <span className={t.employees >= t.plan.maxEmployees ? 'bad-t' : t.employees >= t.plan.maxEmployees * 0.9 ? 'warn-t' : ''}>{t.employees}</span>
                            <span className="muted"> / {t.plan.maxEmployees}</span>
                          </td>
                          <td className="num">{t.users}</td>
                          <td className="num">{t.activeUsers7d}</td>
                          <td className="num">{t.terminals}</td>
                          <td className="nowrap">{date(t.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={PAGE_SIZE} total={d.total} onPage={setPage} />
              </>
            )
          }
        </Async>
      </Card>

      {adding && plans.data && (
        <AddCompanyModal
          plans={plans.data}
          onClose={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            setCreated(r);
            reload();
          }}
        />
      )}
      {created && (
        <Modal
          title="Company created"
          onClose={() => setCreated(null)}
          footer={
            <>
              <Button onClick={() => setCreated(null)}>Close</Button>
              <LinkButton variant="pri" href={`/admin/tenants/${created.id}`}>
                Open company
              </LinkButton>
            </>
          }
        >
          <div className="stack">
            <div className="alert ok">The company is ready with a head office, statutory leave types, pay components and a general shift. No sample data.</div>
            <CopyBox label="Company code" value={created.slug} />
            <CopyBox label="Owner login" value={created.ownerEmail} />
            <CopyBox label="Temporary password" value={created.ownerPassword} />
            <p className="small muted">This password is shown only now. The owner must change it on first login. Share it through a safe channel.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function AddCompanyModal({ plans, onClose, onDone }: { plans: PlansResp; onClose: () => void; onDone: (r: CreatedTenant) => void }) {
  const act = useAction();
  const active = plans.plans.filter((p) => p.active);
  const [f, setF] = useState({
    name: '',
    slug: '',
    planId: active[0]?.id ?? '',
    status: 'TRIAL' as 'TRIAL' | 'ACTIVE',
    trialDays: '14',
    billingCycle: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
    customPrice: '',
    discountPct: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
    industry: '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    sendWelcome: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [err, setErr] = useState<string | null>(null);
  const plan = plans.plans.find((p) => p.id === f.planId);

  const submit = async () => {
    setErr(null);
    const customPrice = moneyInput(f.customPrice);
    if (customPrice === undefined) return setErr('Enter the custom price like 5000.00, or leave it blank.');
    const disc = f.discountPct.trim();
    if (disc && (!/^\d+(\.\d{1,2})?$/.test(disc) || Number(disc) > 100)) return setErr('Discount must be a number from 0 to 100.');
    const trialDays = Number(f.trialDays);
    if (f.status === 'TRIAL' && (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90)) return setErr('Trial days must be 1 to 90.');
    const r = await act.run(() =>
      api.post<CreatedTenant>('/platform/tenants', {
        name: f.name.trim(),
        slug: f.slug.trim() || undefined,
        planId: f.planId,
        status: f.status,
        trialDays: f.status === 'TRIAL' ? trialDays : undefined,
        billingCycle: f.billingCycle,
        customPrice,
        discountPct: disc || null,
        contactName: f.contactName,
        phone: f.phone,
        email: f.email,
        address: f.address,
        industry: f.industry,
        owner: { name: f.ownerName.trim(), email: f.ownerEmail.trim(), phone: f.ownerPhone || null },
        sendWelcome: f.sendWelcome,
      }),
    );
    if (r !== undefined) onDone(r);
  };

  const ok = f.name.trim().length >= 2 && f.planId && f.ownerName.trim().length >= 2 && f.ownerEmail.includes('@');

  return (
    <Modal
      title="Add company"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={submit}>
            Create company
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={err ?? act.error} />
        <h3 style={{ fontSize: 14 }}>Company</h3>
        <div className="form-grid">
          <Field label="Company name" required>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ABC Holdings (Pvt) Ltd" autoFocus />
          </Field>
          <Field label="Company code" hint="Used to log in. Leave blank to make one from the name.">
            <Input value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} placeholder="abc-holdings" className="mono" />
          </Field>
          <Field label="Industry">
            <Input value={f.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Retail, garments, logistics…" />
          </Field>
        </div>

        <h3 style={{ fontSize: 14 }}>Plan and billing</h3>
        <div className="form-grid">
          <Field label="Plan" required hint={plan ? `Rs ${money(plan.priceMonthly)} a month · up to ${plan.maxEmployees} employees` : undefined}>
            <Select value={f.planId} onChange={(e) => set('planId', e.target.value)} options={active.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Start as">
            <Seg
              value={f.status}
              onChange={(v) => set('status', v)}
              options={[
                { value: 'TRIAL', label: 'Trial' },
                { value: 'ACTIVE', label: 'Active (paying)' },
              ]}
            />
          </Field>
          {f.status === 'TRIAL' && (
            <Field label="Trial days" hint="1 to 90">
              <Input type="number" min={1} max={90} value={f.trialDays} onChange={(e) => set('trialDays', e.target.value)} />
            </Field>
          )}
          <Field label="Billing cycle" hint={f.billingCycle === 'YEARLY' && plan?.priceYearly ? `Rs ${money(plan.priceYearly)} a year, invoiced monthly as 1/12` : undefined}>
            <Select
              value={f.billingCycle}
              onChange={(e) => set('billingCycle', e.target.value as 'MONTHLY' | 'YEARLY')}
              options={[
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'YEARLY', label: 'Yearly' },
              ]}
            />
          </Field>
          <Field label="Custom monthly price (Rs)" hint="Leave blank to use the plan price.">
            <Input inputMode="decimal" value={f.customPrice} onChange={(e) => set('customPrice', e.target.value)} placeholder="e.g. 5000.00" />
          </Field>
          <Field label="Discount %" hint="Taken off the monthly amount.">
            <Input inputMode="decimal" value={f.discountPct} onChange={(e) => set('discountPct', e.target.value)} placeholder="e.g. 10" />
          </Field>
        </div>

        <h3 style={{ fontSize: 14 }}>Business contact</h3>
        <div className="form-grid">
          <Field label="Contact name" hint="Defaults to the owner.">
            <Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="011 2345678" />
          </Field>
          <Field label="Email" hint="Defaults to the owner's email.">
            <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Address" wide>
            <Textarea value={f.address} onChange={(e) => set('address', e.target.value)} style={{ minHeight: 60 }} />
          </Field>
        </div>

        <h3 style={{ fontSize: 14 }}>Owner login</h3>
        <div className="form-grid">
          <Field label="Owner name" required>
            <Input value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
          </Field>
          <Field label="Owner email" required hint="This is the login.">
            <Input type="email" value={f.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
          </Field>
          <Field label="Owner mobile">
            <Input value={f.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} placeholder="0771234567" />
          </Field>
          <div className="field wide">
            <Check checked={f.sendWelcome} onChange={(v) => set('sendWelcome', v)} label="Email the owner a welcome message with the company code and temporary password" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
