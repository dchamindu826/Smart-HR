'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { ago, dateTime, money } from '@/lib/format';
import { Async, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, StatusChip, Textarea, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { CopyBox, moneyInput, roleCan, type TenantList } from '../_admin';

type TerminalStatus = 'IN_STOCK' | 'ALLOCATED' | 'REPAIR' | 'RETIRED';

interface TerminalRow {
  id: string;
  serialNo: string;
  model: string;
  name: string | null;
  status: TerminalStatus;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  hasKey: boolean;
  allocatedAt: string | null;
  lastSeenAt: string | null;
  monthlyFee: string | null;
  notes: string | null;
  online: boolean;
  createdAt: string;
}

interface TenantBranches {
  id: string;
  name: string;
  plan: { name: string; features: string[] };
  branches: { id: string; code: string; name: string }[];
}

export default function TerminalsPage() {
  const me = useAdmin();
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [tenantId, setTenantId] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useApi<TerminalRow[]>('/platform/terminals', { status, q: dq, tenantId });
  const tenants = useApi<TenantList>('/platform/tenants', { pageSize: 200 });
  const [editing, setEditing] = useState<TerminalRow | 'new' | null>(null);
  const [allocating, setAllocating] = useState<TerminalRow | null>(null);
  const [key, setKey] = useState<{ terminal: TerminalRow; apiKey: string } | null>(null);
  const isAdmin = roleCan(me.role, 'ADMIN');

  const companyOptions = (tenants.data?.rows ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.isDemo ? ' (demo)' : ''}` }));

  const rotate = async (t: TerminalRow) => {
    if ((await confirm({ title: `New key for ${t.serialNo}?`, body: 'The current key stops working at once. The device sends nothing until you enter the new key on it.', ok: 'Make new key', danger: true })) === false) return;
    const r = await act.run(() => api.post<{ apiKey: string }>(`/platform/terminals/${t.id}/rotate-key`));
    if (r !== undefined) setKey({ terminal: t, apiKey: r.apiKey });
  };

  const giveBack = async (t: TerminalRow) => {
    if ((await confirm({ title: `Return ${t.serialNo} to stock?`, body: `It is taken from ${t.tenant?.name ?? 'the company'}, its key stops working and its monthly fee is no longer invoiced. Punches already received are kept.`, ok: 'Return to stock', danger: true })) === false) return;
    const r = await act.run(() => api.post(`/platform/terminals/${t.id}/return`));
    if (r !== undefined) {
      toast(`${t.serialNo} is back in stock.`);
      reload();
    }
  };

  const setTStatus = async (t: TerminalRow, s: 'IN_STOCK' | 'REPAIR' | 'RETIRED') => {
    if (s === 'RETIRED' && (await confirm({ title: `Retire ${t.serialNo}?`, body: 'A retired terminal cannot be allocated.', ok: 'Retire', danger: true })) === false) return;
    const r = await act.run(() => api.patch(`/platform/terminals/${t.id}`, { status: s }));
    if (r !== undefined) {
      toast(s === 'REPAIR' ? `${t.serialNo} marked for repair.` : s === 'RETIRED' ? `${t.serialNo} retired.` : `${t.serialNo} is back in stock.`);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Terminals"
        sub="Fingerprint and face terminals owned by Lumi AI. Allocate one to a company to give it a device key."
        actions={
          isAdmin && (
            <Button variant="pri" icon="cpu" onClick={() => setEditing('new')}>
              Add terminal
            </Button>
          )
        }
      />
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <div className="filters">
          <Input className="search" placeholder="Search serial, name or model…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={[
              { value: 'IN_STOCK', label: 'In stock' },
              { value: 'ALLOCATED', label: 'Allocated' },
              { value: 'REPAIR', label: 'Repair' },
              { value: 'RETIRED', label: 'Retired' },
            ]}
          />
          <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="All companies" options={companyOptions} />
          {data && <span className="muted small" style={{ marginLeft: 'auto' }}>{data.length} terminals · {data.filter((t) => t.online).length} online</span>}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No terminals" icon="cpu">
                {status || q || tenantId ? 'Nothing matches these filters.' : 'Add a terminal when it arrives in stock.'}
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Model</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Company · branch</th>
                      <th>Online</th>
                      <th>Last seen</th>
                      <th className="num">Fee (Rs/mo)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.id}>
                        <td className="mono nowrap">{t.serialNo}</td>
                        <td>{t.model}</td>
                        <td>
                          {t.name ?? <span className="muted">—</span>}
                          {t.notes && <div className="tiny muted" style={{ maxWidth: 220 }}>{t.notes}</div>}
                        </td>
                        <td>
                          <StatusChip status={t.status} />
                        </td>
                        <td>
                          {t.tenant ? (
                            <>
                              <Link href={`/admin/tenants/${t.tenant.id}`}>{t.tenant.name}</Link>
                              <div className="small muted">{t.branch?.name ?? 'Any branch'}</div>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="nowrap">
                          {t.status === 'ALLOCATED' ? (
                            <>
                              <span className={`dot ${t.online ? 'ok' : 'bad'}`} /> <span className="small">{t.online ? 'Online' : 'Offline'}</span>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="nowrap" title={t.lastSeenAt ? dateTime(t.lastSeenAt) : undefined}>
                          {ago(t.lastSeenAt)}
                        </td>
                        <td className="num">{t.monthlyFee ? money(t.monthlyFee) : '—'}</td>
                        <td className="nowrap right">
                          {isAdmin && (
                            <span className="row tight" style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
                              {t.status === 'IN_STOCK' && (
                                <Button size="xs" variant="pri" onClick={() => setAllocating(t)}>
                                  Allocate
                                </Button>
                              )}
                              {t.status === 'ALLOCATED' && (
                                <>
                                  <Button size="xs" onClick={() => setAllocating(t)} title="Move to another branch (makes a new key)">
                                    Branch
                                  </Button>
                                  <Button size="xs" icon="key" onClick={() => rotate(t)}>
                                    New key
                                  </Button>
                                  <Button size="xs" onClick={() => giveBack(t)}>
                                    Return
                                  </Button>
                                </>
                              )}
                              {t.status === 'IN_STOCK' && (
                                <Button size="xs" onClick={() => setTStatus(t, 'REPAIR')}>
                                  Repair
                                </Button>
                              )}
                              {(t.status === 'REPAIR' || t.status === 'RETIRED') && (
                                <Button size="xs" onClick={() => setTStatus(t, 'IN_STOCK')}>
                                  Back to stock
                                </Button>
                              )}
                              {(t.status === 'IN_STOCK' || t.status === 'REPAIR') && (
                                <Button size="xs" variant="danger" onClick={() => setTStatus(t, 'RETIRED')}>
                                  Retire
                                </Button>
                              )}
                              <Button size="xs" icon="edit" aria-label="Edit" title="Edit" onClick={() => setEditing(t)} />
                            </span>
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
      </Card>

      {editing && (
        <TerminalModal
          terminal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            toast(msg);
            reload();
          }}
        />
      )}
      {allocating && (
        <AllocateModal
          terminal={allocating}
          companies={companyOptions}
          onClose={() => setAllocating(null)}
          onDone={(apiKey) => {
            const t = allocating;
            setAllocating(null);
            setKey({ terminal: t, apiKey });
            reload();
          }}
        />
      )}
      {key && (
        <KeyModal
          serial={key.terminal.serialNo}
          apiKey={key.apiKey}
          onClose={() => {
            setKey(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TerminalModal({ terminal, onClose, onDone }: { terminal: TerminalRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ serialNo: terminal?.serialNo ?? '', model: terminal?.model ?? '', name: terminal?.name ?? '', monthlyFee: terminal?.monthlyFee ?? '', notes: terminal?.notes ?? '' });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setErr(null);
    const monthlyFee = moneyInput(f.monthlyFee);
    if (monthlyFee === undefined) return setErr('Enter the fee like 1500.00, or leave it blank.');
    const body = { model: f.model.trim(), name: f.name, monthlyFee, notes: f.notes };
    const r = await act.run(() => (terminal ? api.patch(`/platform/terminals/${terminal.id}`, body) : api.post('/platform/terminals', { ...body, serialNo: f.serialNo.trim() })));
    if (r !== undefined) onDone(terminal ? `${terminal.serialNo} saved.` : 'Terminal added to stock.');
  };
  const ok = (terminal || f.serialNo.trim().length >= 3) && f.model.trim().length >= 2;
  return (
    <Modal
      title={terminal ? `Edit ${terminal.serialNo}` : 'Add terminal'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            {terminal ? 'Save' : 'Add to stock'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={err ?? act.error} />
        <div className="form-grid">
          <Field label="Serial number" required hint={terminal ? 'The serial cannot be changed.' : 'As printed on the device.'}>
            <Input className="mono" value={f.serialNo} disabled={!!terminal} autoFocus={!terminal} onChange={(e) => set('serialNo', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Model" required>
            <Input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="ZKTeco SpeedFace V5L" />
          </Field>
          <Field label="Name" hint="Shown to the company, e.g. Main gate.">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Monthly fee (Rs)" hint="Added to the company's invoice while allocated.">
            <Input inputMode="decimal" value={f.monthlyFee} onChange={(e) => set('monthlyFee', e.target.value)} />
          </Field>
          <Field label="Notes" wide>
            <Textarea value={f.notes} maxLength={300} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 60 }} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AllocateModal({ terminal, companies, onClose, onDone }: { terminal: TerminalRow; companies: { value: string; label: string }[]; onClose: () => void; onDone: (apiKey: string) => void }) {
  const act = useAction();
  const [tenantId, setTenantId] = useState(terminal.tenantId ?? '');
  const [branchId, setBranchId] = useState(terminal.branchId ?? '');
  const tenant = useApi<TenantBranches>(tenantId ? `/platform/tenants/${tenantId}` : null);
  const noTerminals = !!tenant.data && tenant.data.id === tenantId && !tenant.data.plan.features.includes('terminals');
  const moving = terminal.status === 'ALLOCATED';

  const save = async () => {
    const r = await act.run(() => api.post<{ apiKey: string }>(`/platform/terminals/${terminal.id}/allocate`, { tenantId, branchId: branchId || null }));
    if (r !== undefined) onDone(r.apiKey);
  };

  return (
    <Modal
      title={moving ? `Change branch — ${terminal.serialNo}` : `Allocate ${terminal.serialNo}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!tenantId || noTerminals} onClick={save}>
            {moving ? 'Save and make new key' : 'Allocate and make key'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {moving && <div className="alert warn">Saving makes a new device key. The old key stops working, so enter the new key on the device.</div>}
        <div className="form-grid">
          <Field label="Company" required wide>
            <Select
              value={tenantId}
              disabled={moving}
              onChange={(e) => {
                setTenantId(e.target.value);
                setBranchId('');
              }}
              placeholder="Choose a company"
              options={companies}
            />
          </Field>
          <Field label="Branch" wide hint="Punches from this terminal count for this branch. Leave blank for any branch.">
            <Select
              value={branchId}
              disabled={!tenantId || tenant.loading}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder={tenant.loading ? 'Loading…' : 'Any branch'}
              options={(tenant.data?.id === tenantId ? tenant.data.branches : []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
            />
          </Field>
        </div>
        <ErrorBox error={tenant.error} />
        {noTerminals && <div className="alert bad">The {tenant.data?.plan.name} plan does not include terminals. Change the company&apos;s plan first.</div>}
      </div>
    </Modal>
  );
}

function KeyModal({ serial, apiKey, onClose }: { serial: string; apiKey: string; onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <Modal title={`Device key — ${serial}`} size="wide" onClose={onClose} footer={<Button variant="pri" onClick={onClose}>I have saved the key</Button>}>
      <div className="stack">
        <div className="alert warn">This key is shown only once. Copy it now and enter it on the device. If it is lost, make a new key.</div>
        <CopyBox label="API key" value={apiKey} />
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Setting up the device</h3>
          <ol className="small" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>
              Send every request with the header <span className="mono">X-Terminal-Key: {apiKey.slice(0, 8)}…</span> (the full key above).
            </li>
            <li>
              Punches: <span className="mono">POST {origin}/api/v1/terminal/punches</span> with JSON{' '}
              <span className="mono">{'{ "punches": [{ "clientId": "unique-id", "empNo": "E001", "occurredAt": "2026-11-04T08:29:00+05:30" }] }'}</span> — up to 500 per request. Sending the same clientId twice is safe.
            </li>
            <li>
              Heartbeat: <span className="mono">GET {origin}/api/v1/terminal/ping</span> every few minutes. The terminal shows as online if it pinged in the last 15 minutes.
            </li>
            <li>Enrol each employee on the device with their employee number (empNo) exactly as in SmartHR.</li>
          </ol>
        </div>
        <CopyBox label="Punch URL" value={`${origin}/api/v1/terminal/punches`} />
        <CopyBox label="Ping URL" value={`${origin}/api/v1/terminal/ping`} />
      </div>
    </Modal>
  );
}
