'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { addDays, date, today } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, LinkButton, Modal, PageHeader, Select, StatusChip, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { CopyBox, daysLeft, isoToDate, roleCan, type CreatedTenant, type PlansResp, type TenantList, type TenantRow } from '../_admin';

const DEMO_PASSWORD = 'Demo@1234';
const DEMO_LOGINS: { prefix: string; who: string }[] = [
  { prefix: 'hr', who: 'HR manager (Dilani Fernando)' },
  { prefix: 'manager', who: 'Operations manager, makes the roster (Nimal Jayasuriya)' },
  { prefix: 'payroll', who: 'Payroll officer (Sanduni Wickramasinghe)' },
  { prefix: 'sales', who: 'Sales manager (Mohamed Rizwan)' },
  { prefix: 'kamal', who: 'Employee, for the mobile app (Kamal Perera)' },
];

export default function DemosPage() {
  const me = useAdmin();
  const { toast, confirm } = useUi();
  const act = useAction();
  const { data, error, loading, reload } = useApi<TenantList>('/platform/tenants', { demo: 'true', pageSize: 200 });
  const plans = useApi<PlansResp>('/platform/plans');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedTenant | null>(null);

  const isAdmin = roleCan(me.role, 'ADMIN');
  const canCreate = roleCan(me.role, 'ADMIN', 'SALES');

  const extend = async (t: TenantRow, n: number) => {
    const current = isoToDate(t.demoExpiresAt);
    const base = current && current > today() ? current : today();
    const next = addDays(base, n);
    const r = await act.run(() => api.patch(`/platform/tenants/${t.id}`, { demoExpiresAt: next }));
    if (r !== undefined) {
      toast(`${t.name} demo now runs to ${date(next)}.`);
      reload();
    }
  };

  const convert = async (t: TenantRow) => {
    if ((await confirm({ title: `Convert ${t.name} to a real account?`, body: 'All sample employees, attendance, roster, leave and assets are removed. Settings stay. The company starts a 14-day trial.', ok: 'Convert', danger: true })) === false) return;
    const r = await act.run(() => api.post(`/platform/tenants/${t.id}/convert-demo`));
    if (r !== undefined) {
      toast(`${t.name} is now a real account on a 14-day trial.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Demo accounts"
        sub="Companies filled with sample data for sales demos. They expire on their own date and are never invoiced."
        actions={
          canCreate && (
            <Button variant="pri" icon="flask" onClick={() => setCreating(true)}>
              Create demo
            </Button>
          )
        }
      />
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No demo accounts" icon="flask" action={canCreate && <Button onClick={() => setCreating(true)}>Create demo</Button>}>
                A demo gets sample employees, attendance, roster, leave and assets.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Owner email</th>
                      <th className="num">Active 7 d</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((t) => {
                      const left = daysLeft(t.demoExpiresAt);
                      return (
                        <tr key={t.id}>
                          <td>
                            <Link href={`/admin/tenants/${t.id}`}>
                              <b>{t.name}</b>
                            </Link>
                            <div className="small muted mono">{t.slug}</div>
                          </td>
                          <td>{t.plan.name}</td>
                          <td>
                            <StatusChip status={t.status} />
                          </td>
                          <td className="nowrap">
                            {date(t.demoExpiresAt)}{' '}
                            {left !== null && <Chip tone={left < 0 ? 'bad' : left <= 3 ? 'warn' : 'ok'}>{left < 0 ? 'Expired' : left === 0 ? 'Today' : `${left} d left`}</Chip>}
                          </td>
                          <td>{t.email ?? '—'}</td>
                          <td className="num">{t.activeUsers7d}</td>
                          <td className="nowrap right">
                            {isAdmin && (
                              <span className="row tight" style={{ display: 'inline-flex', marginRight: 6 }}>
                                <span className="small muted">Extend</span>
                                {[7, 14, 30].map((n) => (
                                  <Button key={n} size="xs" disabled={act.busy} onClick={() => extend(t, n)}>
                                    +{n}
                                  </Button>
                                ))}
                              </span>
                            )}
                            {isAdmin && (
                              <Button size="xs" disabled={act.busy} onClick={() => convert(t)}>
                                Convert
                              </Button>
                            )}{' '}
                            <LinkButton size="xs" href={`/admin/tenants/${t.id}`}>
                              Open
                            </LinkButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>

      {creating && plans.data && (
        <CreateDemoModal
          plans={plans.data}
          onClose={() => setCreating(false)}
          onDone={(r) => {
            setCreating(false);
            setCreated(r);
            reload();
          }}
        />
      )}
      {created && (
        <Modal
          title="Demo ready"
          size="wide"
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
            <div className="alert ok">The demo has sample employees, attendance, roster, leave and assets, in a head office and a Kandy branch.</div>
            <div className="grid2">
              <CopyBox label="Company code" value={created.slug} />
              <div />
              <CopyBox label="Owner login" value={created.ownerEmail} />
              <CopyBox label="Owner temporary password (shown only now)" value={created.ownerPassword} />
            </div>
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>Extra demo logins</h3>
              <p className="small muted" style={{ marginBottom: 8 }}>
                All use the password <span className="mono">{DEMO_PASSWORD}</span> and do not need to change it.
              </p>
              <div className="tbl-wrap">
                <table className="tbl">
                  <tbody>
                    {DEMO_LOGINS.map((l) => (
                      <tr key={l.prefix}>
                        <td className="mono">
                          {l.prefix}.{created.slug}@demo.lumiai.lk
                        </td>
                        <td className="muted">{l.who}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CreateDemoModal({ plans, onClose, onDone }: { plans: PlansResp; onClose: () => void; onDone: (r: CreatedTenant) => void }) {
  const act = useAction();
  const active = plans.plans.filter((p) => p.active);
  const best = [...active].sort((a, b) => b.features.length - a.features.length)[0];
  const [f, setF] = useState({ name: '', planId: best?.id ?? '', days: '14', ownerName: '', ownerEmail: '', ownerPhone: '' });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  const days = Number(f.days);
  const ok = f.name.trim().length >= 2 && f.planId && f.ownerName.trim().length >= 2 && f.ownerEmail.includes('@') && Number.isInteger(days) && days >= 1 && days <= 60;

  const submit = async () => {
    const r = await act.run(() =>
      api.post<CreatedTenant>('/platform/demos', {
        name: f.name.trim(),
        planId: f.planId,
        demoDays: days,
        owner: { name: f.ownerName.trim(), email: f.ownerEmail.trim(), phone: f.ownerPhone || null },
      }),
    );
    if (r !== undefined) onDone(r);
  };

  return (
    <Modal
      title="Create demo"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={submit}>
            Create demo
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Company name" required wide hint="Use the prospect's name so the demo feels like theirs.">
            <Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Plan" required hint="Pick the plan you are selling. Complete shows every screen.">
            <Select value={f.planId} onChange={(e) => set('planId', e.target.value)} options={active.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Days" required hint="1 to 60">
            <Input type="number" min={1} max={60} value={f.days} onChange={(e) => set('days', e.target.value)} />
          </Field>
          <Field label="Owner name" required>
            <Input value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
          </Field>
          <Field label="Owner email" required hint="The prospect's email. They get the login by email.">
            <Input type="email" value={f.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
          </Field>
          <Field label="Owner mobile">
            <Input value={f.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} placeholder="0771234567" />
          </Field>
        </div>
        <p className="small muted">
          Sample employees, attendance, roster, leave and assets are added. Extra logins are made for HR, a manager, payroll and an employee, e.g. <span className="mono">hr.&lt;code&gt;@demo.lumiai.lk</span>, all with the password{' '}
          <span className="mono">{DEMO_PASSWORD}</span>. Creating takes a few seconds.
        </p>
      </div>
    </Modal>
  );
}
