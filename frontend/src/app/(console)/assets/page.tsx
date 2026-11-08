'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { date, dateTime, fullName, label, money, today } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Person, Select, StatusChip, Tabs, Textarea, useUi } from '@/components/ui';
import { BranchSelect, EmployeePicker } from '@/components/pickers';

type AssetStatus = 'IN_STOCK' | 'ASSIGNED' | 'REPAIR' | 'LOST' | 'RETIRED';
type Condition = 'NEW' | 'GOOD' | 'FAIR' | 'POOR';
interface HistoryItem {
  at: string;
  action: string;
  employeeId?: string | null;
  employeeName?: string | null;
  by: string;
  note?: string | null;
}
interface Asset {
  id: string;
  tag: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  purchaseDate: string | null;
  cost: string | null;
  warrantyTo: string | null;
  status: AssetStatus;
  condition: Condition | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  assignedToId: string | null;
  assignedTo: { id: string; empNo: string; firstName: string; lastName: string } | null;
  assignedAt: string | null;
  notes: string | null;
  history: HistoryItem[];
}
interface AssetList {
  rows: Asset[];
  counts: Partial<Record<AssetStatus, number>>;
}
interface AssetRequest {
  id: string;
  employee: { id: string; empNo: string; firstName: string; lastName: string; designation: string | null };
  category: string;
  item: string;
  reason: string;
  neededBy: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  asset: { id: string; tag: string; name: string } | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const STATUSES: AssetStatus[] = ['IN_STOCK', 'ASSIGNED', 'REPAIR', 'LOST', 'RETIRED'];
const CONDITIONS: Condition[] = ['NEW', 'GOOD', 'FAIR', 'POOR'];
const condOptions = CONDITIONS.map((c) => ({ value: c, label: label(c) }));
type TabKey = 'register' | 'requests';

export default function AssetsPage() {
  const { can, has } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const canManage = can('asset.manage');
  const canDecide = can('asset.decide');
  const initial: TabKey = sp.get('tab') === 'requests' || !canManage ? 'requests' : 'register';
  const [tab, setTabState] = useState<TabKey>(initial);
  const cats = useApi<string[]>(has('assets') ? '/assets/categories' : null);
  const setTab = (t: TabKey) => {
    setTabState(t);
    router.replace(t === 'requests' ? '/assets?tab=requests' : '/assets');
  };

  if (!has('assets')) {
    return (
      <>
        <PageHeader title="Assets & equipment" />
        <Card>
          <Empty title="Assets are not in your plan" icon="box">
            Ask Lumi AI to add assets and equipment to your SmartHR plan.
          </Empty>
        </Card>
      </>
    );
  }

  const categories = (cats.data ?? []).map((c) => ({ value: c, label: label(c) }));
  const tabs = [...(canManage ? [{ value: 'register' as TabKey, label: 'Register' }] : []), ...(canDecide ? [{ value: 'requests' as TabKey, label: 'Requests' }] : [])];

  return (
    <>
      <PageHeader title="Assets & equipment" sub="Laptops, phones, SIMs, vehicles, uniforms and tools — who has what, and requests for more." />
      {tabs.length > 1 && <Tabs<TabKey> value={tab} onChange={setTab} tabs={tabs} />}
      {tab === 'register' && canManage && <Register categories={categories} />}
      {tab === 'requests' && canDecide && <Requests categories={categories} canManage={canManage} />}
      {!canManage && !canDecide && (
        <Card>
          <Empty title="You cannot manage assets" icon="box" />
        </Card>
      )}
    </>
  );
}

// ─── Register ──────────────────────────────────────────────────

function Register({ categories }: { categories: { value: string; label: string }[] }) {
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useApi<AssetList>('/assets', { status, category, q: dq });
  const [editing, setEditing] = useState<Asset | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [returning, setReturning] = useState<Asset | null>(null);
  const [history, setHistory] = useState<Asset | null>(null);

  const remove = async (a: Asset) => {
    if ((await confirm({ title: `Delete ${a.tag} — ${a.name}?`, body: 'It is removed from the register with its history. To keep the record, mark it retired instead.', ok: 'Delete', danger: true })) === false) return;
    const r = await act.run(() => api.del(`/assets/${a.id}`));
    if (r !== undefined) {
      toast(`${a.tag} deleted.`);
      reload();
    }
  };

  const done = (msg: string) => {
    setEditing(null);
    setAssigning(null);
    setReturning(null);
    toast(msg);
    reload();
  };

  const total = data ? Object.values(data.counts).reduce((a, n) => a + (n ?? 0), 0) : 0;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`chip ${status === '' ? 'info' : ''}`} onClick={() => setStatus('')}>
          All {total}
        </button>
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${status === s ? 'info' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>
            {label(s)} {data?.counts[s] ?? 0}
          </button>
        ))}
        <span className="grow" />
        <Button variant="pri" icon="box" onClick={() => setEditing('new')}>
          Add asset
        </Button>
      </div>
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <div className="filters">
          <Input className="search" placeholder="Search tag, name, serial or brand…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: label(s) }))} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={categories} />
        </div>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No assets" icon="box" action={!status && !category && !q && <Button onClick={() => setEditing('new')}>Add asset</Button>}>
                {status || category || q ? 'Nothing matches these filters.' : 'Add laptops, phones and other equipment to track who has them.'}
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Brand · model</th>
                      <th>Serial</th>
                      <th>With</th>
                      <th>Branch</th>
                      <th>Condition</th>
                      <th>Warranty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((a) => {
                      const warrantyOver = a.warrantyTo && a.warrantyTo < today();
                      return (
                        <tr key={a.id}>
                          <td className="mono nowrap">{a.tag}</td>
                          <td>
                            <b>{a.name}</b>
                            {a.cost && <div className="tiny muted">Rs {money(a.cost)}</div>}
                          </td>
                          <td>{label(a.category)}</td>
                          <td>{[a.brand, a.model].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="mono small">{a.serialNo ?? '—'}</td>
                          <td>
                            {a.assignedTo ? (
                              <Person name={fullName(a.assignedTo)} sub={`${a.assignedTo.empNo}${a.assignedAt ? ` · since ${date(a.assignedAt)}` : ''}`} href={`/employees/${a.assignedTo.id}`} photoEmployeeId={a.assignedTo.id} />
                            ) : (
                              <StatusChip status={a.status} />
                            )}
                          </td>
                          <td>{a.branch?.name ?? '—'}</td>
                          <td>{a.condition ? <Chip tone={a.condition === 'POOR' ? 'bad' : a.condition === 'FAIR' ? 'warn' : ''}>{label(a.condition)}</Chip> : '—'}</td>
                          <td className="nowrap">{a.warrantyTo ? <span className={warrantyOver ? 'muted' : ''}>{date(a.warrantyTo)}{warrantyOver ? ' (over)' : ''}</span> : '—'}</td>
                          <td className="nowrap right">
                            {a.status === 'IN_STOCK' && (
                              <Button size="xs" variant="pri" onClick={() => setAssigning(a)}>
                                Assign
                              </Button>
                            )}
                            {a.status === 'ASSIGNED' && (
                              <Button size="xs" onClick={() => setReturning(a)}>
                                Take back
                              </Button>
                            )}{' '}
                            <Button size="xs" icon="edit" aria-label="Edit" title="Edit" onClick={() => setEditing(a)} />{' '}
                            <Button size="xs" icon="clock" aria-label="History" title="History" onClick={() => setHistory(a)} />{' '}
                            {a.status !== 'ASSIGNED' && <Button size="xs" variant="ghost" icon="trash" aria-label="Delete" title="Delete" onClick={() => remove(a)} />}
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

      {editing && <AssetModal asset={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onDone={done} />}
      {assigning && <AssignModal asset={assigning} onClose={() => setAssigning(null)} onDone={done} />}
      {returning && <ReturnModal asset={returning} onClose={() => setReturning(null)} onDone={done} />}
      {history && (
        <Modal title={`History — ${history.tag} ${history.name}`} onClose={() => setHistory(null)} footer={<Button onClick={() => setHistory(null)}>Close</Button>}>
          {history.history.length === 0 ? (
            <Empty title="No history" icon="clock" />
          ) : (
            <div className="card">
              {[...history.history].reverse().map((h, i) => (
                <div className="list-row" key={i} style={{ alignItems: 'flex-start' }}>
                  <StatusChip status={h.action} labelText={h.action === 'ADDED' ? 'Added' : undefined} />
                  <div className="bd">
                    <b>
                      {h.action === 'ASSIGNED' && h.employeeName ? `Given to ${h.employeeName}` : h.action === 'RETURNED' && h.employeeName ? `Returned by ${h.employeeName}` : label(h.action)}
                    </b>
                    <span>
                      {dateTime(h.at)} · by {h.by}
                    </span>
                    {h.note && <div className="small" style={{ marginTop: 2 }}>{h.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function AssetModal({ asset, categories, onClose, onDone }: { asset: Asset | null; categories: { value: string; label: string }[]; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    tag: asset?.tag ?? '',
    name: asset?.name ?? '',
    category: asset?.category ?? categories[0]?.value ?? 'LAPTOP',
    brand: asset?.brand ?? '',
    model: asset?.model ?? '',
    serialNo: asset?.serialNo ?? '',
    purchaseDate: asset?.purchaseDate ?? '',
    cost: asset?.cost ?? '',
    warrantyTo: asset?.warrantyTo ?? '',
    condition: (asset?.condition ?? 'NEW') as Condition,
    branchId: asset?.branchId ?? '',
    notes: asset?.notes ?? '',
    status: (asset?.status ?? 'IN_STOCK') as AssetStatus,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setErr(null);
    const costS = f.cost.replace(/,/g, '').trim();
    if (costS && !/^\d+(\.\d{1,2})?$/.test(costS)) return setErr('Enter the cost like 185000.00, or leave it blank.');
    const body: Record<string, unknown> = {
      tag: f.tag.trim() || undefined,
      name: f.name.trim(),
      category: f.category,
      brand: f.brand,
      model: f.model,
      serialNo: f.serialNo,
      purchaseDate: f.purchaseDate || null,
      cost: costS ? Number(costS).toFixed(2) : null,
      warrantyTo: f.warrantyTo || null,
      condition: f.condition,
      branchId: f.branchId || null,
      notes: f.notes,
    };
    if (asset && asset.status !== 'ASSIGNED' && f.status !== asset.status) body.status = f.status;
    const r = await act.run(() => (asset ? api.patch(`/assets/${asset.id}`, body) : api.post('/assets', body)));
    if (r !== undefined) onDone(asset ? `${asset.tag} saved.` : `${f.name.trim()} added.`);
  };

  return (
    <Modal
      title={asset ? `Edit ${asset.tag}` : 'Add asset'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={f.name.trim().length < 2} onClick={save}>
            {asset ? 'Save' : 'Add asset'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={err ?? act.error} />
        <div className="form-grid">
          <Field label="Tag" hint={asset ? undefined : 'Leave blank to number it, e.g. LAP-0007.'}>
            <Input className="mono" maxLength={20} value={f.tag} onChange={(e) => set('tag', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Name" required>
            <Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Dell Latitude 5440" />
          </Field>
          <Field label="Category" required>
            <Select value={f.category} onChange={(e) => set('category', e.target.value)} options={categories} />
          </Field>
          <Field label="Brand">
            <Input value={f.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label="Model">
            <Input value={f.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field label="Serial number">
            <Input className="mono" value={f.serialNo} onChange={(e) => set('serialNo', e.target.value)} />
          </Field>
          <Field label="Purchase date">
            <Input type="date" value={f.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
          </Field>
          <Field label="Cost (Rs)">
            <Input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} />
          </Field>
          <Field label="Warranty to">
            <Input type="date" value={f.warrantyTo} onChange={(e) => set('warrantyTo', e.target.value)} />
          </Field>
          <Field label="Condition">
            <Select value={f.condition} onChange={(e) => set('condition', e.target.value as Condition)} options={condOptions} />
          </Field>
          <Field label="Branch">
            <BranchSelect value={f.branchId} onChange={(v) => set('branchId', v)} placeholder="No branch" />
          </Field>
          {asset && (
            <Field label="Status" hint={asset.status === 'ASSIGNED' ? 'Take it back first to change the status.' : undefined}>
              <Select
                value={f.status}
                disabled={asset.status === 'ASSIGNED'}
                onChange={(e) => set('status', e.target.value as AssetStatus)}
                options={(asset.status === 'ASSIGNED' ? STATUSES : STATUSES.filter((s) => s !== 'ASSIGNED')).map((s) => ({ value: s, label: label(s) }))}
              />
            </Field>
          )}
          <Field label="Notes" wide>
            <Textarea maxLength={500} value={f.notes} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 60 }} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AssignModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const [emp, setEmp] = useState<string | null>(null);
  const [empName, setEmpName] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    if (!emp) return;
    const r = await act.run(() => api.post(`/assets/${asset.id}/assign`, { employeeId: emp, note }));
    if (r !== undefined) onDone(`${asset.tag} assigned to ${empName}.`);
  };
  return (
    <Modal
      title={`Assign ${asset.tag} — ${asset.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!emp} onClick={save}>
            Assign
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <Field label="Employee" required hint="They get a notification.">
          <EmployeePicker
            value={emp}
            status="ACTIVE"
            onChange={(id, e) => {
              setEmp(id);
              setEmpName(e ? `${e.firstName} ${e.lastName}` : '');
            }}
          />
        </Field>
        <Field label="Note">
          <Textarea maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. With charger and bag" />
        </Field>
      </div>
    </Modal>
  );
}

function ReturnModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const [condition, setCondition] = useState<Condition>(asset.condition ?? 'GOOD');
  const [note, setNote] = useState('');
  const save = async () => {
    const r = await act.run(() => api.post(`/assets/${asset.id}/return`, { condition, note }));
    if (r !== undefined) onDone(condition === 'POOR' ? `${asset.tag} taken back and marked for repair.` : `${asset.tag} is back in stock.`);
  };
  return (
    <Modal
      title={`Take back ${asset.tag} — ${asset.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} onClick={save}>
            Take back
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {asset.assignedTo && <p>From {fullName(asset.assignedTo)} ({asset.assignedTo.empNo}).</p>}
        <Field label="Condition now" hint="Poor puts it in repair; anything else back in stock.">
          <Select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} options={condOptions} />
        </Field>
        <Field label="Note">
          <Textarea maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Screen scratched" />
        </Field>
      </div>
    </Modal>
  );
}

// ─── Requests ──────────────────────────────────────────────────

function Requests({ categories, canManage }: { categories: { value: string; label: string }[]; canManage: boolean }) {
  const { toast, confirm } = useUi();
  const act = useAction();
  const [status, setStatus] = useState('PENDING');
  const { data, error, loading, reload } = useApi<AssetRequest[]>('/assets/requests', { status });
  const [approving, setApproving] = useState<AssetRequest | null>(null);
  const [creating, setCreating] = useState(false);

  const reject = async (r: AssetRequest) => {
    const note = await confirm({ title: `Reject the request for ${r.item}?`, input: { label: 'Reason (the employee will see this)', minLength: 3 }, ok: 'Reject', danger: true });
    if (note === false) return;
    const ok = await act.run(() => api.post(`/assets/requests/${r.id}/decide`, { approve: false, note }));
    if (ok !== undefined) {
      toast('Request rejected.');
      reload();
    }
  };

  return (
    <>
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <div className="filters">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All"
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <span className="grow" />
          {canManage && (
            <Button size="sm" icon="box" onClick={() => setCreating(true)}>
              New request on behalf of an employee
            </Button>
          )}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title={status === 'PENDING' ? 'No requests waiting' : 'No requests'} icon="box">
                Employees ask for equipment from the SmartHR app.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Reason</th>
                      <th>Needed by</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Person name={fullName(r.employee)} sub={`${r.employee.empNo}${r.employee.designation ? ` · ${r.employee.designation}` : ''}`} href={`/employees/${r.employee.id}`} photoEmployeeId={r.employee.id} />
                        </td>
                        <td>
                          <b>{r.item}</b>
                          <div className="tiny muted">asked {date(r.createdAt)}</div>
                        </td>
                        <td>{label(r.category)}</td>
                        <td style={{ maxWidth: 300 }}>{r.reason}</td>
                        <td className="nowrap">{r.neededBy ? date(r.neededBy) : '—'}</td>
                        <td>
                          <StatusChip status={r.status} />
                          {r.asset && <div className="tiny muted mono">{r.asset.tag}</div>}
                          {r.decisionNote && r.status !== 'PENDING' && <div className="tiny muted">{r.decisionNote}</div>}
                        </td>
                        <td className="nowrap right">
                          {r.status === 'PENDING' && (
                            <>
                              <Button size="xs" variant="ok" onClick={() => setApproving(r)}>
                                Approve
                              </Button>{' '}
                              <Button size="xs" variant="danger" disabled={act.busy} onClick={() => reject(r)}>
                                Reject
                              </Button>
                            </>
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
      {approving && (
        <ApproveModal
          req={approving}
          canManage={canManage}
          onClose={() => setApproving(null)}
          onDone={(msg) => {
            setApproving(null);
            toast(msg);
            reload();
          }}
        />
      )}
      {creating && (
        <NewRequestModal
          categories={categories}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            toast('Request added.');
            setStatus('PENDING');
            reload();
          }}
        />
      )}
    </>
  );
}

function ApproveModal({ req, canManage, onClose, onDone }: { req: AssetRequest; canManage: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const act = useAction();
  const stock = useApi<AssetList>(canManage ? '/assets' : null, { status: 'IN_STOCK', category: req.category });
  const [assetId, setAssetId] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const r = await act.run(() => api.post(`/assets/requests/${req.id}/decide`, { approve: true, note, assetId: assetId || null }));
    if (r !== undefined) onDone(assetId ? 'Approved and assigned.' : 'Request approved.');
  };
  const list = stock.data?.rows ?? [];
  return (
    <Modal
      title={`Approve — ${req.item}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="ok" busy={act.busy} onClick={save}>
            {assetId ? 'Approve and assign' : 'Approve without an asset'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error ?? stock.error} />
        <p>
          {fullName(req.employee)} asked for <b>{req.item}</b> ({label(req.category)}): {req.reason}
        </p>
        {canManage ? (
          <Field label={`Give from stock (${label(req.category)})`} hint={stock.loading ? 'Loading stock…' : list.length === 0 ? 'Nothing of this category is in stock. You can approve now and assign later.' : 'Or approve without an asset and assign one later.'}>
            <Select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="No asset — approve only"
              options={list.map((a) => ({ value: a.id, label: `${a.tag} — ${a.name}${a.serialNo ? ` (${a.serialNo})` : ''}${a.condition ? ` · ${label(a.condition)}` : ''}` }))}
            />
          </Field>
        ) : (
          <p className="small muted">You can approve; HR assigns the item from stock.</p>
        )}
        <Field label="Note to the employee">
          <Textarea maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Collect from the IT desk on Monday" />
        </Field>
      </div>
    </Modal>
  );
}

function NewRequestModal({ categories, onClose, onDone }: { categories: { value: string; label: string }[]; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ employeeId: null as string | null, category: categories[0]?.value ?? 'OTHER', item: '', reason: '', neededBy: '' });
  const ok = !!f.employeeId && f.item.trim().length >= 2 && f.reason.trim().length >= 5;
  const save = async () => {
    const r = await act.run(() => api.post('/assets/requests', { employeeId: f.employeeId, category: f.category, item: f.item.trim(), reason: f.reason.trim(), neededBy: f.neededBy || null }));
    if (r !== undefined) onDone();
  };
  return (
    <Modal
      title="New request on behalf of an employee"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            Add request
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Employee" required wide>
            <EmployeePicker value={f.employeeId} status="ACTIVE" onChange={(id) => setF({ ...f, employeeId: id })} />
          </Field>
          <Field label="Category" required>
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={categories} />
          </Field>
          <Field label="Item" required>
            <Input value={f.item} maxLength={100} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="e.g. Laptop for the new accountant" />
          </Field>
          <Field label="Needed by">
            <Input type="date" min={today()} value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} />
          </Field>
          <Field label="Reason" required wide hint="At least 5 characters.">
            <Textarea maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
