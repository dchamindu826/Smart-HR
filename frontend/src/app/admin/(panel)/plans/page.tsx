'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Textarea, Toggle, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { ALWAYS_ON, moneyInput, roleCan, type PlanRow, type PlansResp } from '../_admin';

export default function PlansPage() {
  const me = useAdmin();
  const { toast } = useUi();
  const { data, error, loading, reload } = useApi<PlansResp>('/platform/plans');
  const [editing, setEditing] = useState<PlanRow | 'new' | null>(null);
  const isSuper = roleCan(me.role);

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        sub="What each plan costs and which features it includes. Price changes apply to the next invoice; companies with a custom price keep it."
        actions={
          isSuper && (
            <Button variant="pri" icon="money" onClick={() => setEditing('new')}>
              Add plan
            </Button>
          )
        }
      />
      <Async data={data} error={error} loading={loading}>
        {(d) =>
          d.plans.length === 0 ? (
            <Card>
              <Empty title="No plans yet" icon="money" />
            </Card>
          ) : (
            <div className="grid3">
              {d.plans.map((p) => {
                const extras = p.features.filter((f) => !ALWAYS_ON.includes(f));
                return (
                  <section className="card" key={p.id} style={{ marginTop: 0, display: 'flex', flexDirection: 'column', opacity: p.active ? 1 : 0.7 }}>
                    <div className="card-h">
                      <h2>{p.name}</h2>
                      <span className="chip mono">{p.code}</span>
                      <div className="sp">{p.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</div>
                    </div>
                    <div className="card-b stack tight" style={{ flex: 1 }}>
                      <div>
                        <span style={{ fontFamily: 'Poppins, sans-serif', fontSize: 24, fontWeight: 700 }}>Rs {money(p.priceMonthly)}</span>
                        <span className="muted"> / month</span>
                      </div>
                      <div className="small muted">{p.priceYearly ? `Rs ${money(p.priceYearly)} a year` : 'No yearly price'}</div>
                      {p.description && <p className="small">{p.description}</p>}
                      <dl className="kv" style={{ gridTemplateColumns: '130px 1fr', fontSize: 13 }}>
                        <dt>Max employees</dt>
                        <dd>{p.maxEmployees.toLocaleString('en-LK')}</dd>
                        <dt>Companies</dt>
                        <dd>{p.tenantCount}</dd>
                        <dt>Sort order</dt>
                        <dd>{p.sortOrder}</dd>
                      </dl>
                      <div className="row tight" style={{ marginTop: 4 }}>
                        <Chip tone="info">Core HR, attendance, leave, payroll, returns, gratuity</Chip>
                        {extras.map((f) => (
                          <Chip key={f} title={d.features[f]}>
                            {d.features[f] ?? f}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    {isSuper && (
                      <div className="card-f">
                        <Button size="sm" icon="edit" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )
        }
      </Async>
      {editing && data && (
        <PlanModal
          plan={editing === 'new' ? null : editing}
          features={data.features}
          nextSort={Math.max(0, ...data.plans.map((p) => p.sortOrder)) + 1}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            toast(msg);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanModal({ plan, features, nextSort, onClose, onDone }: { plan: PlanRow | null; features: Record<string, string>; nextSort: number; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    priceMonthly: plan?.priceMonthly ?? '',
    priceYearly: plan?.priceYearly ?? '',
    maxEmployees: String(plan?.maxEmployees ?? 25),
    active: plan?.active ?? true,
    sortOrder: String(plan?.sortOrder ?? nextSort),
  });
  const [feats, setFeats] = useState<Set<string>>(new Set([...(plan?.features ?? []), ...ALWAYS_ON]));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (code: string, on: boolean) =>
    setFeats((s) => {
      const n = new Set(s);
      if (on) n.add(code);
      else n.delete(code);
      return n;
    });

  const save = async () => {
    setErr(null);
    const priceMonthly = moneyInput(f.priceMonthly);
    if (!priceMonthly) return setErr('Enter the monthly price like 6500.00.');
    const priceYearly = moneyInput(f.priceYearly);
    if (priceYearly === undefined) return setErr('Enter the yearly price like 65000.00, or leave it blank.');
    const maxEmployees = Number(f.maxEmployees);
    if (!Number.isInteger(maxEmployees) || maxEmployees < 1) return setErr('Max employees must be a whole number, 1 or more.');
    const sortOrder = Number(f.sortOrder);
    if (!Number.isInteger(sortOrder)) return setErr('Sort order must be a whole number.');
    if (!plan && !/^[A-Za-z0-9_]{2,20}$/.test(f.code)) return setErr('The code is 2–20 letters, numbers or _.');
    const body = {
      name: f.name.trim(),
      description: f.description,
      priceMonthly,
      priceYearly,
      maxEmployees,
      active: f.active,
      sortOrder,
      features: Object.keys(features).filter((k) => feats.has(k) || ALWAYS_ON.includes(k)),
    };
    const r = await act.run(() => (plan ? api.patch(`/platform/plans/${plan.id}`, body) : api.post('/platform/plans', { ...body, code: f.code.toUpperCase() })));
    if (r !== undefined) onDone(plan ? `${body.name} saved.` : `${body.name} plan added.`);
  };

  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : 'Add plan'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={f.name.trim().length < 2} onClick={save}>
            {plan ? 'Save plan' : 'Add plan'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={err ?? act.error} />
        {plan && plan.tenantCount > 0 && (
          <div className="alert warn">
            {plan.tenantCount} compan{plan.tenantCount === 1 ? 'y is' : 'ies are'} on this plan. Price changes apply from their next invoice (companies with a custom price keep it). Removing a feature turns it off for them straight away.
          </div>
        )}
        <div className="form-grid">
          <Field label="Code" required hint={plan ? 'The code cannot be changed.' : 'e.g. ENTERPRISE'}>
            <Input className="mono" value={f.code} disabled={!!plan} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Name" required>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Monthly price (Rs)" required>
            <Input inputMode="decimal" value={f.priceMonthly} onChange={(e) => set('priceMonthly', e.target.value)} />
          </Field>
          <Field label="Yearly price (Rs)" hint="Blank = no yearly option.">
            <Input inputMode="decimal" value={f.priceYearly} onChange={(e) => set('priceYearly', e.target.value)} />
          </Field>
          <Field label="Max employees" required>
            <Input type="number" min={1} value={f.maxEmployees} onChange={(e) => set('maxEmployees', e.target.value)} />
          </Field>
          <Field label="Sort order" hint="Lower shows first.">
            <Input type="number" value={f.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
          </Field>
          <Field label="Description" wide>
            <Textarea value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 60 }} />
          </Field>
          <div className="field wide">
            <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Active — can be chosen for new companies" />
          </div>
        </div>
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Features</h3>
          <div className="grid2" style={{ gap: 8 }}>
            {Object.entries(features).map(([code, text]) => {
              const always = ALWAYS_ON.includes(code);
              return always ? (
                <label className="check" key={code} style={{ cursor: 'default', opacity: 0.75 }}>
                  <input type="checkbox" checked disabled />
                  {text} <span className="tiny muted">always included</span>
                </label>
              ) : (
                <Check key={code} checked={feats.has(code)} onChange={(v) => toggle(code, v)} label={text} />
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
